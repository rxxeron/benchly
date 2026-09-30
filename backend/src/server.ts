import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { authenticateSocket, supabase } from './supabase';
import { redis, findOrCreate1v1Match, applyCooldown } from './matchmaker';

dotenv.config();

const CHAT_DURATION_MS = 15 * 60 * 1000;
const CHAT_WARNING_MS = 14 * 60 * 1000;

const app = express();
app.use(cors());
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: { origin: '*' }
});

// Store connected user profiles in memory (mapped by socket.id)
// Note: In a multi-server setup, this would be in Redis.
const activeUsers = new Map<string, any>();
const roomTimeouts = new Map<string, NodeJS.Timeout[]>();
const roomMembers = new Map<string, { user1: string, user2: string }>();

const rateLimitMap = new Map<string, number>();
setInterval(() => rateLimitMap.clear(), 1000);

io.on('connection', async (socket) => {
    console.log(`Socket connected: ${socket.id}, authenticating...`);

    // 1. Authenticate immediately
    const token = socket.handshake.auth.token;
    if (!token) {
        return socket.disconnect();
    }

    try {
        const profile = await authenticateSocket(token);
        activeUsers.set(socket.id, profile);
        socket.emit('authenticated', { alias: profile.alias, streak: profile.streak_count });
    } catch (err) {
        console.error('Auth failed for socket', socket.id);
        return socket.disconnect();
    }

    const user = activeUsers.get(socket.id);

    // 2. Matchmaking Intent
    socket.on('join_1v1_queue', async (data) => {
        const seeking = data.seeking || 'any'; // 'male', 'female', or 'any'
        
        try {
            const match = await findOrCreate1v1Match(user, seeking);
            
            if (match.roomId) {
                // We found a match! 
                socket.join(match.roomId);
                socket.emit('match_found', { roomId: match.roomId, role: 'creator' });
                
                // We must notify the OTHER user. Since we don't have their socket ID directly 
                // mapped in Redis yet (for simplicity in this single-server V1), we broadcast 
                // to a private room of their User ID.
                io.to(match.matchedUser!).emit('match_found', { roomId: match.roomId, role: 'joiner' });
                
                roomMembers.set(match.roomId, { user1: user.id, user2: match.matchedUser! });
                
                // Set the timers
                const warningTimeout = setTimeout(() => {
                    io.to(match.roomId!).emit('chat_ending_soon');
                }, CHAT_WARNING_MS);
                
                const closeTimeout = setTimeout(() => {
                    io.to(match.roomId!).emit('chat_closed');
                    io.in(match.roomId!).socketsLeave(match.roomId!);
                    applyCooldown(user.id);
                    applyCooldown(match.matchedUser!);
                    roomTimeouts.delete(match.roomId!);
                    roomMembers.delete(match.roomId!);
                }, CHAT_DURATION_MS);
                
                roomTimeouts.set(match.roomId, [warningTimeout, closeTimeout]);

            } else {
                // Waiting in queue
                socket.emit('waiting_in_queue');
                // Temporarily join a room matching their own ID so the creator can ping them
                socket.join(user.id); 
            }
        } catch (error: any) {
            socket.emit('error', { message: error.message });
        }
    });

    // 3. Handle incoming 'joiner' joining the created room
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        io.to(roomId).emit('room_ready'); // Both are here, start the UI timer!
    });

    socket.on('typing', (roomId) => {
        socket.to(roomId).emit('partner_typing');
    });

    socket.on('stop_typing', (roomId) => {
        socket.to(roomId).emit('partner_stopped_typing');
    });

    socket.on('report_user', async (data) => {
        const { roomId, messageId, reason } = data;
        try {
            await supabase.from('reports').insert({
                room_id: roomId,
                message_id: messageId,
                reason: reason,
                reporter_id: user.id
            });
            socket.emit('report_submitted');
        } catch (err) {
            console.error('Failed to report user', err);
        }
    });

    // 4. Messaging
    socket.on('send_message', (data) => {
        const rateCount = rateLimitMap.get(socket.id) || 0;
        if (rateCount >= 3) return;
        rateLimitMap.set(socket.id, rateCount + 1);

        const { roomId, content } = data;
        const messageId = randomUUID();
        
        // --- STRICT PII FILTER ---
        let safeContent = content.replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi, '[CENSORED EMAIL]');
        safeContent = safeContent.replace(/(?:\+88)?01[3-9]\d{8}/g, '[CENSORED PHONE]');
        safeContent = safeContent.replace(/https?:\/\/[^\s]+/gi, '[CENSORED LINK]');
        safeContent = safeContent.replace(/www\.[^\s]+/gi, '[CENSORED LINK]');
        safeContent = safeContent.replace(/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi, '[CENSORED SOCIAL]');
        // --------------------------
        
        // Broadcast to the room (showing ONLY the alias, never the DB ID)
        io.to(roomId).emit('new_message', {
            id: messageId,
            authorAlias: user.alias,
            content: safeContent,
            timestamp: Date.now()
        });

        // (Batch Worker will pick these up from a Redis stream later to save to Postgres)
        redis.xadd('messages_stream', '*', 'roomId', roomId, 'authorId', user.id, 'content', safeContent);
    });

    // 5. Extend Chat
    socket.on('request_extension', async (roomId) => {
        // Logic to track if both users requested an extension
        const requests = await redis.sadd(`room_extension:${roomId}`, user.id);
        if (requests >= 2) {
            io.to(roomId).emit('chat_extended', { minutes: 15 });
            
            const existing = roomTimeouts.get(roomId);
            if (existing) {
                existing.forEach(clearTimeout);
            }

            const warningTimeout = setTimeout(() => {
                io.to(roomId).emit('chat_ending_soon');
            }, CHAT_WARNING_MS);
            
            const closeTimeout = setTimeout(() => {
                io.to(roomId).emit('chat_closed');
                io.in(roomId).socketsLeave(roomId);
                
                const members = roomMembers.get(roomId);
                if (members) {
                    applyCooldown(members.user1);
                    applyCooldown(members.user2);
                }
                
                roomTimeouts.delete(roomId);
                roomMembers.delete(roomId);
            }, CHAT_DURATION_MS);
            
            roomTimeouts.set(roomId, [warningTimeout, closeTimeout]);
        } else {
            // Notify the other user that an extension was requested
            socket.to(roomId).emit('extension_requested_by_partner');
        }
    });

    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
        
        if (user && user.id) {
            for (const [roomId, members] of roomMembers.entries()) {
                if (members.user1 === user.id || members.user2 === user.id) {
                    const existing = roomTimeouts.get(roomId);
                    if (existing) {
                        existing.forEach(clearTimeout);
                    }
                    roomTimeouts.delete(roomId);
                    roomMembers.delete(roomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Backend is running on port ${PORT}`);
});
