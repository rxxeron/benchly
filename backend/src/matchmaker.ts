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

/**
 * Handles 1v1 matchmaking logic
 * If Male seeking Female -> Checks the `queue:female:seeking:male` list.
 * If found, pops the user and creates a room.
 * If not found, pushes self to `queue:male:seeking:female` list.
 */
export async function findOrCreate1v1Match(
    user: UserProfile, 
    seekingGender: 'male' | 'female' | 'any'
): Promise<{ roomId: string | null, matchedUser: string | null }> {
    
    // Check if user is on cooldown
    const onCooldown = await redis.get(`cooldown:${user.id}`);
    if (onCooldown) {
        throw new Error(`You are on cooldown for ${await redis.ttl(`cooldown:${user.id}`)} more seconds.`);
    }

    // The queue we look INTO (opposite of our intent)
    const searchQueue = seekingGender === 'any' 
        ? `queue:any:seeking:any` 
        : `queue:${seekingGender}:seeking:${user.gender}`;

    // The queue we wait IN (if no match found)
    const waitQueue = seekingGender === 'any'
        ? `queue:any:seeking:any`
        : `queue:${user.gender}:seeking:${seekingGender}`;

    // Try to pop a waiting user from the search queue
    const matchedUserId = await redis.lpop(searchQueue);

    if (matchedUserId) {
        // MATCH FOUND! Create a room.
        const roomId = randomUUID();
        
        // Store room state in Redis (Expires completely after 20 mins as a hard fallback)
        const roomData = {
            users: JSON.stringify([user.id, matchedUserId]),
            createdAt: Date.now()
        };
        await redis.hset(`room:${roomId}`, roomData);
        await redis.expire(`room:${roomId}`, 1200); 

        return { roomId, matchedUser: matchedUserId };
    } else {
        // NO MATCH FOUND. Add ourselves to the wait queue.
        // We push our ID and set an expiration so we don't wait forever (e.g. 60 seconds)
        await redis.rpush(waitQueue, user.id);
        await redis.expire(waitQueue, 60);
        
        return { roomId: null, matchedUser: null };
    }
}

export async function applyCooldown(userId: string) {
    // Apply a 30-minute cooldown (1800 seconds)
    await redis.set(`cooldown:${userId}`, 'active', 'EX', 1800);
}
