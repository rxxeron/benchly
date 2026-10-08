import Redis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Connect to Upstash Redis & Supabase
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

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
const CONSUMER_GROUP = 'backbench_persisters';
const STREAM_KEY = 'messages_stream';
const CONSUMER_NAME = `worker-${Math.random().toString(36).substring(7)}`;

/**
 * Initializes the Redis Stream Consumer Group.
 */
async function initStream() {
    try {
        // MKSTREAM creates the stream if it doesn't exist yet
        await redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
        console.log('✅ Redis Consumer group ready.');
    } catch (err: any) {
        if (!err.message.includes('BUSYGROUP')) {
            console.error('Error creating consumer group:', err);
        }
    }
}

/**
 * Reads a chunk of messages from Redis, writes to Postgres, and Acknowledges.
 */
async function processBatch() {
    try {
        // 1. Read up to BATCH_SIZE messages, block for 5 seconds if empty
        const response = await redis.xreadgroup(
            'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
            'COUNT', BATCH_SIZE,
            'BLOCK', 5000,
            'STREAMS', STREAM_KEY, '>'
        ) as any;

        if (!response || response.length === 0) return; // No messages, loop again

        const streamData = response[0]; 
        const messages = streamData[1];

        if (messages.length === 0) return;

        // 2. Map Redis string arrays into Postgres objects
        const dbPayload = messages.map((msg: any) => {
            const fields = msg[1]; // ['roomId', '123', 'authorId', '456', 'content', 'hi!']
            const data: any = {};
            for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
            }

            return {
                room_id: data.roomId,
                author_id: data.authorId,
                content: data.content
            };
        });

        // 3. Bulk Insert into Supabase
        const { error } = await supabase.from('messages').insert(dbPayload);

        if (error) {
            console.error('❌ Supabase bulk insert failed:', error.message);
            // Do NOT acknowledge. The messages stay in the 'pending' list for retry.
            return; 
        }

        // 4. Acknowledge and clean up Redis
        const messageIds = messages.map((msg: any) => msg[0]);
        await redis.xack(STREAM_KEY, CONSUMER_GROUP, ...messageIds);
        await redis.xdel(STREAM_KEY, ...messageIds); // Free up Redis RAM

        console.log(`💾 Persisted ${messages.length} messages to Database.`);

    } catch (err) {
        console.error('Error in batch processor:', err);
    }
}

/**
 * The infinite loop that keeps the worker alive.
 */
async function runWorker() {
    console.log('🚀 Starting Backbench Batch Worker...');
    await initStream();
    
    while (true) {
        await processBatch();
    }
}

runWorker();
