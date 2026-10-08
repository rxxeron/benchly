import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { authenticateSocket, supabase } from './supabase';
import { redis, findOrCreate1v1Match, applyCooldown, removeUserFromQueues } from './matchmaker';
import { AnalyticsEngine } from './analytics';
import { getRandomIcebreaker, EWU_CAMPUS_ICEBREAKERS } from './ewu_helper';

dotenv.config();

const CHAT_DURATION_MS = 15 * 60 * 1000;
const CHAT_WARNING_MS = 14 * 60 * 1000;

const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: { origin: '*' }
});

const analytics = new AnalyticsEngine(redis);

// Mappings for active users, socket routing, and rooms
const activeUsers = new Map<string, any>();
const userSocketMap = new Map<string, string>();
const roomTimeouts = new Map<string, NodeJS.Timeout[]>();
const roomMembers = new Map<string, { user1: string; user2: string; startTime: number; partner1Badge?: string; partner2Badge?: string }>();
const handshakeVotes = new Map<string, Set<string>>();

const rateLimitMap = new Map<string, number>();
setInterval(() => rateLimitMap.clear(), 1000);

// ==========================================
// REST API Endpoints (Admin Analytics & Health)
// ==========================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'benchly-backend', uptime: process.uptime() });
});

// Real-time telemetry endpoint for Benchly Admin Dashboard
app.get('/api/analytics/realtime', async (req, res) => {
    try {
        const metrics = await analytics.getRealtimeMetrics();
        res.json(metrics);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Aggregated campus intelligence endpoint
app.get('/api/analytics/summary', async (req, res) => {
    try {
        const summary = await analytics.getAggregatedSummary();
        res.json(summary);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// EWU Campus Icebreakers endpoint
app.get('/api/icebreakers', (req, res) => {
    res.json({ icebreakers: EWU_CAMPUS_ICEBREAKERS });
});

// ==========================================
// WebSocket Real-Time Gateway
// ==========================================

io.on('connection', async (socket) => {
    await analytics.trackUserConnect(socket.id);

    // 1. Authenticate immediately
    const token = socket.handshake.auth.token;
    if (!token) {
        return socket.disconnect();
    }

    try {
        const profile = await authenticateSocket(token);
        activeUsers.set(socket.id, profile);
        userSocketMap.set(profile.id, socket.id);
        socket.join(profile.id); // Guarantee user can be messaged by user ID

        socket.emit('authenticated', {
            alias: profile.alias,
            streak: profile.streak_count,
            badge: profile.badge,
            dept: profile.dept_code
        });
    } catch (err) {
        console.error('Auth failed for socket', socket.id);
        return socket.disconnect();
    }

    const user = activeUsers.get(socket.id);

    // 2. Matchmaking Intent
    socket.on('join_1v1_queue', async (data) => {
        const seeking = data?.seeking || 'any';
        
        try {
            await removeUserFromQueues(user.id);
            const match = await findOrCreate1v1Match(user, seeking);
            
            if (match.roomId) {
                // We found a match! Generate campus icebreaker
                const icebreaker = getRandomIcebreaker();
                
                socket.join(match.roomId);
                socket.emit('match_found', { 
                    roomId: match.roomId, 
                    role: 'creator',
                    icebreaker: icebreaker,
                    partnerBadge: 'EWU Student'
                });
                
                // Notify the other waiting user via both room and direct socket
                io.to(match.matchedUser!).emit('match_found', { 
                    roomId: match.roomId, 
                    role: 'joiner',
                    icebreaker: icebreaker,
                    partnerBadge: user.badge || 'EWU Student'
                });

                const otherSocketId = userSocketMap.get(match.matchedUser!);
                if (otherSocketId) {
                    io.to(otherSocketId).emit('match_found', { 
                        roomId: match.roomId, 
                        role: 'joiner',
                        icebreaker: icebreaker,
                        partnerBadge: user.badge || 'EWU Student'
                    });
                }
                
                roomMembers.set(match.roomId, { 
                    user1: user.id, 
                    user2: match.matchedUser!,
                    startTime: Date.now()
                });

                // Record telemetry
                analytics.recordEvent('match_created', user.dept_code, user.batch_year, 0, { seeking });
                
                // Set the timeouts
                const warningTimeout = setTimeout(() => {
                    io.to(match.roomId!).emit('chat_ending_soon');
                }, CHAT_WARNING_MS);
                
                const closeTimeout = setTimeout(() => {
                    io.to(match.roomId!).emit('chat_closed');
                    io.in(match.roomId!).socketsLeave(match.roomId!);
                    
                    const durationSec = Math.round((Date.now() - (roomMembers.get(match.roomId!)?.startTime || Date.now())) / 1000);
                    analytics.recordEvent('chat_completed', user.dept_code, user.batch_year, durationSec);

                    applyCooldown(user.id);
                    applyCooldown(match.matchedUser!);
                    roomTimeouts.delete(match.roomId!);
                    roomMembers.delete(match.roomId!);
                    handshakeVotes.delete(match.roomId!);
                }, CHAT_DURATION_MS);
                
                roomTimeouts.set(match.roomId, [warningTimeout, closeTimeout]);

            } else {
                // Waiting in queue
                socket.emit('waiting_in_queue');
                socket.join(user.id); 
            }
        } catch (error: any) {
            socket.emit('error', { message: error.message });
        }
    });

    socket.on('cancel_1v1_queue', async () => {
        if (user && user.id) {
            await removeUserFromQueues(user.id);
        }
    });

    // 3. Handle incoming 'joiner' joining the created room
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        io.to(roomId).emit('room_ready');
    });

    socket.on('typing', (roomId) => {
        socket.to(roomId).emit('partner_typing');
    });

    socket.on('stop_typing', (roomId) => {
        socket.to(roomId).emit('partner_stopped_typing');
    });

    // 4. Mutual Handshake Feature (Exchange Contact / Handle)
    socket.on('request_handshake', (roomId) => {
        if (!handshakeVotes.has(roomId)) {
            handshakeVotes.set(roomId, new Set());
        }
        const votes = handshakeVotes.get(roomId)!;
        votes.add(user.id);

        if (votes.size >= 2) {
            io.to(roomId).emit('handshake_completed', {
                message: 'Both students agreed to shake hands! You may now share your socials safely.'
            });
        } else {
            socket.to(roomId).emit('partner_requested_handshake');
        }
    });

    // 5. Reporting
    socket.on('report_user', async (data) => {
        const { roomId, messageId, reason } = data;
        try {
            await supabase.from('reports').insert({
                room_id: roomId,
                message_id: messageId,
                reason: reason,
                reporter_id: user.id
            });
            analytics.recordEvent('report_filed', user.dept_code, user.batch_year, 0, { reason });
            socket.emit('report_submitted');
        } catch (err) {
            console.error('Failed to report user', err);
        }
    });

    // 6. Messaging & Strict PII Sanitization
    socket.on('send_message', (data) => {
        const rateCount = rateLimitMap.get(socket.id) || 0;
        if (rateCount >= 3) return;
        rateLimitMap.set(socket.id, rateCount + 1);

        const { roomId, content } = data;
        const messageId = randomUUID();
        
        let piiFound = false;
        let safeContent = content;

        // PII Detection & Analytics Tracking
        if (/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi.test(safeContent)) {
            safeContent = safeContent.replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi, '[CENSORED EMAIL]');
            piiFound = true;
            analytics.recordPiiBlocked('email', user.dept_code);
        }
        if (/(?:\+88)?01[3-9]\d{8}/g.test(safeContent)) {
            safeContent = safeContent.replace(/(?:\+88)?01[3-9]\d{8}/g, '[CENSORED PHONE]');
            piiFound = true;
            analytics.recordPiiBlocked('phone', user.dept_code);
        }
        if (/https?:\/\/[^\s]+/gi.test(safeContent) || /www\.[^\s]+/gi.test(safeContent)) {
            safeContent = safeContent.replace(/https?:\/\/[^\s]+/gi, '[CENSORED LINK]').replace(/www\.[^\s]+/gi, '[CENSORED LINK]');
            piiFound = true;
            analytics.recordPiiBlocked('link', user.dept_code);
        }
        if (/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi.test(safeContent)) {
            safeContent = safeContent.replace(/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi, '[CENSORED SOCIAL]');
            piiFound = true;
            analytics.recordPiiBlocked('social', user.dept_code);
        }

        // Broadcast to the room (showing ONLY the alias, never the DB ID)
        io.to(roomId).emit('new_message', {
            id: messageId,
            authorAlias: user.alias,
            content: safeContent,
            timestamp: Date.now()
        });

        // Track message event
        analytics.recordEvent('message_sent', user.dept_code, user.batch_year);

        // Redis Stream consumer persists messages (retained 90 days for safety complaints)
        redis.xadd('messages_stream', '*', 'roomId', roomId, 'authorId', user.id, 'content', safeContent);
    });

    // 7. Extend Chat
    socket.on('request_extension', async (roomId) => {
        const requests = await redis.sadd(`room_extension:${roomId}`, user.id);
        if (requests >= 2) {
            io.to(roomId).emit('chat_extended', { minutes: 15 });
            analytics.recordEvent('chat_extended', user.dept_code, user.batch_year);
            
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
                    const durationSec = Math.round((Date.now() - members.startTime) / 1000);
                    analytics.recordEvent('chat_completed', user.dept_code, user.batch_year, durationSec);
                    applyCooldown(members.user1);
                    applyCooldown(members.user2);
                }
                
                roomTimeouts.delete(roomId);
                roomMembers.delete(roomId);
                handshakeVotes.delete(roomId);
            }, CHAT_DURATION_MS);
            
            roomTimeouts.set(roomId, [warningTimeout, closeTimeout]);
        } else {
            socket.to(roomId).emit('extension_requested_by_partner');
        }
    });

    socket.on('disconnect', async () => {
        await analytics.trackUserDisconnect(socket.id);
        activeUsers.delete(socket.id);
        
        if (user && user.id) {
            await removeUserFromQueues(user.id);
            userSocketMap.delete(user.id);
            for (const [roomId, members] of roomMembers.entries()) {
                if (members.user1 === user.id || members.user2 === user.id) {
                    const existing = roomTimeouts.get(roomId);
                    if (existing) {
                        existing.forEach(clearTimeout);
                    }
                    const durationSec = Math.round((Date.now() - members.startTime) / 1000);
                    analytics.recordEvent('chat_completed', user.dept_code, user.batch_year, durationSec);
                    
                    roomTimeouts.delete(roomId);
                    roomMembers.delete(roomId);
                    handshakeVotes.delete(roomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`🚀 Benchly Backend running on port ${PORT}`);
    console.log(`📊 Analytics REST endpoints active at /api/analytics/realtime and /api/analytics/summary`);
});
