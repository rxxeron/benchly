import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { UserProfile } from './types';
import dotenv from 'dotenv';

dotenv.config();

// Connect to Redis (Upstash in dev or Localhost in production)
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    retryStrategy(times) {
        if (times > 5) return null; // Stop infinite flood if offline
        return Math.min(times * 500, 2000);
    }
});

redis.on('connect', () => {
    console.log('⚡ Redis connected successfully.');
});

redis.on('error', (err) => {
    console.warn('⚠️ Redis connection notice:', err.message);
});

export function normalizeSeeking(seeking: string | undefined): 'male' | 'female' | 'any' {
    if (!seeking) return 'any';
    const s = seeking.toLowerCase().trim();
    if (s === 'anyone' || s === 'any') return 'any';
    if (s === 'guys' || s === 'male' || s === 'man') return 'male';
    if (s === 'girls' || s === 'female' || s === 'woman') return 'female';
    return 'any';
}

/**
 * Handles 1v1 matchmaking logic with bidirectional queue matching.
 */
export async function findOrCreate1v1Match(
    user: UserProfile, 
    seekingInput: string
): Promise<{ roomId: string | null, matchedUser: string | null }> {
    
    // Check if user is on cooldown
    const onCooldown = await redis.get(`cooldown:${user.id}`);
    if (onCooldown) {
        const ttl = await redis.ttl(`cooldown:${user.id}`);
        throw new Error(`You are on cooldown for ${ttl} more seconds.`);
    }

    const seeking = normalizeSeeking(seekingInput);
    const userGender = (user.gender || 'male').toLowerCase();

    // Determine compatible candidate queues to search in priority order
    const candidateQueues: string[] = [];

    if (seeking === 'any') {
        // If seeking anyone, can match with anyone seeking anyone, or anyone seeking our gender
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

    // Attempt to pop a compatible waiting user from any of the candidate queues
    for (const queueName of candidateQueues) {
        while (true) {
            const candidateId = await redis.lpop(queueName);
            if (!candidateId) break;

            // Discard self-match
            if (candidateId === user.id) {
                continue;
            }

            // Valid match found!
            const roomId = randomUUID();
            const roomData = {
                users: JSON.stringify([user.id, candidateId]),
                createdAt: Date.now()
            };
            await redis.hset(`room:${roomId}`, roomData);
            await redis.expire(`room:${roomId}`, 1800); // 30 min expiration

            // Clean candidate from any other remaining queues
            await removeUserFromQueues(candidateId);
            await removeUserFromQueues(user.id);

            return { roomId, matchedUser: candidateId };
        }
    }

    // No match found immediately. Add this user to their appropriate wait queue.
    const waitQueue = seeking === 'any'
        ? `queue:${userGender}:seeking:any`
        : `queue:${userGender}:seeking:${seeking}`;

    await redis.rpush(waitQueue, user.id);
    await redis.expire(waitQueue, 180); // 3-minute queue TTL

    return { roomId: null, matchedUser: null };
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
}

export async function applyCooldown(userId: string) {
    // Apply a 30-minute cooldown (1800 seconds)
    await redis.set(`cooldown:${userId}`, 'active', 'EX', 1800);
}
