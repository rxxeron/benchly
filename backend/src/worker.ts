import Redis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Connect to Redis & Supabase
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 500, 2000);
    }
});
redis.on('error', (err) => {
    console.warn('⚠️ Worker Redis notice:', err.message);
});

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder_key'
);

/**
 * Benchly Zero-Cost Archiver Worker
 * Everything lives in-memory on Redis during live chats.
 * If a room reaches 30 minutes or concluded without being flushed,
 * this worker writes the ENTIRE transcript in ONE SINGLE ROW to public.room_conversations.
 */
async function archiveStaleRooms() {
    try {
        const roomKeys = await redis.keys('room_messages:*');
        if (roomKeys.length === 0) return;

        for (const key of roomKeys) {
            const roomId = key.replace('room_messages:', '');
            const rawMsgs = await redis.lrange(key, 0, -1);
            if (!rawMsgs || rawMsgs.length === 0) {
                await redis.del(key);
                continue;
            }

            const messagesList = rawMsgs.map((m) => {
                try { return JSON.parse(m); } catch (e) { return null; }
            }).filter(Boolean);

            if (messagesList.length === 0) {
                await redis.del(key);
                continue;
            }

            const firstMsgTime = messagesList[0]?.timestamp || Date.now();
            const ageMinutes = (Date.now() - firstMsgTime) / (60 * 1000);

            // Archive if session is older than 30 minutes
            if (ageMinutes >= 30) {
                const isHandshakeAgreed = (await redis.get(`room:${roomId}:handshake_agreed`)) === 'true';

                // Find distinct user IDs
                const authorIds = Array.from(new Set(messagesList.map((m: any) => m.author_id).filter(Boolean)));
                const user1 = authorIds[0] || null;
                const user2 = authorIds[1] || null;

                const durationSec = Math.round((Date.now() - firstMsgTime) / 1000);

                await supabase.from('room_conversations').insert({
                    room_id: roomId,
                    user1_id: user1,
                    user2_id: user2,
                    messages: messagesList,
                    messages_count: messagesList.length,
                    duration_seconds: durationSec,
                    handshake_agreed: isHandshakeAgreed,
                    closed_at: new Date().toISOString()
                });

                await redis.del(
                    key,
                    `room_handshake:${roomId}`,
                    `room:${roomId}:handshake_agreed`,
                    `room_extension:${roomId}`
                );
                console.log(`💾 Worker archived 30-min room ${roomId} (${messagesList.length} msgs) in 1 row.`);
            }
        }
    } catch (err) {
        console.error('Error in archiveStaleRooms worker:', err);
    }
}

/**
 * Main worker loop running every 60 seconds
 */
async function runWorker() {
    console.log('🚀 Starting Benchly 30-Minute Room Archiver Worker...');
    while (true) {
        await archiveStaleRooms();
        await new Promise((res) => setTimeout(res, 60 * 1000));
    }
}

runWorker();
