import express from 'express';
import type { AdminHelpers, AdminRoutesDeps } from './helpers';
import { CanonicalHuffmanCodec, CanonicalSymbolOrder, EncryptedHuffmanArchive } from '../../algorithms/huffman_codec';

export function registerAdminModerationRoutes(
    app: express.Express,
    deps: AdminRoutesDeps,
    helpers: AdminHelpers
) {
    const { supabase, activeUsers, userSocketMap, ADMIN_EMAIL } = deps;
    const { requireAdmin, logAdminAction } = helpers;

    app.get('/api/admin/rooms', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10) || 50));
            const { data, error } = await supabase
                .from('room_conversations')
                .select(
                    'room_id, user1_id, user2_id, user1_alias, user2_alias, messages_count, duration_seconds, handshake_agreed, compression_savings_pct, huffman_meta, closed_at'
                )
                .order('closed_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            const rooms = (data || []).map((row: any) => ({
                roomId: row.room_id,
                user1Alias: row.user1_alias,
                user2Alias: row.user2_alias,
                isAiRoom: !row.user2_id,
                messagesCount: row.messages_count,
                durationSeconds: row.duration_seconds,
                handshakeAgreed: row.handshake_agreed,
                compressionSavingsPct: Number(row.compression_savings_pct || row.huffman_meta?.savingsPercent || 0),
                shannonEntropy: row.huffman_meta?.shannonEntropy ?? null,
                averageCodeLength: row.huffman_meta?.averageCodeLength ?? null,
                shannonVerified: row.huffman_meta?.shannonVerified ?? null,
                encrypted: row.huffman_meta?.algorithm === 'canonical-huffman+aes-256-gcm',
                closedAt: row.closed_at
            }));

            res.json({ rooms });
        } catch (err: any) {
            console.error('Admin rooms list error:', err);
            res.status(500).json({ error: 'Failed to list archived rooms' });
        }
    });

    app.get('/api/admin/rooms/:roomId/inspect', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const roomId = req.params.roomId;
            const { data: row, error } = await supabase
                .from('room_conversations')
                .select('*')
                .eq('room_id', roomId)
                .maybeSingle();

            if (error) throw error;
            if (!row) return res.status(404).json({ error: 'Archived room not found' });

            let rawTranscriptJson = '';
            let messages: any[] = [];
            let codeLengths: Record<string, number> = {};
            let symbolOrder: CanonicalSymbolOrder = 'codepoint';
            let stats: any = {};

            const meta = row.huffman_meta as EncryptedHuffmanArchive | null;
            if (meta && meta.algorithm === 'canonical-huffman+aes-256-gcm' && meta.ciphertextBase64) {
                rawTranscriptJson = CanonicalHuffmanCodec.openEncryptedHuffmanArchive(meta);
                messages = JSON.parse(rawTranscriptJson || '[]');
                codeLengths = meta.codeLengths || {};
                symbolOrder = meta.symbolOrder ?? 'legacy-locale';
                stats = {
                    algorithm: meta.algorithm,
                    encoding: meta.encoding ?? 'huffman',
                    originalBytes: meta.originalBytes,
                    compressedBytes: meta.compressedBytes,
                    codebookBytes: meta.codebookBytes ?? Buffer.byteLength(JSON.stringify(codeLengths), 'utf8'),
                    savingsPercent: meta.savingsPercent,
                    // Archives written before codebookBytes existed stored the bitstream-only saving.
                    savingsIncludesCodebook: meta.codebookBytes !== undefined,
                    payloadSavingsPercent: meta.payloadSavingsPercent,
                    shannonEntropy: meta.shannonEntropy,
                    averageCodeLength: meta.averageCodeLength,
                    shannonVerified: meta.shannonVerified,
                    distinctSymbols: meta.distinctSymbols
                };
            } else {
                messages = Array.isArray(row.messages) ? row.messages : [];
                rawTranscriptJson = JSON.stringify(messages);
                const liveCompressed = CanonicalHuffmanCodec.compressTranscriptJson(rawTranscriptJson);
                codeLengths = liveCompressed.codeLengths;
                symbolOrder = liveCompressed.symbolOrder;
                stats = {
                    algorithm: 'legacy-plaintext (computed-on-fly-huffman)',
                    encoding: 'huffman',
                    originalBytes: liveCompressed.originalBytes,
                    compressedBytes: liveCompressed.compressedBytes,
                    codebookBytes: liveCompressed.codebookBytes,
                    savingsPercent: liveCompressed.savingsPercent,
                    savingsIncludesCodebook: true,
                    payloadSavingsPercent: liveCompressed.payloadSavingsPercent,
                    shannonEntropy: liveCompressed.shannonEntropy,
                    averageCodeLength: liveCompressed.averageCodeLength,
                    shannonVerified: liveCompressed.shannonVerified,
                    distinctSymbols: liveCompressed.distinctSymbols
                };
            }

            const visual = CanonicalHuffmanCodec.buildVisualHuffmanTree(codeLengths, rawTranscriptJson, symbolOrder);
            return res.json({
                roomId: row.room_id,
                user1Alias: row.user1_alias,
                user2Alias: row.user2_alias,
                handshakeAgreed: row.handshake_agreed,
                durationSeconds: row.duration_seconds,
                closedAt: row.closed_at,
                messages,
                stats,
                huffmanTree: visual.tree,
                canonicalCodes: visual.canonicalCodes,
                codeLengths,
                symbolFrequencies: visual.symbolFrequencies
            });
        } catch (err: any) {
            console.error('Admin room inspect error:', err);
            return res.status(500).json({ error: 'Failed to decrypt/inspect room transcript' });
        }
    });

    app.get('/api/admin/reports', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const { data, error } = await supabase
                .from('reports')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
            if (error) throw error;
            const nowMs = Date.now();
            res.json({
                reports: (data || []).map((r: any) => ({
                    ...r,
                    overdue24h: !r.resolved && nowMs - new Date(r.created_at).getTime() > 86400000
                }))
            });
        } catch (err: any) {
            console.error('Admin reports error:', err);
            res.status(500).json({ error: 'Failed to load reports' });
        }
    });

    app.patch('/api/admin/reports/:reportId', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const resolved = req.body?.resolved !== false;
            const { data, error } = await supabase
                .from('reports')
                .update({ resolved })
                .eq('id', req.params.reportId)
                .select()
                .maybeSingle();
            if (error) throw error;
            await logAdminAction(
                admin.email,
                resolved ? 'resolve_report' : 'reopen_report',
                'report',
                req.params.reportId,
                { resolved }
            );
            res.json({ success: true, report: data });
        } catch (err: any) {
            console.error('Admin resolve report error:', err);
            res.status(500).json({ error: 'Failed to update report' });
        }
    });

    app.get('/api/admin/users', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const [{ data: rawUsers, error }, { data: sessions }] = await Promise.all([
                supabase.from('users').select('*').order('created_at', { ascending: false }).limit(200),
                supabase
                    .from('chat_sessions')
                    .select('user_id, partner_id, messages_sent, messages_received, duration_seconds, created_at')
                    .limit(5000)
            ]);
            if (error) throw error;

            const statsByUser = new Map<
                string,
                { chats: number; totalSeconds: number; sent: number; received: number; partners: Set<string>; lastActiveAt: string | null }
            >();

            for (const s of sessions || []) {
                if (!s.user_id) continue;
                let entry = statsByUser.get(s.user_id);
                if (!entry) {
                    entry = { chats: 0, totalSeconds: 0, sent: 0, received: 0, partners: new Set(), lastActiveAt: null };
                    statsByUser.set(s.user_id, entry);
                }
                entry.chats += 1;
                entry.totalSeconds += Number(s.duration_seconds || 0);
                entry.sent += Number(s.messages_sent || 0);
                entry.received += Number(s.messages_received || 0);
                if (s.partner_id) entry.partners.add(s.partner_id);
                if (s.created_at && (!entry.lastActiveAt || s.created_at > entry.lastActiveAt)) {
                    entry.lastActiveAt = s.created_at;
                }
            }

            const users = (rawUsers || []).map((u: any) => {
                const st = statsByUser.get(u.id);
                const totalChats = st ? st.chats : Number(u.total_chats || 0);
                const totalSeconds = st ? st.totalSeconds : 0;
                const avgSessionSeconds = totalChats > 0 ? Math.round(totalSeconds / totalChats) : 0;
                let behaviorTag = 'Newcomer';
                if (totalChats >= 10 || totalSeconds >= 3600) behaviorTag = 'Power Chatter';
                else if (totalChats >= 3 || totalSeconds >= 900) behaviorTag = 'Active Regular';
                else if (totalChats >= 1) behaviorTag = 'Explorer';

                return {
                    id: u.id,
                    email: u.email,
                    generated_alias: u.generated_alias,
                    dept_code: u.dept_code,
                    semester_intake: u.semester_intake,
                    gender: u.gender,
                    stones_balance: u.stones_balance ?? 0,
                    streak_count: u.streak_count ?? 0,
                    total_referrals: u.total_referrals ?? 0,
                    is_admin: u.is_admin === true || (u.email || '').toLowerCase() === ADMIN_EMAIL,
                    is_banned: u.is_banned === true,
                    muted_until: u.muted_until || null,
                    is_muted: Boolean(u.muted_until && new Date(u.muted_until).getTime() > Date.now()),
                    is_online: userSocketMap.has(u.id),
                    created_at: u.created_at,
                    last_login: u.last_login,
                    telemetry: {
                        totalChats,
                        totalDurationSeconds: totalSeconds,
                        avgSessionSeconds,
                        messagesSent: st ? st.sent : 0,
                        messagesReceived: st ? st.received : 0,
                        totalMessages: st ? st.sent + st.received : 0,
                        uniquePartners: st ? st.partners.size : 0,
                        lastChatAt: st ? st.lastActiveAt : null,
                        behaviorTag
                    }
                };
            });

            res.json({ users });
        } catch (err: any) {
            console.error('Admin users error:', err);
            res.status(500).json({ error: err?.message || 'Failed to load users' });
        }
    });

    app.get('/api/admin/users/:userId/profile', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const userId = req.params.userId;
            const [userRes, sessionsRes, aliasRes, txRes, perksRes, claimsRes, reportsRes] = await Promise.all([
                supabase.from('users').select('*').eq('id', userId).maybeSingle(),
                supabase
                    .from('chat_sessions')
                    .select('room_id, partner_id, messages_sent, messages_received, duration_seconds, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(50),
                supabase.from('alias_history').select('old_alias, new_alias, change_type, changed_at').eq('user_id', userId).order('changed_at', { ascending: false }).limit(20),
                supabase.from('stone_transactions').select('amount, tx_type, description, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
                supabase.from('user_perks').select('perk_id, is_equipped, unlocked_at').eq('user_id', userId),
                supabase.from('user_campaign_claims').select('campaign_id, reward_stones, claimed_at').eq('user_id', userId),
                supabase.from('reports').select('id, reason, resolved, created_at').eq('reporter_id', userId).order('created_at', { ascending: false }).limit(20)
            ]);

            if (userRes.error) throw userRes.error;
            if (!userRes.data) return res.status(404).json({ error: 'User not found' });

            const sessions = sessionsRes.data || [];
            let totalSeconds = 0, sent = 0, received = 0;
            const partners = new Set<string>();
            const hourCounts = new Array<number>(24).fill(0);

            for (const s of sessions) {
                totalSeconds += Number(s.duration_seconds || 0);
                sent += Number(s.messages_sent || 0);
                received += Number(s.messages_received || 0);
                if (s.partner_id) partners.add(s.partner_id);
                if (s.created_at) {
                    const hr = new Date(s.created_at).getHours();
                    if (hr >= 0 && hr < 24) hourCounts[hr]++;
                }
            }

            let peakHour: number | null = null, maxHourCount = 0;
            for (let h = 0; h < 24; h++) {
                if (hourCounts[h] > maxHourCount) {
                    maxHourCount = hourCounts[h];
                    peakHour = h;
                }
            }

            const totalChats = sessions.length;
            let behaviorTag = 'Newcomer';
            if (peakHour !== null && (peakHour >= 22 || peakHour <= 3) && totalChats >= 2) behaviorTag = 'Night Owl Chatter';
            else if (totalChats >= 10 || totalSeconds >= 3600) behaviorTag = 'Power Chatter';
            else if (totalChats >= 3 || totalSeconds >= 900) behaviorTag = 'Active Regular';
            else if (totalChats >= 1) behaviorTag = 'Explorer';

            res.json({
                user: {
                    ...userRes.data,
                    is_online: userSocketMap.has(userId),
                    is_admin: userRes.data.is_admin === true || (userRes.data.email || '').toLowerCase() === ADMIN_EMAIL
                },
                summary: {
                    totalChats,
                    totalDurationSeconds: totalSeconds,
                    avgSessionSeconds: totalChats > 0 ? Math.round(totalSeconds / totalChats) : 0,
                    messagesSent: sent,
                    messagesReceived: received,
                    totalMessages: sent + received,
                    avgMessagesPerChat: totalChats > 0 ? Number(((sent + received) / totalChats).toFixed(1)) : 0,
                    uniquePartners: partners.size,
                    peakHour,
                    behaviorTag
                },
                recentSessions: sessions,
                aliasHistory: aliasRes.data || [],
                stoneTransactions: txRes.data || [],
                unlockedPerks: perksRes.data || [],
                campaignClaims: claimsRes.data || [],
                reportsFiled: reportsRes.data || []
            });
        } catch (err: any) {
            console.error('Admin user profile error:', err);
            res.status(500).json({ error: err?.message || 'Failed to load user telemetry profile' });
        }
    });

    app.post('/api/admin/users/:userId/ban', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const banned = req.body?.banned !== false;
            const { data, error } = await supabase
                .from('users')
                .update({ is_banned: banned })
                .eq('id', req.params.userId)
                .select('id, email, generated_alias, is_banned')
                .maybeSingle();
            if (error) throw error;
            await logAdminAction(admin.email, banned ? 'ban_user' : 'unban_user', 'user', req.params.userId, {
                alias: data?.generated_alias,
                banned
            });
            res.json({ success: true, user: data });
        } catch (err: any) {
            console.error('Admin ban error:', err);
            res.status(500).json({ error: 'Failed to update ban status' });
        }
    });

    app.post('/api/admin/users/:userId/mute', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const hours = Number(req.body?.hours ?? 0);
            const clampedHours = Number.isFinite(hours) && hours > 0 ? Math.min(720, hours) : 0;
            const mutedUntil = clampedHours > 0 ? new Date(Date.now() + clampedHours * 3600 * 1000).toISOString() : null;

            const { data, error } = await supabase
                .from('users')
                .update({ muted_until: mutedUntil })
                .eq('id', req.params.userId)
                .select('id, email, generated_alias, muted_until')
                .maybeSingle();
            if (error) throw error;

            const sockId = userSocketMap.get(req.params.userId);
            if (sockId) {
                const liveUser = activeUsers.get(sockId);
                if (liveUser) {
                    liveUser.muted_until = mutedUntil;
                    activeUsers.set(sockId, liveUser);
                }
            }

            await logAdminAction(
                admin.email,
                clampedHours > 0 ? 'mute_user' : 'unmute_user',
                'user',
                req.params.userId,
                { hours: clampedHours, muted_until: mutedUntil, alias: data?.generated_alias }
            );
            res.json({ ok: true, muted_until: mutedUntil, user: data });
        } catch (err: any) {
            console.error('Admin mute error:', err);
            res.status(500).json({ error: 'Failed to update mute status' });
        }
    });

    app.get('/api/admin/audit-logs', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10) || 50));
            const { data, error } = await supabase
                .from('admin_audit_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            res.json({ logs: data || [] });
        } catch (err: any) {
            console.error('Admin audit logs error:', err);
            res.status(500).json({ error: 'Failed to load audit logs' });
        }
    });
}
