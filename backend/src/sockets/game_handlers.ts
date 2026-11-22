import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GUESS_COOLDOWN_MS, MAX_GUESSES_PER_ROOM, SocketState } from './state';

export function registerGameHandlers(
    io: Server,
    socket: Socket,
    user: any,
    state: SocketState,
    supabase: SupabaseClient
) {
    const {
        activeUsers,
        userSocketMap,
        roomMembers,
        aiRoomSessions,
        pendingGuessReveals,
        guessAttempts
    } = state;

    socket.on('submit_guess', async (data, callback) => {
        try {
            const roomId = (data?.roomId || '').toString();
            const field = (data?.field || '').toString();
            const guessRaw = (data?.guess || '').toString().trim().slice(0, 60);
            if (!roomId || !field || !guessRaw) return;

            const members = roomMembers.get(roomId);
            if (!members || (members.user1 !== user.id && members.user2 !== user.id)) {
                if (callback) callback({ success: false, message: 'Forbidden.' });
                return;
            }

            const attemptKey = `${roomId}:${user.id}`;
            const now = Date.now();
            const stats = guessAttempts.get(attemptKey) || { count: 0, lastAt: 0 };
            if (now - stats.lastAt < GUESS_COOLDOWN_MS) {
                if (callback) callback({ success: false, message: 'Slow down a moment before guessing again.' });
                return;
            }
            if (stats.count >= MAX_GUESSES_PER_ROOM) {
                socket.emit('guess_feedback', {
                    ok: false,
                    message: `You've used all ${MAX_GUESSES_PER_ROOM} guesses for this bench session.`
                });
                if (callback) callback({ success: false, message: 'Max guesses reached for this session.' });
                return;
            }
            stats.count += 1;
            stats.lastAt = now;
            guessAttempts.set(attemptKey, stats);

            const partnerUserId = members.user1 === user.id ? members.user2 : members.user1;
            const partnerSocketId = userSocketMap.get(partnerUserId);
            const partner = partnerSocketId ? activeUsers.get(partnerSocketId) : null;

            if (!partner) {
                if (callback) callback({ success: false, message: 'Partner is offline.' });
                return;
            }

            if (partner.allow_guessing === false) {
                socket.emit('guess_feedback', {
                    ok: false,
                    message: `${partner.alias} has guessing turned off for this session.`
                });
                if (callback) callback({ success: false, message: 'Guessing disabled by partner.' });
                return;
            }

            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            let matched = false;
            let fieldLabel = '';
            let revealedValue = '';
            let hint = '';

            if (field === 'dept') {
                fieldLabel = 'Department';
                const actual = (partner.dept_code || '').toString();
                if (!actual) {
                    socket.emit('guess_feedback', { ok: false, message: `${partner.alias} hasn't set their department yet.` });
                    return;
                }
                matched = norm(guessRaw) === norm(actual);
                revealedValue = actual;
            } else if (field === 'current_semester') {
                fieldLabel = 'Current Semester';
                const actual = (partner.current_semester || '').toString();
                if (!actual) {
                    socket.emit('guess_feedback', { ok: false, message: `${partner.alias} hasn't set their current semester yet.` });
                    return;
                }
                const actualNum = actual.match(/\d+/)?.[0];
                const guessNum = guessRaw.match(/\d+/)?.[0];
                matched = norm(guessRaw) === norm(actual) || (Boolean(actualNum) && actualNum === guessNum);
                revealedValue = actual;
            } else if (field === 'admitted_semester') {
                fieldLabel = 'Admitted Semester';
                const actual = (partner.admitted_semester || '').toString();
                if (!actual) {
                    socket.emit('guess_feedback', { ok: false, message: `${partner.alias} hasn't set their admitted semester yet.` });
                    return;
                }
                matched = norm(guessRaw) === norm(actual);
                revealedValue = actual;
            } else if (field === 'age') {
                fieldLabel = 'Age';
                const actual = partner.real_age ? Number(partner.real_age) : null;
                const guessNum = parseInt(guessRaw, 10);
                if (!actual) {
                    socket.emit('guess_feedback', { ok: false, message: `${partner.alias} hasn't set their age yet.` });
                    return;
                }
                if (guessNum === actual) {
                    matched = true;
                    revealedValue = `${actual}`;
                } else if (!isNaN(guessNum)) {
                    hint = guessNum < actual ? ' (Hint: Higher! ⬆️)' : ' (Hint: Lower! ⬇️)';
                }
            } else if (field === 'real_name') {
                fieldLabel = 'Real Name';
                const actual = (partner.real_name || '').toString().trim();
                if (!actual) {
                    socket.emit('guess_feedback', { ok: false, message: `${partner.alias} kept their real name secret.` });
                    return;
                }
                const firstWord = actual.split(/\s+/)[0];
                matched = norm(guessRaw) === norm(actual) || (firstWord.length >= 3 && norm(guessRaw) === norm(firstWord));
                revealedValue = actual;
            } else {
                return;
            }

            if (matched) {
                const revealId = randomUUID();
                pendingGuessReveals.set(revealId, {
                    roomId,
                    guesserId: user.id,
                    guesserSocketId: socket.id,
                    guesserAlias: user.alias || 'Anonymous Student',
                    partnerId: partnerUserId,
                    partnerAlias: partner.alias || 'Anonymous Student',
                    field,
                    fieldLabel,
                    revealedValue,
                    createdAt: Date.now()
                });

                const pendingMsg = `🎲 ${user.alias} submitted a ${fieldLabel} guess — waiting for ${partner.alias} to approve reveal...`;
                socket.emit('guess_feedback', { ok: true, message: pendingMsg });

                if (partnerSocketId) {
                    io.to(partnerSocketId).emit('guess_reveal_request', {
                        revealId,
                        roomId,
                        guesserAlias: user.alias || 'Anonymous Student',
                        fieldLabel,
                        guessedValue: guessRaw,
                        actualValue: revealedValue
                    });
                }

                if (callback) callback({ success: true, pendingApproval: true, message: pendingMsg });
                return;
            }

            const sysText = `🎲 ${user.alias} guessed ${partner.alias}'s ${fieldLabel} is "${guessRaw}" — nope!${hint}`;
            io.to(roomId).emit('new_message', {
                id: `guess_${Date.now()}`,
                authorAlias: 'System',
                content: sysText,
                timestamp: Date.now(),
                isSystem: true,
                isGuessHit: false
            });

            if (callback) callback({ success: true, matched: false, message: sysText });
        } catch (e: any) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    socket.on('respond_guess_reveal', async (data, callback) => {
        try {
            const revealId = (data?.revealId || '').toString();
            const approved = data?.approved === true;
            const pending = pendingGuessReveals.get(revealId);
            if (!pending || pending.partnerId !== user.id) {
                if (callback) callback({ success: false, message: 'Reveal request expired or unauthorized.' });
                return;
            }
            pendingGuessReveals.delete(revealId);

            if (approved) {
                const sysText = `🎯 Spot on! ${pending.partnerAlias} approved revealing their ${pending.fieldLabel}: ${pending.revealedValue}!`;
                io.to(pending.roomId).emit('new_message', {
                    id: `guess_approved_${Date.now()}`,
                    authorAlias: 'System',
                    content: sysText,
                    timestamp: Date.now(),
                    isSystem: true,
                    isGuessHit: true
                });
                if (callback) callback({ success: true, approved: true });
            } else {
                const declinedMsg = `🔒 ${pending.partnerAlias} chose to keep their ${pending.fieldLabel} private for now.`;
                io.to(pending.guesserSocketId).emit('guess_feedback', { ok: false, message: declinedMsg });
                if (callback) callback({ success: true, approved: false });
            }
        } catch (e: any) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    socket.on('get_partner_card', async (data, callback) => {
        try {
            const roomId = (data?.roomId || '').toString();
            if (!roomId || !callback) return;

            const members = roomMembers.get(roomId);
            if (!members || (members.user1 !== user.id && members.user2 !== user.id)) {
                return callback({ success: false, error: 'Forbidden' });
            }

            const partnerUserId = members.user1 === user.id ? members.user2 : members.user1;
            const partnerAlias = members.user1 === user.id ? members.user2Alias : members.user1Alias;

            const aiSession = aiRoomSessions.get(roomId);
            if (aiSession && partnerUserId === aiSession.aiUserId) {
                return callback({
                    success: true,
                    card: {
                        alias: aiSession.aiAlias,
                        badge: 'Verified EWU Student',
                        successfulChats: 14,
                        streakDays: 5,
                        hasReports: false,
                        reportStatus: 'Clean Record',
                        primaryAvatarEmoji: '☕',
                        equippedAvatars: [
                            { id: 'avatar_aftabnagar_cha', name: 'Aftabnagar Cha Master', icon_emoji: '☕', category: 'EWU Avatar' }
                        ]
                    }
                });
            }

            const [uRes, sessCountRes, perksRes, repRes] = await Promise.all([
                supabase.from('users').select('streak_count, total_chats, is_banned').eq('id', partnerUserId).maybeSingle(),
                supabase.from('chat_sessions').select('id', { count: 'exact', head: true }).eq('user_id', partnerUserId),
                supabase
                    .from('user_perks')
                    .select('perk_id, is_equipped, stone_perks(id, name, icon_emoji, category)')
                    .eq('user_id', partnerUserId)
                    .eq('is_equipped', true),
                supabase
                    .from('reports')
                    .select('id', { count: 'exact', head: true })
                    .eq('resolved', false)
                    .ilike('reason', `%${partnerAlias}%`)
            ]);

            const equippedAvatars = (perksRes.data || []).map((row: any) => row.stone_perks).filter(Boolean);
            const avatarFirst =
                equippedAvatars.find((p: any) => String(p.category || '').toLowerCase().includes('avatar')) ||
                equippedAvatars[0] ||
                null;
            const successfulChats = Math.max(Number(sessCountRes.count || 0), Number(uRes.data?.total_chats || 0));
            const hasReports = (repRes.count || 0) > 0 || uRes.data?.is_banned === true;

            return callback({
                success: true,
                card: {
                    alias: partnerAlias,
                    badge: 'Verified EWU Student',
                    successfulChats,
                    streakDays: Number(uRes.data?.streak_count || 0),
                    hasReports,
                    reportStatus: hasReports ? 'Flagged / Under Review' : 'Clean Record',
                    primaryAvatarEmoji: avatarFirst?.icon_emoji || null,
                    equippedAvatars
                }
            });
        } catch (err: any) {
            if (callback) callback({ success: false, error: err?.message || 'Failed to load profile card' });
        }
    });
}
