import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { UserProfile } from './types';
import { InMemoryRedisAdapter } from './in_memory_redis';
import { BenchlyBacktrackingEngine, ConflictStudent } from './algorithms/backtracking_solver';
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

/**
 * Handles 1v1 matchmaking with Maximum-Compatibility Graph Scoring over live Redis queues.
 */
export async function findOrCreate1v1Match(
    user: UserProfile,
    seekingInput: string,
    matchMode: string = 'campus_adda'
): Promise<{ roomId: string | null; matchedUser: string | null; compatibilityScore?: number }> {
    // Check if user is on cooldown
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

    // Determine compatible candidate queues to search in priority order
    const candidateQueues: string[] = [];

    if (seeking === 'any') {
        candidateQueues.push('queue:any:seeking:any');
        candidateQueues.push(userGender === 'male' ? 'queue:female:seeking:any' : 'queue:male:seeking:any');
        candidateQueues.push(userGender === 'male' ? 'queue:female:seeking:male' : 'queue:male:seeking:female');
        candidateQueues.push(userGender === 'male' ? 'queue:male:seeking:any' : 'queue:female:seeking:any');
    } else if (seeking === 'female') {
        candidateQueues.push(`queue:female:seeking:${userGender}`);
        candidateQueues.push('queue:female:seeking:any');
    } else if (seeking === 'male') {
        candidateQueues.push(`queue:male:seeking:${userGender}`);
        candidateQueues.push('queue:male:seeking:any');
    }

    const recentRaw = await redis.smembers(`recent_partners:${user.id}`).catch(() => [] as string[]);
    const recentPartners = new Set<string>(recentRaw);

    let bestCandidateId: string | null = null;
    let bestQueueName: string | null = null;
    let bestScore = -1;

    // Inspect all waiting candidates across compatible queues and pick maximum compatibility edge
    for (const queueName of candidateQueues) {
        const waitingIds = await redis.lrange(queueName, 0, -1);
        for (const candidateId of waitingIds) {
            if (!candidateId || candidateId === user.id) continue;

            const rawMeta = await redis.get(`waiting_meta:${candidateId}`);
            let candMeta: WaitingCandidateMeta;
            if (rawMeta) {
                try {
                    candMeta = JSON.parse(rawMeta);
                } catch {
                    candMeta = {
                        id: candidateId,
                        alias: 'EWU Student',
                        dept: 'CSE',
                        batchYear: '2024',
                        gender: 'any',
                        seeking: 'any',
                        mode: 'campus_adda',
                        joinedAt: Date.now() - 10000
                    };
                }
            } else {
                candMeta = {
                    id: candidateId,
                    alias: 'EWU Student',
                    dept: 'CSE',
                    batchYear: '2024',
                    gender: 'any',
                    seeking: 'any',
                    mode: 'campus_adda',
                    joinedAt: Date.now() - 10000
                };
            }

            const score = computeLiveCompatibilityScore(myMeta, candMeta, recentPartners);
            if (score > bestScore) {
                bestScore = score;
                bestCandidateId = candidateId;
                bestQueueName = queueName;
            }
        }
    }

    if (bestCandidateId && bestQueueName) {
        const removed = await redis.lrem(bestQueueName, 1, bestCandidateId);
        if (removed > 0) {
            const roomId = randomUUID();
            const roomData = {
                users: JSON.stringify([user.id, bestCandidateId]),
                mode: matchMode,
                compatibilityScore: bestScore.toString(),
                createdAt: Date.now()
            };
            await redis.hset(`room:${roomId}`, roomData);
            await redis.expire(`room:${roomId}`, 1800);

            // Track recent partners for 2 hours to maximize campus variety
            await redis.sadd(`recent_partners:${user.id}`, bestCandidateId);
            await redis.expire(`recent_partners:${user.id}`, 7200);
            await redis.sadd(`recent_partners:${bestCandidateId}`, user.id);
            await redis.expire(`recent_partners:${bestCandidateId}`, 7200);

            await removeUserFromQueues(bestCandidateId);
            await removeUserFromQueues(user.id);

            return { roomId, matchedUser: bestCandidateId, compatibilityScore: bestScore };
        }
    }

    // No match found immediately — store live metadata & push to wait queue
    const waitQueue = seeking === 'any'
        ? `queue:${userGender}:seeking:any`
        : `queue:${userGender}:seeking:${seeking}`;

    await redis.set(`waiting_meta:${user.id}`, JSON.stringify(myMeta), 'EX', 180);
    await redis.rpush(waitQueue, user.id);
    await redis.expire(waitQueue, 180);

    return { roomId: null, matchedUser: null };
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

export async function removeUserFromQueues(userId: string) {
    const allQueues = [
        'queue:any:seeking:any',
        'queue:male:seeking:any',
        'queue:female:seeking:any',
        'queue:male:seeking:female',
        'queue:female:seeking:male',
        'queue:male:seeking:male',
        'queue:female:seeking:female'
    ];
    for (const q of allQueues) {
        await redis.lrem(q, 0, userId).catch(() => {});
    }
    await redis.del(`waiting_meta:${userId}`).catch(() => {});
}

export async function applyCooldown(userId: string) {
    const cooldownSec = parseInt(process.env.COOLDOWN_SECONDS || '15', 10);
    await redis.set(`cooldown:${userId}`, 'active', 'EX', cooldownSec);
}
