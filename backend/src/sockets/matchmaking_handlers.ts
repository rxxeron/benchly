import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { AnalyticsEngine } from '../analytics';
import {
    enqueue1v1,
    joinOrCreateGroupLounge,
    applyCooldown,
    removeUserFromQueues,
    runBatchMatchTick,
    createMatchedRoom,
    BatchMatchedPair
} from '../matchmaker';
import { getRandomIcebreaker } from '../ewu_helper';
import { AiCampusCompanionEngine } from '../ai_campus_companion';
import { CanonicalHuffmanCodec } from '../algorithms/huffman_codec';
import { supabase } from '../supabase';
import { WebPushService } from '../push_service';
import { CHAT_DURATION_MS, CHAT_WARNING_MS, SocketState } from './state';

const AI_FALLBACK_DELAY_MS = Math.max(25, parseInt(process.env.AI_FALLBACK_SECONDS || '25', 10) || 25) * 1000;

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
            await enqueue1v1(user, seeking, matchMode);
            {
                // Matching happens in the batch loop (startBatchMatchLoop); until then the student waits.
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
                    // 0 removed = the batch matcher already claimed this student for a human match.
                    if ((await removeUserFromQueues(user.id)) === 0) return;

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
                        const openHuffman = CanonicalHuffmanCodec.encodeLiveMessage(opening);
                        socket.emit('new_message', {
                            id: openId,
                            authorAlias: aiSession.aiAlias,
                            huffman: openHuffman,
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
                                huffman: openHuffman,
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

/** How often the waiting pool is solved as one batch. Adds at most this much latency to a match. */
export const BATCH_WINDOW_MS = Math.max(500, parseInt(process.env.MATCH_BATCH_WINDOW_MS || '1500', 10) || 1500);

/** Last ticks that had at least two students waiting; shown in the admin Algorithms tab. */
export const BATCH_STATS_KEY = 'algo:batch_match_ticks';

/**
 * Runs runBatchMatchTick() every BATCH_WINDOW_MS (never overlapping) and starts a chat room for
 * every pair it returns. Call once per server process.
 */
export function startBatchMatchLoop(io: Server, state: SocketState, analytics: AnalyticsEngine, redis: Redis) {
    let running = false;
    const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
            const report = await runBatchMatchTick();
            for (const pair of report.pairs) {
                await startHumanRoom(io, state, analytics, pair).catch(err =>
                    console.error('Failed to start matched room:', err)
                );
            }
            if (report.result) {
                const r = report.result;
                await redis.lpush(
                    BATCH_STATS_KEY,
                    JSON.stringify({
                        at: report.at,
                        poolSize: report.poolSize,
                        matchedStudents: report.pairs.length * 2,
                        solverMatchedStudents: r.matchedStudents,
                        solverWeight: r.totalWeight,
                        greedyMatchedStudents: r.greedyMatchedStudents,
                        greedyWeight: r.greedyTotalWeight,
                        components: r.components
                    })
                );
                await redis.ltrim(BATCH_STATS_KEY, 0, 49);
            }
        } catch (err) {
            console.error('Batch match tick failed:', err);
        } finally {
            running = false;
        }
    }, BATCH_WINDOW_MS);
    timer.unref?.();
    return timer;
}

/** Creates the room for a matched pair, notifies both students and arms the chat timers. */
async function startHumanRoom(io: Server, state: SocketState, analytics: AnalyticsEngine, pair: BatchMatchedPair) {
    const { activeUsers, userSocketMap, roomTimeouts, roomMembers, handshakeVotes, queueTimeouts, saveRoomSession } = state;
    const { a, b, score } = pair;

    const roomId = await createMatchedRoom(a.id, b.id, a.mode || 'campus_adda', score);
    const icebreaker = getRandomIcebreaker();
    const socketA = userSocketMap.get(a.id);
    const socketB = userSocketMap.get(b.id);
    const profileA = socketA ? activeUsers.get(socketA) : null;
    const profileB = socketB ? activeUsers.get(socketB) : null;
    const aliasA = profileA?.alias || a.alias || 'Anonymous Student';
    const aliasB = profileB?.alias || b.alias || 'Anonymous Student';

    for (const sid of [socketA, socketB]) {
        if (!sid) continue;
        io.sockets.sockets.get(sid)?.join(roomId);
        const t = queueTimeouts.get(sid);
        if (t) {
            clearTimeout(t);
            queueTimeouts.delete(sid);
        }
    }

    const emitTo = (userId: string, sid: string | undefined, payload: any) => {
        if (sid) io.to(sid).emit('match_found', payload);
        else io.to(userId).emit('match_found', payload);
    };
    emitTo(a.id, socketA, {
        roomId,
        role: 'creator',
        icebreaker,
        partnerAlias: aliasB,
        partnerBadge: 'EWU Student',
        compatibilityScore: score
    });
    emitTo(b.id, socketB, {
        roomId,
        role: 'joiner',
        icebreaker,
        partnerAlias: aliasA,
        partnerBadge: 'EWU Student',
        compatibilityScore: score
    });
    for (const [uid, partnerAlias] of [[a.id, aliasB], [b.id, aliasA]] as const) {
        WebPushService.sendToUser(supabase, uid, {
            title: '🪑 Bench Match Found!',
            body: `Paired with ${partnerAlias} — tap to start chatting!`,
            tag: 'match_found'
        }).catch(() => {});
    }

    roomMembers.set(roomId, {
        user1: a.id,
        user2: b.id,
        user1Alias: aliasA,
        user2Alias: aliasB,
        startTime: Date.now(),
        user1Messages: 0,
        user2Messages: 0
    });

    analytics.recordEvent('match_created', a.dept, a.batchYear, 0, { seeking: a.seeking, batch: true, score });

    const warningTimeout = setTimeout(() => {
        io.to(roomId).emit('chat_ending_soon');
    }, CHAT_WARNING_MS);

    const closeTimeout = setTimeout(async () => {
        io.to(roomId).emit('chat_closed');
        io.in(roomId).socketsLeave(roomId);
        await saveRoomSession(roomId);
        const durationSec = Math.round((Date.now() - (roomMembers.get(roomId)?.startTime || Date.now())) / 1000);
        analytics.recordEvent('chat_completed', a.dept, a.batchYear, durationSec);
        applyCooldown(a.id);
        applyCooldown(b.id);
        roomTimeouts.delete(roomId);
        roomMembers.delete(roomId);
        handshakeVotes.delete(roomId);
    }, CHAT_DURATION_MS);

    roomTimeouts.set(roomId, [warningTimeout, closeTimeout]);
}
