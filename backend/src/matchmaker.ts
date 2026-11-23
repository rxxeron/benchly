import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { UserProfile } from './types';
import { InMemoryRedisAdapter } from './in_memory_redis';
import { BenchlyBacktrackingEngine, ConflictStudent } from './algorithms/backtracking_solver';
import { BatchCandidate, BatchMatchResult, MatchEdge, mutuallyCompatible, solveBatchMatching } from './algorithms/batch_matcher';
import dotenv from 'dotenv';

dotenv.config();

// Use external Redis if REDIS_URL is explicitly provided; otherwise use fast In-Memory Valkey/Redis Adapter
export const redis: any = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
          retryStrategy(times) {
              if (times > 5) return null;
              return Math.min(times * 500, 2000);
          }
      })
    : new InMemoryRedisAdapter();

export function normalizeSeeking(seeking: string | undefined): 'male' | 'female' | 'any' {
    if (!seeking) return 'any';
    const s = seeking.toLowerCase().trim();
    if (s === 'anyone' || s === 'any') return 'any';
    if (s === 'guys' || s === 'male' || s === 'man') return 'male';
    if (s === 'girls' || s === 'female' || s === 'woman') return 'female';
    return 'any';
}

export interface WaitingCandidateMeta {
    id: string;
    alias: string;
    dept: string;
    batchYear: string;
    gender: string;
    seeking: string;
    mode: string;
    joinedAt: number;
}

/**
 * Computes compatibility edge weight w(u, v) between two real waiting EWU students
 */
export function computeLiveCompatibilityScore(
    a: WaitingCandidateMeta,
    b: WaitingCandidateMeta,
    recentPartnersOfA: Set<string>
): number {
    if (a.id === b.id) return -1;
    let score = 50;

    // 1. Mode / Topic alignment
    if (a.mode === b.mode) {
        score += 25;
    }

    // 2. Department & Batch affinity
    const sameDept = a.dept && b.dept && a.dept.toUpperCase() === b.dept.toUpperCase();
    if (a.mode === 'same_dept' || a.mode === 'study_buddy' || b.mode === 'same_dept' || b.mode === 'study_buddy') {
        score += sameDept ? 30 : 5;
    } else {
        score += sameDept ? 15 : 18; // General adda appreciates cross-department serendipity
    }

    // 3. Starvation avoidance boost (1 point per 2 seconds waited, up to +25)
    const now = Date.now();
    const waitSecB = Math.max(0, Math.floor((now - (b.joinedAt || now)) / 1000));
    score += Math.min(25, Math.floor(waitSecB / 2));

    // 4. Repeat-partner penalty (avoid rematching the exact same classmate back-to-back)
    if (recentPartnersOfA.has(b.id)) {
        score -= 40;
    }

    return Math.max(1, score);
}

const ALL_1V1_QUEUES = [
    'queue:any:seeking:any',
    'queue:male:seeking:any',
    'queue:female:seeking:any',
    'queue:male:seeking:female',
    'queue:female:seeking:male',
    'queue:male:seeking:male',
    'queue:female:seeking:female'
];

/** Waiting metadata lives for 3 minutes; the AI fallback normally takes over long before. */
const WAITING_TTL_SEC = 180;

/**
 * Step 1 of 1v1 matchmaking: put the student in the waiting pool.
 * Matching itself happens in runBatchMatchTick(), which solves the whole pool at once.
 */
export async function enqueue1v1(
    user: UserProfile,
    seekingInput: string,
    matchMode: string = 'campus_adda'
): Promise<void> {
    const onCooldown = await redis.get(`cooldown:${user.id}`);
    if (onCooldown) {
        const ttl = await redis.ttl(`cooldown:${user.id}`);
        throw new Error(`You are on cooldown for ${ttl} more seconds.`);
    }

    const seeking = normalizeSeeking(seekingInput);
    const userGender = (user.gender || 'male').toLowerCase();
    const myMeta: WaitingCandidateMeta = {
        id: user.id,
        alias: user.alias || 'Anonymous Student',
        dept: user.dept_code || 'CSE',
        batchYear: user.batch_year || '2024',
        gender: userGender,
        seeking,
        mode: matchMode || 'campus_adda',
        joinedAt: Date.now()
    };

    const waitQueue = `queue:${userGender}:seeking:${seeking}`;
    await redis.set(`waiting_meta:${user.id}`, JSON.stringify(myMeta), 'EX', WAITING_TTL_SEC);
    await redis.rpush(waitQueue, user.id);
    await redis.expire(waitQueue, WAITING_TTL_SEC);
}

export interface BatchMatchedPair {
    a: WaitingCandidateMeta; // joined first -> room "creator"
    b: WaitingCandidateMeta;
    score: number;
}

export interface BatchTickReport {
    at: number;
    poolSize: number;
    pairs: BatchMatchedPair[];
    result: BatchMatchResult | null;
}

/**
 * Step 2: one batch tick. Reads every waiting student, builds the compatibility graph and solves
 * it with solveBatchMatching (DSU components -> Branch-and-Bound / Edmonds-Karp / greedy).
 * Returns the pairs that were successfully claimed from the queues.
 */
export async function runBatchMatchTick(): Promise<BatchTickReport> {
    const at = Date.now();
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const q of ALL_1V1_QUEUES) {
        const members: string[] = await redis.lrange(q, 0, -1).catch(() => [] as string[]);
        for (const id of members) {
            if (id && !seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
        }
    }
    if (ids.length < 2) return { at, poolSize: ids.length, pairs: [], result: null };

    const pool: WaitingCandidateMeta[] = [];
    for (const id of ids) {
        const raw = await redis.get(`waiting_meta:${id}`);
        if (!raw) continue; // expired: ignore, the queue entry expires too
        try {
            const meta = JSON.parse(raw) as WaitingCandidateMeta;
            pool.push({ ...meta, seeking: normalizeSeeking(meta.seeking) });
        } catch {
            /* skip corrupt meta */
        }
    }
    if (pool.length < 2) return { at, poolSize: pool.length, pairs: [], result: null };

    const recent = new Map<string, Set<string>>();
    for (const m of pool) {
        const r: string[] = await redis.smembers(`recent_partners:${m.id}`).catch(() => [] as string[]);
        recent.set(m.id, new Set(r));
    }

    const candidates: BatchCandidate[] = pool.map(m => ({
        id: m.id,
        gender: m.gender,
        seeking: normalizeSeeking(m.seeking)
    }));
    const edges: MatchEdge[] = [];
    for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
            if (!mutuallyCompatible(candidates[i], candidates[j])) continue;
            const wij = computeLiveCompatibilityScore(pool[i], pool[j], recent.get(pool[i].id)!);
            const wji = computeLiveCompatibilityScore(pool[j], pool[i], recent.get(pool[j].id)!);
            edges.push({ u: i, v: j, w: Math.round((wij + wji) / 2) });
        }
    }

    const result = solveBatchMatching(pool.length, edges);
    const claimed: BatchMatchedPair[] = [];
    for (const p of result.pairs) {
        const [a, b] = pool[p.u].joinedAt <= pool[p.v].joinedAt ? [pool[p.u], pool[p.v]] : [pool[p.v], pool[p.u]];
        if (await claimPair(a.id, b.id)) claimed.push({ a, b, score: p.w });
    }
    return { at, poolSize: pool.length, pairs: claimed, result };
}

/** Removes userId from every 1v1 queue; returns how many entries were removed. */
async function removeFromQueuesCount(userId: string): Promise<number> {
    let removed = 0;
    for (const q of ALL_1V1_QUEUES) {
        removed += Number(await redis.lrem(q, 0, userId).catch(() => 0)) || 0;
    }
    return removed;
}

/**
 * Takes both students out of the waiting pool. If the second one already left (cancelled,
 * disconnected, or the AI fallback took them), the first is put back so they stay in the pool.
 */
async function claimPair(aId: string, bId: string): Promise<boolean> {
    const metaA = await redis.get(`waiting_meta:${aId}`);
    if ((await removeFromQueuesCount(aId)) === 0) return false;
    if ((await removeFromQueuesCount(bId)) === 0) {
        if (metaA) {
            try {
                const m = JSON.parse(metaA) as WaitingCandidateMeta;
                await redis.rpush(`queue:${m.gender}:seeking:${normalizeSeeking(m.seeking)}`, aId);
            } catch {
                /* meta unreadable: A re-queues on their next search */
            }
        }
        return false;
    }
    await redis.del(`waiting_meta:${aId}`, `waiting_meta:${bId}`).catch(() => {});
    return true;
}

/** Creates the Redis room for a matched pair and records them as recent partners. */
export async function createMatchedRoom(aId: string, bId: string, mode: string, score: number): Promise<string> {
    const roomId = randomUUID();
    await redis.hset(`room:${roomId}`, {
        users: JSON.stringify([aId, bId]),
        mode,
        compatibilityScore: score.toString(),
        createdAt: Date.now()
    });
    await redis.expire(`room:${roomId}`, 1800);

    // Track recent partners for 2 hours to maximize campus variety
    await redis.sadd(`recent_partners:${aId}`, bId);
    await redis.expire(`recent_partners:${aId}`, 7200);
    await redis.sadd(`recent_partners:${bId}`, aId);
    await redis.expire(`recent_partners:${bId}`, 7200);
    return roomId;
}

/**
 * Phase 4 Live 5-Person "Cafeteria Group Adda" Lounge Clustering
 * Clusters up to 5 real connected classmates sharing a topic into an active room.
 */
export async function joinOrCreateGroupLounge(
    user: UserProfile,
    topic: string = 'Cafeteria Hangout'
): Promise<{
    roomId: string;
    topic: string;
    membersCount: number;
    memberAliases: string[];
}> {
    const slug = (topic || 'cafeteria').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const activeLoungeKey = `active_group_lounge:${slug}`;
    let roomId = await redis.get(activeLoungeKey);

    if (roomId) {
        const existingMembers: string[] = await redis.smembers(`group_members:${roomId}`).catch(() => []);
        if (existingMembers.length >= 5) {
            // Current 5-person lounge is full; spawn a fresh lounge component
            roomId = null;
        } else if (existingMembers.length > 0 && !existingMembers.includes(user.id)) {
            // Run CSE246 Graph Coloring Backtracking to verify conflict-free lounge placement
            const recentRaw: string[] = await redis.smembers(`recent_partners:${user.id}`).catch(() => []);
            const myConflicts = new Set<string>(recentRaw);
            const pool: ConflictStudent[] = [
                { id: user.id, conflicts: myConflicts },
                ...existingMembers.map(mId => ({
                    id: mId,
                    conflicts: myConflicts.has(mId) ? new Set<string>([user.id]) : new Set<string>()
                }))
            ];
            const coloring = BenchlyBacktrackingEngine.solveConflictFreeLoungeColoring(pool, 1, 5);
            if (!coloring.solvable) {
                // Conflict detected with an existing member in this lounge; spawn a conflict-free lounge
                roomId = null;
            }
        }
    }

    if (!roomId) {
        roomId = `group_${slug}_${randomUUID().slice(0, 8)}`;
        await redis.set(activeLoungeKey, roomId, 'EX', 1200); // 20-minute lounge lifecycle
    }

    await redis.sadd(`group_members:${roomId}`, user.id);
    await redis.hset(
        `group_aliases:${roomId}`,
        user.id,
        `${user.alias || 'Anonymous'} (${user.badge || 'EWU'})`
    );
    await redis.expire(`group_members:${roomId}`, 1200);
    await redis.expire(`group_aliases:${roomId}`, 1200);

    const aliasesHash = await redis.hgetall(`group_aliases:${roomId}`);
    const memberAliases: string[] = Object.values(aliasesHash).map((v) => String(v));

    return {
        roomId,
        topic,
        membersCount: memberAliases.length,
        memberAliases
    };
}

/** Returns the number of queue entries removed (0 means the student was no longer waiting). */
export async function removeUserFromQueues(userId: string): Promise<number> {
    const removed = await removeFromQueuesCount(userId);
    await redis.del(`waiting_meta:${userId}`).catch(() => {});
    return removed;
}

export async function applyCooldown(userId: string) {
    const cooldownSec = parseInt(process.env.COOLDOWN_SECONDS || '15', 10);
    await redis.set(`cooldown:${userId}`, 'active', 'EX', cooldownSec);
}
