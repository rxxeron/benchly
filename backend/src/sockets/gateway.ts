import type { Server } from 'socket.io';
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import { authenticateSocket } from '../supabase';
import { applyCooldown, removeUserFromQueues } from '../matchmaker';
import type { AnalyticsEngine } from '../analytics';
import { getRandomIcebreaker } from '../ewu_helper';
import { generateServerNickname } from '../nickname_engine';
import { WebPushService } from '../push_service';
import { CHAT_DURATION_MS, CHAT_WARNING_MS, DISCONNECT_GRACE_MS, SocketState } from './state';
import { registerMatchmakingHandlers, startBatchMatchLoop } from './matchmaking_handlers';
import { registerGameHandlers } from './game_handlers';
import { registerChatHandlers } from './chat_handlers';

export function registerSocketGateway(
    io: Server,
    state: SocketState,
    deps: { analytics: AnalyticsEngine; supabase: SupabaseClient; redis: Redis }
) {
    const { analytics, supabase, redis } = deps;
    const {
        activeUsers,
        userSocketMap,
        roomTimeouts,
        roomScreenshotVotes,
        disconnectGraceTimers,
        roomMembers,
        handshakeVotes,
        queueTimeouts,
        saveRoomSession
    } = state;

    startBatchMatchLoop(io, state, analytics, redis);

    io.on('connection', async (socket) => {
        await analytics.trackUserConnect(socket.id);

        const token = socket.handshake.auth.token;
        if (!token) return socket.disconnect();

        try {
            const profile = await authenticateSocket(token);
            activeUsers.set(socket.id, profile);
            userSocketMap.set(profile.id, socket.id);
            socket.join(profile.id);

            socket.emit('authenticated', {
                alias: profile.alias,
                streak: profile.streak_count,
                badge: profile.badge,
                dept: profile.dept_code,
                aliasRotationDue: profile.aliasRotationDue,
                aliasChangedAt: profile.alias_changed_at,
                aliasChangeCount: profile.alias_change_count
            });

            io.emit('campus_pulse', { onlineUsers: activeUsers.size });

            const graceTimer = disconnectGraceTimers.get(profile.id);
            if (graceTimer) {
                clearTimeout(graceTimer);
                disconnectGraceTimers.delete(profile.id);
            }

            // Auto-resume active 1v1 bench session after browser refresh / blip
            for (const [activeRoomId, members] of roomMembers.entries()) {
                if (members.user1 === profile.id || members.user2 === profile.id) {
                    socket.join(activeRoomId);
                    const isUser1 = members.user1 === profile.id;
                    const partnerAlias = (isUser1 ? members.user2Alias : members.user1Alias) || 'Anonymous Student';
                    const rawMsgs = await redis.lrange(`room_messages:${activeRoomId}`, 0, -1);
                    const restoredMessages = rawMsgs
                        .map((m: string) => {
                            try {
                                const parsed = JSON.parse(m);
                                return {
                                    id: parsed.id,
                                    authorAlias: parsed.author_alias || parsed.authorAlias || 'Anonymous',
                                    content: parsed.content || '',
                                    timestamp: parsed.timestamp || Date.now()
                                };
                            } catch {
                                return null;
                            }
                        })
                        .filter(Boolean);

                    const elapsedSec = Math.floor((Date.now() - members.startTime) / 1000);
                    const timeLeftSeconds = Math.max(30, Math.floor(CHAT_DURATION_MS / 1000) - elapsedSec);
                    const ssVotes = roomScreenshotVotes.get(activeRoomId) || new Set<string>();
                    const partnerId = isUser1 ? members.user2 : members.user1;

                    socket.emit('session_resumed', {
                        roomId: activeRoomId,
                        partnerAlias,
                        partnerBadge: 'EWU Student',
                        messages: restoredMessages,
                        timeLeftSeconds,
                        meAllowedSs: ssVotes.has(profile.id),
                        partnerAllowedSs: ssVotes.has(partnerId)
                    });
                    socket.to(activeRoomId).emit('partner_reconnected', { alias: profile.alias || 'Your partner' });
                    console.log(`🔄 Auto-resumed room ${activeRoomId} for ${profile.alias} after refresh (${restoredMessages.length} msgs)`);
                    break;
                }
            }
        } catch {
            console.error('Auth failed for socket', socket.id);
            return socket.disconnect();
        }

        const user = activeUsers.get(socket.id);

        socket.on('rotate_alias', async (data, callback) => {
            try {
                const oldAlias = user.alias;
                let nextAlias = (data?.newAlias || '').toString().trim();
                if (!nextAlias || nextAlias.length < 3) nextAlias = generateServerNickname();

                const { error: upErr } = await supabase
                    .from('users')
                    .update({
                        generated_alias: nextAlias,
                        alias_changed_at: new Date().toISOString(),
                        alias_change_count: (user.alias_change_count || 0) + 1
                    })
                    .eq('id', user.id);

                if (upErr) throw upErr;

                await supabase.from('alias_history').insert({
                    user_id: user.id,
                    old_alias: oldAlias || 'Anonymous',
                    new_alias: nextAlias,
                    change_type: data?.changeType || 'manual'
                });

                user.alias = nextAlias;
                user.alias_change_count = (user.alias_change_count || 0) + 1;
                activeUsers.set(socket.id, user);
                if (callback) callback({ success: true, newAlias: nextAlias });
                socket.emit('alias_updated', { newAlias: nextAlias });
            } catch (e: any) {
                if (callback) callback({ success: false, error: e.message });
                socket.emit('alias_error', { message: e.message });
            }
        });

        socket.on('create_invite_bench', async (_, callback) => {
            try {
                const code = randomBytes(6).toString('base64url').toLowerCase();
                const roomId = `invite_room_${code}`;

                await redis.set(
                    `bench_invite:${code}`,
                    JSON.stringify({
                        roomId,
                        code,
                        creatorId: user.id,
                        creatorAlias: user.alias || 'Anonymous Student',
                        creatorBadge: user.badge || 'EWU Student',
                        createdAt: Date.now()
                    }),
                    'EX',
                    1800
                );
                socket.join(roomId);

                await supabase.from('referrals').insert({ inviter_id: user.id, short_code: code, status: 'created' });
                const inviteUrl = `https://app.benchly.live/?invite=${code}`;
                if (callback) callback({ success: true, code, inviteUrl, roomId });
                socket.emit('invite_bench_created', { code, inviteUrl, roomId });
            } catch (e: any) {
                if (callback) callback({ success: false, error: e.message });
            }
        });

        socket.on('join_invite_bench', async (data, callback) => {
            try {
                const code = (data?.code || '').trim().toLowerCase();
                if (!code) throw new Error('Invite code required');

                const raw = await redis.get(`bench_invite:${code}`);
                if (!raw) {
                    socket.emit('invite_error', { message: 'This bench invite has expired or already ended.' });
                    if (callback) callback({ success: false, message: 'Invite expired or invalid' });
                    return;
                }

                const invite = JSON.parse(raw);
                if (invite.creatorId === user.id) {
                    socket.emit('invite_error', { message: 'You cannot join your own bench invite.' });
                    if (callback) callback({ success: false, message: 'Cannot join own bench' });
                    return;
                }

                await redis.del(`bench_invite:${code}`);
                socket.join(invite.roomId);
                await supabase.rpc('record_referral_join', { p_short_code: code, p_invitee_id: user.id });

                const icebreaker = getRandomIcebreaker();
                io.to(invite.creatorId).emit('match_found', {
                    roomId: invite.roomId,
                    role: 'creator',
                    icebreaker,
                    partnerAlias: user.alias || 'Anonymous Student',
                    partnerBadge: 'EWU Student',
                    isDirectInvite: true
                });
                WebPushService.sendToUser(supabase, invite.creatorId, {
                    title: '🪑 Friend Joined Your Bench!',
                    body: `${user.alias || 'Your friend'} just opened your invite link — tap to chat!`,
                    tag: 'invite_join'
                }).catch(() => {});
                socket.emit('match_found', {
                    roomId: invite.roomId,
                    role: 'joiner',
                    icebreaker,
                    partnerAlias: invite.creatorAlias || 'Anonymous Student',
                    partnerBadge: 'EWU Student',
                    isDirectInvite: true
                });

                roomMembers.set(invite.roomId, {
                    user1: invite.creatorId,
                    user2: user.id,
                    user1Alias: invite.creatorAlias,
                    user2Alias: user.alias,
                    startTime: Date.now(),
                    user1Messages: 0,
                    user2Messages: 0
                });

                analytics.recordEvent('match_created', user.dept_code, user.batch_year, 0, { type: 'invite' });

                const warningTimeout = setTimeout(() => io.to(invite.roomId).emit('chat_ending_soon'), CHAT_WARNING_MS);
                const closeTimeout = setTimeout(async () => {
                    io.to(invite.roomId).emit('chat_closed');
                    io.in(invite.roomId).socketsLeave(invite.roomId);
                    await saveRoomSession(invite.roomId);
                    applyCooldown(invite.creatorId);
                    applyCooldown(user.id);
                    roomTimeouts.delete(invite.roomId);
                    roomMembers.delete(invite.roomId);
                    handshakeVotes.delete(invite.roomId);
                }, CHAT_DURATION_MS);

                roomTimeouts.set(invite.roomId, [warningTimeout, closeTimeout]);
                if (callback) callback({ success: true, roomId: invite.roomId });
            } catch (e: any) {
                socket.emit('invite_error', { message: e.message });
                if (callback) callback({ success: false, error: e.message });
            }
        });

        registerMatchmakingHandlers(io, socket, user, state, analytics, redis);
        registerGameHandlers(io, socket, user, state, supabase);
        registerChatHandlers(io, socket, user, state, analytics, supabase, redis);

        socket.on('disconnect', async () => {
            const qT = queueTimeouts.get(socket.id);
            if (qT) {
                clearTimeout(qT);
                queueTimeouts.delete(socket.id);
            }

            await analytics.trackUserDisconnect(socket.id);
            activeUsers.delete(socket.id);
            io.emit('campus_pulse', { onlineUsers: activeUsers.size });

            if (user?.id) {
                await removeUserFromQueues(user.id);
                if (userSocketMap.get(user.id) === socket.id) userSocketMap.delete(user.id);

                for (const [roomId, members] of roomMembers.entries()) {
                    if (members.user1 === user.id || members.user2 === user.id) {
                        socket.to(roomId).emit('partner_reconnecting', { alias: user?.alias || 'Your partner' });

                        const existingGrace = disconnectGraceTimers.get(user.id);
                        if (existingGrace) clearTimeout(existingGrace);

                        const timer = setTimeout(async () => {
                            disconnectGraceTimers.delete(user.id);
                            if (userSocketMap.has(user.id)) return;
                            if (!roomMembers.has(roomId)) return;

                            io.to(roomId).emit('partner_left', {
                                alias: user?.alias || 'Your partner',
                                reason: 'disconnected'
                            });
                            await saveRoomSession(roomId);

                            const existing = roomTimeouts.get(roomId);
                            if (existing) existing.forEach(clearTimeout);

                            const durationSec = Math.round((Date.now() - members.startTime) / 1000);
                            analytics.recordEvent('chat_completed', user.dept_code, user.batch_year, durationSec);

                            roomTimeouts.delete(roomId);
                            roomMembers.delete(roomId);
                            handshakeVotes.delete(roomId);
                            roomScreenshotVotes.delete(roomId);
                        }, DISCONNECT_GRACE_MS);

                        disconnectGraceTimers.set(user.id, timer);
                    }
                }
            }
        });
    });
}
