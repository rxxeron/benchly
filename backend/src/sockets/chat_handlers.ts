import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import type { AnalyticsEngine } from '../analytics';
import { applyCooldown } from '../matchmaker';
import { BenchlyPiiShield } from '../algorithms/pii_shield_engine';
import { CanonicalHuffmanCodec } from '../algorithms/huffman_codec';
import { AiCampusCompanionEngine } from '../ai_campus_companion';
import { CHAT_DURATION_MS, CHAT_WARNING_MS, MAX_MESSAGE_LENGTH, SocketState } from './state';

export function registerChatHandlers(
    io: Server,
    socket: Socket,
    user: any,
    state: SocketState,
    analytics: AnalyticsEngine,
    supabase: SupabaseClient,
    redis: Redis
) {
    const {
        userSocketMap,
        roomTimeouts,
        roomScreenshotVotes,
        roomMembers,
        handshakeVotes,
        aiRoomSessions,
        guessAttempts,
        rateLimitMap,
        isRoomMember,
        saveRoomSession
    } = state;

    socket.on('join_room', async (roomId) => {
        if (typeof roomId !== 'string' || !(await isRoomMember(roomId, user.id))) return;
        socket.join(roomId);
        io.to(roomId).emit('room_ready');
    });

    socket.on('leave_room', async (roomId) => {
        if (typeof roomId !== 'string' || !(await isRoomMember(roomId, user.id))) return;
        socket.leave(roomId);

        if (roomId.startsWith('group_')) {
            await redis.srem(`group_members:${roomId}`, user.id).catch(() => {});
            await redis.hdel(`group_aliases:${roomId}`, user.id).catch(() => {});
            const remaining = await redis.scard(`group_members:${roomId}`).catch(() => 0);
            socket.to(roomId).emit('new_message', {
                id: `sys_leave_${Date.now()}`,
                authorAlias: 'System',
                content: `🪑 ${user?.alias || 'A student'} left the lounge. (${remaining}/5 seated)`,
                timestamp: Date.now(),
                isSystem: true
            });
            return;
        }

        const payload = { alias: user?.alias || 'Your partner', reason: 'left_bench' };
        socket.to(roomId).emit('partner_left', payload);

        const mem = roomMembers.get(roomId);
        if (mem) {
            const partnerId = mem.user1 === user.id ? mem.user2 : mem.user1;
            const partnerSockId = userSocketMap.get(partnerId);
            if (partnerSockId) io.to(partnerSockId).emit('partner_left', payload);
            guessAttempts.delete(`${roomId}:${mem.user1}`);
            guessAttempts.delete(`${roomId}:${mem.user2}`);
        }

        await saveRoomSession(roomId);

        const existing = roomTimeouts.get(roomId);
        if (existing) existing.forEach(clearTimeout);
        roomTimeouts.delete(roomId);
        roomMembers.delete(roomId);
        handshakeVotes.delete(roomId);
        roomScreenshotVotes.delete(roomId);
    });

    socket.on('typing', async (roomId) => {
        if (typeof roomId !== 'string' || !(await isRoomMember(roomId, user.id))) return;
        socket.to(roomId).emit('partner_typing');
    });

    socket.on('stop_typing', async (roomId) => {
        if (typeof roomId !== 'string' || !(await isRoomMember(roomId, user.id))) return;
        socket.to(roomId).emit('partner_stopped_typing');
    });

    socket.on('request_handshake', async (roomId) => {
        if (!user?.id || typeof roomId !== 'string') return;
        if (!(await isRoomMember(roomId, user.id))) return;
        await redis.sadd(`room_handshake:${roomId}`, user.id);
        await redis.expire(`room_handshake:${roomId}`, 3600);
        const votes = await redis.scard(`room_handshake:${roomId}`);

        if (votes >= 2) {
            await redis.set(`room:${roomId}:handshake_agreed`, 'true', 'EX', 3600);
            io.to(roomId).emit('handshake_completed', {
                message: 'Both students agreed to shake hands! You may now share your socials safely.'
            });
        } else {
            socket.to(roomId).emit('partner_requested_handshake');
        }
    });

    socket.on('report_user', async (data) => {
        const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
        const messageId = typeof data?.messageId === 'string' ? data.messageId : null;
        const reason = typeof data?.reason === 'string' ? data.reason.trim().slice(0, 500) : '';
        if (!roomId || !reason || !(await isRoomMember(roomId, user.id))) return;
        try {
            await supabase.from('reports').insert({
                room_id: roomId,
                message_id: messageId,
                reason,
                reporter_id: user.id
            });
            analytics.recordEvent('report_filed', user.dept_code, user.batch_year, 0, { reason });
            socket.emit('report_submitted');
        } catch (err) {
            console.error('Failed to report user', err);
        }
    });

    socket.on('send_message', async (data) => {
        if (user?.muted_until && new Date(user.muted_until).getTime() > Date.now()) {
            const remMs = new Date(user.muted_until).getTime() - Date.now();
            const remHrs = Math.max(1, Math.ceil(remMs / 3600000));
            const msg = `You are temporarily muted for ${remHrs}h due to moderation rules.`;
            socket.emit('error_message', { message: msg });
            socket.emit('new_message', {
                id: `sys_mute_${Date.now()}`,
                authorAlias: 'System',
                content: `🔇 ${msg}`,
                timestamp: Date.now(),
                isSystem: true
            });
            return;
        }

        const rateCount = rateLimitMap.get(socket.id) || 0;
        if (rateCount >= 3) return;
        rateLimitMap.set(socket.id, rateCount + 1);

        const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
        let decodedInput = '';
        if (data?.huffman && typeof data.huffman === 'object') {
            try {
                decodedInput = CanonicalHuffmanCodec.decodeLiveMessage(data.huffman, MAX_MESSAGE_LENGTH + 64);
            } catch {
                socket.emit('error_message', { message: 'Invalid Huffman message packet.' });
                return;
            }
        } else if (typeof data?.content === 'string') {
            decodedInput = data.content;
        }

        const rawContent = decodedInput.trim();
        if (!roomId || !rawContent || Array.from(rawContent).length > MAX_MESSAGE_LENGTH) return;
        if (!(await isRoomMember(roomId, user.id))) return;

        const messageId = randomUUID();
        let safeContent = rawContent;
        let wasPiiShielded = false;
        const isHandshakeAgreed = await redis.get(`room:${roomId}:handshake_agreed`);

        if (!isHandshakeAgreed) {
            const shieldVerdict = BenchlyPiiShield.sanitizeLiveMessage(safeContent, user.id);
            safeContent = shieldVerdict.safeContent;
            if (shieldVerdict.wasModified) {
                wasPiiShielded = true;
                for (const bType of shieldVerdict.blockedTypes) {
                    analytics.recordPiiBlocked(bType, user.dept_code);
                }
                socket.emit('pii_shield_event', {
                    blockedTypes: shieldVerdict.blockedTypes,
                    kmpMatches: shieldVerdict.kmpMatches,
                    lcsSimilarity: shieldVerdict.lcsMaxSimilarity
                });
            }
            if (/https?:\/\/[^\s]+/gi.test(safeContent) || /www\.[^\s]+/gi.test(safeContent)) {
                wasPiiShielded = true;
                safeContent = safeContent
                    .replace(/https?:\/\/[^\s]+/gi, '[CENSORED LINK]')
                    .replace(/www\.[^\s]+/gi, '[CENSORED LINK]');
                analytics.recordPiiBlocked('link', user.dept_code);
            }
            if (/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi.test(safeContent)) {
                wasPiiShielded = true;
                safeContent = safeContent.replace(
                    /\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi,
                    '[CENSORED SOCIAL]'
                );
                analytics.recordPiiBlocked('social', user.dept_code);
            }
        }

        const mem = roomMembers.get(roomId);
        if (mem) {
            if (mem.user1 === user.id) mem.user1Messages++;
            else if (mem.user2 === user.id) mem.user2Messages++;
        }

        const ts = Date.now();
        const huffmanPacket = CanonicalHuffmanCodec.encodeLiveMessage(safeContent);
        socket.emit('new_message', {
            id: messageId,
            authorAlias: user.alias,
            huffman: huffmanPacket,
            piiShielded: wasPiiShielded,
            timestamp: ts,
            isMine: true
        });
        socket.to(roomId).emit('new_message', {
            id: messageId,
            authorAlias: user.alias,
            huffman: huffmanPacket,
            piiShielded: wasPiiShielded,
            timestamp: ts,
            isMine: false
        });

        await redis.rpush(
            `room_messages:${roomId}`,
            JSON.stringify({
                id: messageId,
                author_id: user.id,
                author_alias: user.alias,
                content: safeContent,
                huffman: huffmanPacket,
                pii_shielded: wasPiiShielded,
                timestamp: ts
            })
        );
        await redis.expire(`room_messages:${roomId}`, 7200);

        const currentMsgCount = await redis.llen(`room_messages:${roomId}`);
        if (currentMsgCount >= 100) {
            console.log(`📦 Cache threshold (100 msgs) reached for room ${roomId}. Archiving whole chat to Supabase.`);
            await saveRoomSession(roomId);
        }

        const aiSession = aiRoomSessions.get(roomId);
        if (aiSession && !aiSession.isGenerating) {
            aiSession.isGenerating = true;
            setTimeout(async () => {
                try {
                    if (!aiRoomSessions.has(roomId) || !socket.connected) return;
                    socket.emit('partner_typing', { isTyping: true });
                    const replyText = await AiCampusCompanionEngine.generateReply(aiSession, safeContent);
                    if (!aiRoomSessions.has(roomId) || !socket.connected) return;
                    socket.emit('partner_stopped_typing');

                    const replyId = randomUUID();
                    const replyTs = Date.now();
                    const replyHuffman = CanonicalHuffmanCodec.encodeLiveMessage(replyText);
                    socket.emit('new_message', {
                        id: replyId,
                        authorAlias: aiSession.aiAlias,
                        huffman: replyHuffman,
                        timestamp: replyTs,
                        isMine: false
                    });
                    const mRef = roomMembers.get(roomId);
                    if (mRef) mRef.user2Messages++;
                    await redis.rpush(
                        `room_messages:${roomId}`,
                        JSON.stringify({
                            id: replyId,
                            author_id: aiSession.aiUserId,
                            author_alias: aiSession.aiAlias,
                            content: replyText,
                            huffman: replyHuffman,
                            timestamp: replyTs
                        })
                    );
                    await redis.expire(`room_messages:${roomId}`, 7200);
                } finally {
                    aiSession.isGenerating = false;
                }
            }, 900);
        }
    });

    socket.on('screenshot_taken', async (roomId: string) => {
        if (!user?.id || typeof roomId !== 'string') return;
        if (!(await isRoomMember(roomId, user.id))) return;
        io.to(roomId).emit('new_message', {
            id: `ss_notify_${Date.now()}`,
            authorAlias: 'System',
            content: `📸 ${user.alias || 'Your partner'} took a screenshot of this chat!`,
            timestamp: Date.now(),
            isSystem: true
        });
    });

    socket.on('request_extension', async (roomId) => {
        if (!user?.id || typeof roomId !== 'string') return;
        if (!(await isRoomMember(roomId, user.id))) return;
        await redis.sadd(`room_extension:${roomId}`, user.id);
        await redis.expire(`room_extension:${roomId}`, 3600);
        const votes = await redis.scard(`room_extension:${roomId}`);

        if (votes >= 2) {
            io.to(roomId).emit('chat_extended', { minutes: 15 });
            analytics.recordEvent('chat_extended', user.dept_code, user.batch_year);

            const existing = roomTimeouts.get(roomId);
            if (existing) existing.forEach(clearTimeout);

            const warningTimeout = setTimeout(() => io.to(roomId).emit('chat_ending_soon'), CHAT_WARNING_MS);
            const closeTimeout = setTimeout(async () => {
                io.to(roomId).emit('chat_closed');
                io.in(roomId).socketsLeave(roomId);
                await saveRoomSession(roomId);
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
}
