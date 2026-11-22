import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { AnalyticsEngine } from '../analytics';
import { findOrCreate1v1Match, joinOrCreateGroupLounge, applyCooldown, removeUserFromQueues } from '../matchmaker';
import { getRandomIcebreaker } from '../ewu_helper';
import { AiCampusCompanionEngine } from '../ai_campus_companion';
import { supabase } from '../supabase';
import { WebPushService } from '../push_service';
import { CHAT_DURATION_MS, CHAT_WARNING_MS, SocketState } from './state';

const AI_FALLBACK_DELAY_MS = Math.max(4, parseInt(process.env.AI_FALLBACK_SECONDS || '12', 10) || 12) * 1000;

export function registerMatchmakingHandlers(
    io: Server,
    socket: Socket,
    user: any,
    state: SocketState,
    analytics: AnalyticsEngine,
    redis: Redis
) {
    const {
        activeUsers,
        userSocketMap,
        roomTimeouts,
        roomMembers,
        handshakeVotes,
        queueTimeouts,
        aiRoomSessions,
        saveRoomSession
    } = state;

    socket.on('join_1v1_queue', async (data) => {
        const userGender = (user.gender || 'male').toLowerCase();
        const requestedSeeking = (data?.seeking || 'anyone').toString().toLowerCase();
        const seeking =
            userGender === 'female' && (requestedSeeking === 'female' || requestedSeeking === 'girls')
                ? 'female'
                : 'anyone';
        const matchMode = data?.mode || 'campus_adda';

        try {
            await removeUserFromQueues(user.id);
            const match = await findOrCreate1v1Match(user, seeking, matchMode);

            if (match.roomId) {
                const icebreaker = getRandomIcebreaker();
                socket.join(match.roomId);

                const otherSocketId = userSocketMap.get(match.matchedUser!);
                const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
                if (otherSocket) otherSocket.join(match.roomId);
                const otherProfile = otherSocketId ? activeUsers.get(otherSocketId) : null;

                socket.emit('match_found', {
                    roomId: match.roomId,
                    role: 'creator',
                    icebreaker,
                    partnerAlias: otherProfile?.alias || 'Anonymous Student',
                    partnerBadge: 'EWU Student'
                });

                const joinerPayload = {
                    roomId: match.roomId,
                    role: 'joiner',
                    icebreaker,
                    partnerAlias: user.alias || 'Anonymous Student',
                    partnerBadge: 'EWU Student'
                };
                io.to(match.matchedUser!).emit('match_found', joinerPayload);
                if (otherSocketId) io.to(otherSocketId).emit('match_found', joinerPayload);
                WebPushService.sendToUser(supabase, match.matchedUser!, {
                    title: '🪑 Bench Match Found!',
                    body: `Paired with ${user.alias || 'an EWU classmate'} — tap to start chatting!`,
                    tag: 'match_found'
                }).catch(() => {});

                const tCreator = queueTimeouts.get(socket.id);
                if (tCreator) {
                    clearTimeout(tCreator);
                    queueTimeouts.delete(socket.id);
                }
                if (otherSocketId) {
                    const tJoiner = queueTimeouts.get(otherSocketId);
                    if (tJoiner) {
                        clearTimeout(tJoiner);
                        queueTimeouts.delete(otherSocketId);
                    }
                }

                roomMembers.set(match.roomId, {
                    user1: user.id,
                    user2: match.matchedUser!,
                    user1Alias: user.alias || 'Anonymous Student',
                    user2Alias: otherProfile?.alias || 'Anonymous Student',
                    startTime: Date.now(),
                    user1Messages: 0,
                    user2Messages: 0
                });

                analytics.recordEvent('match_created', user.dept_code, user.batch_year, 0, { seeking });

                const warningTimeout = setTimeout(() => {
                    io.to(match.roomId!).emit('chat_ending_soon');
                }, CHAT_WARNING_MS);

                const closeTimeout = setTimeout(async () => {
                    io.to(match.roomId!).emit('chat_closed');
                    io.in(match.roomId!).socketsLeave(match.roomId!);

                    await saveRoomSession(match.roomId!);

                    const durationSec = Math.round(
                        (Date.now() - (roomMembers.get(match.roomId!)?.startTime || Date.now())) / 1000
                    );
                    analytics.recordEvent('chat_completed', user.dept_code, user.batch_year, durationSec);

                    applyCooldown(user.id);
                    applyCooldown(match.matchedUser!);
                    roomTimeouts.delete(match.roomId!);
                    roomMembers.delete(match.roomId!);
                    handshakeVotes.delete(match.roomId!);
                }, CHAT_DURATION_MS);

                roomTimeouts.set(match.roomId, [warningTimeout, closeTimeout]);
            } else {
                socket.emit('waiting_in_queue');
                socket.join(user.id);

                const existingT = queueTimeouts.get(socket.id);
                if (existingT) clearTimeout(existingT);

                const timeout = setTimeout(async () => {
                    queueTimeouts.delete(socket.id);
                    if (!socket.connected) {
                        await removeUserFromQueues(user.id);
                        return;
                    }
                    await removeUserFromQueues(user.id);

                    const aiRoomId = randomUUID();
                    const icebreaker = getRandomIcebreaker();
                    const aiSession = AiCampusCompanionEngine.createSession(aiRoomId, icebreaker, matchMode);
                    aiRoomSessions.set(aiRoomId, aiSession);

                    socket.join(aiRoomId);
                    roomMembers.set(aiRoomId, {
                        user1: user.id,
                        user2: aiSession.aiUserId,
                        user1Alias: user.alias || 'Anonymous Student',
                        user2Alias: aiSession.aiAlias,
                        startTime: Date.now(),
                        user1Messages: 0,
                        user2Messages: 0
                    });

                    await redis.hset(`room:${aiRoomId}`, {
                        users: JSON.stringify([user.id, aiSession.aiUserId]),
                        mode: matchMode,
                        isAiFallback: 'true',
                        createdAt: Date.now()
                    });
                    await redis.expire(`room:${aiRoomId}`, 1800);

                    socket.emit('match_found', {
                        roomId: aiRoomId,
                        role: 'creator',
                        icebreaker,
                        partnerAlias: aiSession.aiAlias,
                        partnerBadge: 'EWU Student'
                    });

                    analytics.recordEvent('match_created', user.dept_code, user.batch_year, 0, {
                        seeking,
                        aiFallback: true
                    });

                    const warningTimeout = setTimeout(() => {
                        io.to(aiRoomId).emit('chat_ending_soon');
                    }, CHAT_WARNING_MS);

                    const closeTimeout = setTimeout(async () => {
                        io.to(aiRoomId).emit('chat_closed');
                        io.in(aiRoomId).socketsLeave(aiRoomId);
                        await saveRoomSession(aiRoomId);
                        applyCooldown(user.id);
                        roomTimeouts.delete(aiRoomId);
                        roomMembers.delete(aiRoomId);
                        aiRoomSessions.delete(aiRoomId);
                        handshakeVotes.delete(aiRoomId);
                    }, CHAT_DURATION_MS);

                    roomTimeouts.set(aiRoomId, [warningTimeout, closeTimeout]);

                    setTimeout(async () => {
                        if (!aiRoomSessions.has(aiRoomId) || !socket.connected) return;
                        socket.emit('partner_typing', { isTyping: true });
                        const opening = await AiCampusCompanionEngine.generateOpeningLine(aiSession);
                        if (!aiRoomSessions.has(aiRoomId) || !socket.connected) return;
                        socket.emit('partner_stopped_typing');
                        const openId = randomUUID();
                        const ts = Date.now();
                        socket.emit('new_message', {
                            id: openId,
                            authorAlias: aiSession.aiAlias,
                            content: opening,
                            timestamp: ts,
                            isMine: false
                        });
                        const mem = roomMembers.get(aiRoomId);
                        if (mem) mem.user2Messages++;
                        await redis.rpush(
                            `room_messages:${aiRoomId}`,
                            JSON.stringify({
                                id: openId,
                                author_id: aiSession.aiUserId,
                                author_alias: aiSession.aiAlias,
                                content: opening,
                                timestamp: ts
                            })
                        );
                        await redis.expire(`room_messages:${aiRoomId}`, 7200);
                    }, 1600);
                }, AI_FALLBACK_DELAY_MS);

                queueTimeouts.set(socket.id, timeout);
            }
        } catch (error: any) {
            socket.emit('error', { message: error.message });
        }
    });

    socket.on('cancel_1v1_queue', async () => {
        const t = queueTimeouts.get(socket.id);
        if (t) {
            clearTimeout(t);
            queueTimeouts.delete(socket.id);
        }
        if (user?.id) await removeUserFromQueues(user.id);
    });

    socket.on('join_group_lounge', async (data, callback) => {
        const topic = (data?.topic || 'Cafeteria Hangout').trim();
        try {
            await removeUserFromQueues(user.id);
            const lounge = await joinOrCreateGroupLounge(user, topic);
            socket.join(lounge.roomId);

            const icebreaker = getRandomIcebreaker();
            socket.emit('group_lounge_joined', {
                roomId: lounge.roomId,
                topic: lounge.topic,
                membersCount: lounge.membersCount,
                memberAliases: lounge.memberAliases,
                icebreaker
            });

            socket.to(lounge.roomId).emit('new_message', {
                id: `sys_join_${Date.now()}`,
                authorAlias: 'System',
                content: `🪑 ${user.alias} (${user.badge || 'EWU'}) pulled up a chair in ${lounge.topic}! (${lounge.membersCount}/5 seated)`,
                timestamp: Date.now(),
                isSystem: true
            });

            analytics.recordEvent('match_created', user.dept_code, user.batch_year, 0, {
                type: 'group_lounge',
                topic: lounge.topic
            });

            if (callback) callback({ success: true, ...lounge });
        } catch (err: any) {
            socket.emit('error', { message: err.message });
            if (callback) callback({ success: false, error: err.message });
        }
    });
}
