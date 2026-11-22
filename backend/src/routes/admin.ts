import express from 'express';
import { timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import type { Server } from 'socket.io';
import type { AnalyticsEngine } from '../analytics';
import { CanonicalHuffmanCodec, EncryptedHuffmanArchive } from '../algorithms/huffman_codec';
import { BenchlyPiiShield } from '../algorithms/pii_shield_engine';
import { StonesKnapsackCoinEngine } from '../algorithms/stones_knapsack_coin_dp';
import { BenchlyBacktrackingEngine } from '../algorithms/backtracking_solver';
import { AiCampusCompanionEngine } from '../ai_campus_companion';

export interface AdminRoutesDeps {
    supabase: SupabaseClient;
    redis: Redis;
    io: Server;
    analytics: AnalyticsEngine;
    activeUsers: Map<string, any>;
    userSocketMap: Map<string, string>;
    ADMIN_EMAIL: string;
    DEFAULT_BENCH_TOPIC: string;
}

export function registerAdminRoutes(app: express.Express, deps: AdminRoutesDeps) {
    const {
        supabase,
        redis,
        io,
        analytics,
        activeUsers,
        userSocketMap,
        ADMIN_EMAIL,
        DEFAULT_BENCH_TOPIC
    } = deps;

    async function requireAdmin(
        req: express.Request,
        res: express.Response
    ): Promise<{ email: string; id?: string } | null> {
        const adminSecret = process.env.ADMIN_SECRET;
        const providedSecret = (req.headers['x-admin-secret'] || '').toString();
        if (adminSecret && providedSecret && adminSecret.length === providedSecret.length) {
            if (timingSafeEqual(Buffer.from(adminSecret), Buffer.from(providedSecret))) {
                return { email: ADMIN_EMAIL };
            }
        }

        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (!token) {
            res.status(401).json({ error: 'Unauthorized: Admin Bearer token required' });
            return null;
        }

        const {
            data: { user },
            error
        } = await supabase.auth.getUser(token);
        if (error || !user) {
            res.status(401).json({ error: 'Unauthorized: Invalid session token' });
            return null;
        }

        const email = (user.email || '').toLowerCase().trim();
        if (email === ADMIN_EMAIL) {
            return { email, id: user.id };
        }

        const { data: profile } = await supabase
            .from('users')
            .select('is_admin')
            .eq('id', user.id)
            .maybeSingle();

        if (profile?.is_admin === true) {
            return { email, id: user.id };
        }

        res.status(403).json({ error: 'Forbidden: Admin access restricted to rhrakibulhasan279@gmail.com' });
        return null;
    }

    async function logAdminAction(
        adminEmail: string,
        action: string,
        targetType: string,
        targetId: string | null,
        details: Record<string, any> = {}
    ) {
        try {
            await supabase.from('admin_audit_logs').insert({
                admin_email: adminEmail,
                action,
                target_type: targetType,
                target_id: targetId,
                details
            });
        } catch (e: any) {
            console.error('Admin audit log write failed:', e?.message || e);
        }
    }

    function computeChatQualityStats(rooms: any[], extensionsCount: number = 0) {
        const totalRooms = rooms.length;
        const humanRooms = rooms.filter((r: any) => Boolean(r.user2_id)).length;
        const aiRooms = totalRooms - humanRooms;
        const earlyDrops = rooms.filter((r: any) => Number(r.duration_seconds || 0) < 30).length;
        const extendedRooms = Math.max(
            extensionsCount,
            rooms.filter((r: any) => Number(r.duration_seconds || 0) > 900).length
        );
        const totalMessages = rooms.reduce((acc: number, r: any) => acc + Number(r.messages_count || 0), 0);
        const durations = rooms
            .map((r: any) => Number(r.duration_seconds || 0))
            .sort((a: number, b: number) => a - b);
        const medianDurationSec =
            durations.length === 0
                ? 0
                : durations.length % 2 === 1
                  ? durations[Math.floor(durations.length / 2)]
                  : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);

        return {
            totalRooms,
            humanRooms,
            aiRooms,
            humanMatchPct: totalRooms > 0 ? Number(((humanRooms / totalRooms) * 100).toFixed(1)) : 0,
            aiFallbackPct: totalRooms > 0 ? Number(((aiRooms / totalRooms) * 100).toFixed(1)) : 0,
            earlyDropRatePct: totalRooms > 0 ? Number(((earlyDrops / totalRooms) * 100).toFixed(1)) : 0,
            mutualExtensionRatePct:
                totalRooms > 0 ? Number(Math.min(100, (extendedRooms / totalRooms) * 100).toFixed(1)) : 0,
            avgMessagesPerRoom: totalRooms > 0 ? Number((totalMessages / totalRooms).toFixed(1)) : 0,
            medianDurationSec
        };
    }

    // 1. Admin Overview & Live Algorithm Telemetry
    app.get('/api/admin/overview', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const todayKey = new Date().toISOString().split('T')[0];
            const [liveStats, usersCount, reportsCount, roomsRes, visitsTodayRaw] = await Promise.all([
                analytics.getRealtimeMetrics(),
                supabase.from('users').select('id', { count: 'exact', head: true }),
                supabase.from('reports').select('id', { count: 'exact', head: true }),
                supabase
                    .from('room_conversations')
                    .select('user2_id, messages_count, duration_seconds, compression_savings_pct')
                    .order('closed_at', { ascending: false })
                    .limit(200),
                redis.get(`benchly:visits:${todayKey}`).catch(() => '0')
            ]);

            const roomRows = roomsRes.data || [];
            const savingsList = roomRows
                .map((r: any) => Number(r.compression_savings_pct || 0))
                .filter((n: number) => n > 0);
            const avgHuffmanSavingsPct =
                savingsList.length > 0
                    ? Number((savingsList.reduce((a: number, b: number) => a + b, 0) / savingsList.length).toFixed(2))
                    : 0;
            const chatQuality = computeChatQualityStats(
                roomRows,
                Number(liveStats?.todayStats?.mutualExtensions || 0)
            );

            res.json({
                adminEmail: admin.email,
                liveStats,
                chatQuality,
                visitsToday: parseInt(visitsTodayRaw || '0', 10) || 0,
                totals: {
                    users: usersCount.count || 0,
                    reports: reportsCount.count || 0,
                    archivedRoomsSampled: roomRows.length,
                    avgHuffmanSavingsPct
                }
            });
        } catch (err: any) {
            console.error('Admin overview error:', err);
            res.status(500).json({ error: 'Failed to load admin overview' });
        }
    });

    // 2. List Archived Rooms (for inspecting any chat's Huffman Tree & encrypted status)
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

    // 3. Inspect & Decrypt a Specific Room + Return Its Full Canonical Huffman Binary Tree
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
            let stats: any = {};

            const meta = row.huffman_meta as EncryptedHuffmanArchive | null;
            if (meta && meta.algorithm === 'canonical-huffman+aes-256-gcm' && meta.ciphertextBase64) {
                rawTranscriptJson = CanonicalHuffmanCodec.openEncryptedHuffmanArchive(meta);
                messages = JSON.parse(rawTranscriptJson || '[]');
                codeLengths = meta.codeLengths || {};
                stats = {
                    algorithm: meta.algorithm,
                    originalBytes: meta.originalBytes,
                    compressedBytes: meta.compressedBytes,
                    savingsPercent: meta.savingsPercent,
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
                stats = {
                    algorithm: 'legacy-plaintext (computed-on-fly-huffman)',
                    originalBytes: liveCompressed.originalBytes,
                    compressedBytes: liveCompressed.compressedBytes,
                    savingsPercent: liveCompressed.savingsPercent,
                    shannonEntropy: liveCompressed.shannonEntropy,
                    averageCodeLength: liveCompressed.averageCodeLength,
                    shannonVerified: liveCompressed.shannonVerified,
                    distinctSymbols: liveCompressed.distinctSymbols
                };
            }

            const visual = CanonicalHuffmanCodec.buildVisualHuffmanTree(codeLengths, rawTranscriptJson);

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

    // 4. Abuse Reports Queue & Resolution
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
            const reports = (data || []).map((r: any) => ({
                ...r,
                overdue24h: !r.resolved && nowMs - new Date(r.created_at).getTime() > 86400000
            }));
            res.json({ reports });
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

    // 5. User Moderation & Full Telemetry Profiling (List, Deep Profile, Ban, Mute, Audit Logs)
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
                {
                    chats: number;
                    totalSeconds: number;
                    sent: number;
                    received: number;
                    partners: Set<string>;
                    lastActiveAt: string | null;
                }
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
                const totalMessages = st ? st.sent + st.received : 0;
                const uniquePartners = st ? st.partners.size : 0;
                const isOnline = userSocketMap.has(u.id);

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
                    is_online: isOnline,
                    created_at: u.created_at,
                    last_login: u.last_login,
                    telemetry: {
                        totalChats,
                        totalDurationSeconds: totalSeconds,
                        avgSessionSeconds,
                        messagesSent: st ? st.sent : 0,
                        messagesReceived: st ? st.received : 0,
                        totalMessages,
                        uniquePartners,
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
                supabase
                    .from('alias_history')
                    .select('old_alias, new_alias, change_type, changed_at')
                    .eq('user_id', userId)
                    .order('changed_at', { ascending: false })
                    .limit(20),
                supabase
                    .from('stone_transactions')
                    .select('amount, tx_type, description, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(30),
                supabase.from('user_perks').select('perk_id, is_equipped, unlocked_at').eq('user_id', userId),
                supabase
                    .from('user_campaign_claims')
                    .select('campaign_id, reward_stones, claimed_at')
                    .eq('user_id', userId),
                supabase
                    .from('reports')
                    .select('id, reason, resolved, created_at')
                    .eq('reporter_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(20)
            ]);

            if (userRes.error) throw userRes.error;
            if (!userRes.data) return res.status(404).json({ error: 'User not found' });

            const sessions = sessionsRes.data || [];
            let totalSeconds = 0;
            let sent = 0;
            let received = 0;
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

            let peakHour: number | null = null;
            let maxHourCount = 0;
            for (let h = 0; h < 24; h++) {
                if (hourCounts[h] > maxHourCount) {
                    maxHourCount = hourCounts[h];
                    peakHour = h;
                }
            }

            const totalChats = sessions.length;
            const avgSessionSeconds = totalChats > 0 ? Math.round(totalSeconds / totalChats) : 0;
            const avgMessagesPerChat = totalChats > 0 ? Number(((sent + received) / totalChats).toFixed(1)) : 0;

            let behaviorTag = 'Newcomer';
            if (peakHour !== null && (peakHour >= 22 || peakHour <= 3) && totalChats >= 2) {
                behaviorTag = 'Night Owl Chatter';
            } else if (totalChats >= 10 || totalSeconds >= 3600) {
                behaviorTag = 'Power Chatter';
            } else if (totalChats >= 3 || totalSeconds >= 900) {
                behaviorTag = 'Active Regular';
            } else if (totalChats >= 1) {
                behaviorTag = 'Explorer';
            }

            res.json({
                user: {
                    ...userRes.data,
                    is_online: userSocketMap.has(userId),
                    is_admin: userRes.data.is_admin === true || (userRes.data.email || '').toLowerCase() === ADMIN_EMAIL
                },
                summary: {
                    totalChats,
                    totalDurationSeconds: totalSeconds,
                    avgSessionSeconds,
                    messagesSent: sent,
                    messagesReceived: received,
                    totalMessages: sent + received,
                    avgMessagesPerChat,
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
            await logAdminAction(
                admin.email,
                banned ? 'ban_user' : 'unban_user',
                'user',
                req.params.userId,
                { alias: data?.generated_alias, banned }
            );
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

    // 5.5 Website Traffic, Acquisition Funnel, Cohort Retention & Peak Hours
    app.get('/api/admin/growth', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const rawDays = parseInt((req.query.days as string) || '14', 10);
            const days = Math.max(1, Math.min(30, Number.isNaN(rawDays) ? 14 : rawDays));

            const nowMs = Date.now();
            const since24hMs = nowMs - 24 * 3600 * 1000;
            const since7dMs = nowMs - 7 * 24 * 3600 * 1000;
            const since30dIso = new Date(nowMs - 30 * 24 * 3600 * 1000).toISOString();
            const sinceDaysIso = new Date(nowMs - days * 24 * 3600 * 1000).toISOString();

            const [eventsRes, usersRes, roomsRes, sessionsRes, extEventsRes] = await Promise.all([
                supabase
                    .from('site_events')
                    .select('visitor_hash, domain, event_type, referrer, utm_source, invite_code, device_type, country, platform, created_at')
                    .gte('created_at', since30dIso)
                    .order('created_at', { ascending: false })
                    .limit(10000),
                supabase
                    .from('users')
                    .select('id, created_at, last_login, dept_code, total_chats, streak_count, stones_balance')
                    .limit(5000),
                supabase
                    .from('room_conversations')
                    .select('user1_id, user2_id, messages_count, duration_seconds, handshake_agreed, closed_at')
                    .order('closed_at', { ascending: false })
                    .limit(2000),
                supabase
                    .from('chat_sessions')
                    .select('user_id, created_at')
                    .gte('created_at', since30dIso)
                    .limit(5000),
                supabase
                    .from('analytics_events')
                    .select('event_type, metadata, created_at')
                    .in('event_type', ['chat_extended', 'pii_blocked'])
                    .gte('created_at', since30dIso)
                    .limit(5000)
            ]);

            const events = eventsRes.data || [];
            const allUsers = usersRes.data || [];
            const allRooms = roomsRes.data || [];
            const recentSessions = sessionsRes.data || [];
            const analyticsRows = extEventsRes.data || [];

            const uniq24h = new Set<string>();
            const uniq7d = new Set<string>();
            const uniq30d = new Set<string>();
            let pageviews7d = 0;
            const pageviews30d = events.length;

            const dailyMap = new Map<string, { visitors: Set<string>; pageviews: number }>();
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(nowMs - i * 86400000 + 6 * 3600 * 1000);
                const key = d.toISOString().split('T')[0];
                dailyMap.set(key, { visitors: new Set(), pageviews: 0 });
            }

            let landingViews = 0;
            let ctaClicks = 0;
            let appOpens = 0;
            const refMap = new Map<string, number>();
            const inviteMap = new Map<string, number>();
            const platforms = { web: 0, android: 0, mobileWeb: 0, desktopWeb: 0 };
            const hourlyBdtCounts = new Array<number>(24).fill(0);

            for (const ev of events) {
                const tsMs = ev.created_at ? new Date(ev.created_at).getTime() : 0;
                const vh = ev.visitor_hash || '';
                if (vh) {
                    uniq30d.add(vh);
                    if (tsMs >= since7dMs) uniq7d.add(vh);
                    if (tsMs >= since24hMs) uniq24h.add(vh);
                }
                if (tsMs >= since7dMs) pageviews7d++;

                if (tsMs > 0) {
                    const bdtDate = new Date(tsMs + 6 * 3600 * 1000);
                    const dayKey = bdtDate.toISOString().split('T')[0];
                    const bucket = dailyMap.get(dayKey);
                    if (bucket) {
                        bucket.pageviews += 1;
                        if (vh) bucket.visitors.add(vh);
                    }
                    const hrBdt = bdtDate.getUTCHours();
                    if (hrBdt >= 0 && hrBdt < 24) hourlyBdtCounts[hrBdt] += 1;
                }

                if (ev.event_type === 'landing_view') landingViews++;
                else if (ev.event_type === 'cta_open_app') ctaClicks++;
                else if (ev.event_type === 'app_open') appOpens++;

                if (ev.platform === 'android') {
                    platforms.android++;
                } else {
                    platforms.web++;
                    if (ev.device_type === 'mobile') platforms.mobileWeb++;
                    else platforms.desktopWeb++;
                }

                const refRaw = (ev.utm_source || ev.referrer || '').toString().trim();
                if (ev.event_type === 'landing_view' || ev.event_type === 'invite_link_clicked') {
                    let refLabel = 'Direct';
                    if (refRaw) {
                        try {
                            refLabel = refRaw.startsWith('http') ? new URL(refRaw).hostname : refRaw;
                        } catch {
                            refLabel = refRaw;
                        }
                    }
                    refMap.set(refLabel, (refMap.get(refLabel) || 0) + 1);
                }

                if (ev.invite_code) {
                    const code = String(ev.invite_code).trim();
                    if (code) inviteMap.set(code, (inviteMap.get(code) || 0) + 1);
                }
            }

            for (const r of allRooms) {
                if (!r.closed_at) continue;
                const tsMs = new Date(r.closed_at).getTime();
                if (tsMs >= since7dMs) {
                    const bdtDate = new Date(tsMs + 6 * 3600 * 1000);
                    const hrBdt = bdtDate.getUTCHours();
                    if (hrBdt >= 0 && hrBdt < 24) hourlyBdtCounts[hrBdt] += 1;
                }
            }

            const dailySeries = Array.from(dailyMap.entries()).map(([date, info]) => ({
                date,
                uniqueVisitors: info.visitors.size,
                pageviews: info.pageviews
            }));

            const active24h = new Set<string>();
            const active7d = new Set<string>();
            const active30d = new Set<string>();
            const deptCounts = new Map<string, number>();

            const sessionTimestampsByUser = new Map<string, number[]>();
            for (const s of recentSessions) {
                if (!s.user_id || !s.created_at) continue;
                const ts = new Date(s.created_at).getTime();
                active30d.add(s.user_id);
                if (ts >= since7dMs) active7d.add(s.user_id);
                if (ts >= since24hMs) active24h.add(s.user_id);
                const list = sessionTimestampsByUser.get(s.user_id) || [];
                list.push(ts);
                sessionTimestampsByUser.set(s.user_id, list);
            }

            let d1Eligible = 0;
            let d1Retained = 0;
            let d7Eligible = 0;
            let d7Retained = 0;
            const twoDaysAgoMs = nowMs - 2 * 86400000;
            const eightDaysAgoMs = nowMs - 8 * 86400000;

            for (const u of allUsers) {
                const dept = (u.dept_code || 'Other').toString().trim() || 'Other';
                deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1);

                const loginMs = u.last_login ? new Date(u.last_login).getTime() : 0;
                if (loginMs >= since24hMs) active24h.add(u.id);
                if (loginMs >= since7dMs) active7d.add(u.id);
                if (loginMs >= nowMs - 30 * 86400000) active30d.add(u.id);

                const createdMs = u.created_at ? new Date(u.created_at).getTime() : 0;
                if (createdMs > 0) {
                    const userSessTimes = sessionTimestampsByUser.get(u.id) || [];
                    const latestAct = Math.max(loginMs, ...userSessTimes, 0);
                    if (createdMs <= twoDaysAgoMs) {
                        d1Eligible++;
                        if (latestAct >= createdMs + 24 * 3600 * 1000) d1Retained++;
                    }
                    if (createdMs <= eightDaysAgoMs) {
                        d7Eligible++;
                        if (latestAct >= createdMs + 7 * 24 * 3600 * 1000) d7Retained++;
                    }
                }
            }

            const dau = active24h.size;
            const wau = active7d.size;
            const mau = active30d.size;

            const roomsInWindow = allRooms.filter((r: any) => !r.closed_at || r.closed_at >= sinceDaysIso);
            const extensionsCount = analyticsRows.filter((a: any) => a.event_type === 'chat_extended').length;
            const piiByType: Record<string, number> = {};
            for (const a of analyticsRows) {
                if (a.event_type === 'pii_blocked') {
                    const t = String(a.metadata?.type || 'other');
                    piiByType[t] = (piiByType[t] || 0) + 1;
                }
            }

            const matchedSet = new Set<string>();
            for (const r of allRooms) {
                if (r.user1_id) matchedSet.add(r.user1_id);
                if (r.user2_id) matchedSet.add(r.user2_id);
            }
            for (const s of recentSessions) {
                if (s.user_id) matchedSet.add(s.user_id);
            }

            const chatQuality = computeChatQualityStats(allRooms, extensionsCount);

            res.json({
                days,
                visitors: {
                    unique24h: uniq24h.size,
                    unique7d: uniq7d.size,
                    unique30d: uniq30d.size,
                    pageviews7d,
                    pageviews30d,
                    dailySeries
                },
                funnel: {
                    landingViews,
                    ctaClicks,
                    appOpens,
                    verifiedStudents: allUsers.length,
                    matchedStudents: matchedSet.size,
                    completedChats: allRooms.length
                },
                retention: {
                    dau,
                    wau,
                    mau,
                    stickinessPct: mau > 0 ? Math.round((dau / mau) * 100) : 0,
                    d1RetentionPct: d1Eligible > 0 ? Math.round((d1Retained / d1Eligible) * 100) : 0,
                    d7RetentionPct: d7Eligible > 0 ? Math.round((d7Retained / d7Eligible) * 100) : 0
                },
                chatQuality,
                roomsInWindowCount: roomsInWindow.length,
                hourlyBdt: hourlyBdtCounts.map((count, h) => ({
                    hour: h,
                    label: `${String(h).padStart(2, '0')}:00`,
                    count
                })),
                topReferrers: Array.from(refMap.entries())
                    .map(([source, count]) => ({ source, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 8),
                topInvites: Array.from(inviteMap.entries())
                    .map(([code, clicks]) => ({ code, clicks }))
                    .sort((a, b) => b.clicks - a.clicks)
                    .slice(0, 8),
                departments: Array.from(deptCounts.entries())
                    .map(([dept, count]) => ({ dept, count }))
                    .sort((a, b) => b.count - a.count),
                platforms,
                piiBreakdown: piiByType
            });
        } catch (err: any) {
            console.error('Admin growth analytics error:', err);
            res.status(500).json({ error: err?.message || 'Failed to compute growth analytics' });
        }
    });

    // 5.6 Infrastructure Health (Azure F1, Redis, 4-Node EWU Ollama Cluster, Supabase Storage & Huffman)
    app.get('/api/admin/system-health', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const redisStart = Date.now();
            let redisOk = true;
            let redisPingMs = 0;
            try {
                await redis.ping();
                redisPingMs = Date.now() - redisStart;
            } catch {
                redisOk = false;
                redisPingMs = -1;
            }

            const [
                ollamaCluster,
                usersCnt,
                roomsCnt,
                sessionsCnt,
                reportsCnt,
                eventsCnt,
                perksRes,
                usersStonesRes,
                huffmanRowsRes
            ] = await Promise.all([
                AiCampusCompanionEngine.checkClusterHealth(),
                supabase.from('users').select('id', { count: 'exact', head: true }),
                supabase.from('room_conversations').select('id', { count: 'exact', head: true }),
                supabase.from('chat_sessions').select('id', { count: 'exact', head: true }),
                supabase.from('reports').select('id', { count: 'exact', head: true }),
                supabase.from('site_events').select('id', { count: 'exact', head: true }),
                supabase
                    .from('stone_perks')
                    .select('id, name, category, icon_emoji, stone_cost, free_claim_limit, claimed_count')
                    .order('stone_cost', { ascending: true }),
                supabase.from('users').select('stones_balance').limit(5000),
                supabase
                    .from('room_conversations')
                    .select('huffman_meta, compression_savings_pct')
                    .order('closed_at', { ascending: false })
                    .limit(500)
            ]);

            const totalStonesInCirculation = (usersStonesRes.data || []).reduce(
                (sum: number, u: any) => sum + Number(u.stones_balance || 0),
                0
            );

            const earlyBirdAvatars = (perksRes.data || [])
                .filter((p: any) => Number(p.free_claim_limit || 0) > 0 || String(p.category || '').toLowerCase().includes('avatar'))
                .map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    icon_emoji: p.icon_emoji,
                    stone_cost: p.stone_cost,
                    free_claim_limit: Number(p.free_claim_limit || 0),
                    claimed_count: Number(p.claimed_count || 0)
                }));

            let totalOriginalBytes = 0;
            let totalCompressedBytes = 0;
            const pctSamples: number[] = [];
            for (const r of huffmanRowsRes.data || []) {
                const meta = r.huffman_meta;
                if (meta && typeof meta.originalBytes === 'number' && typeof meta.compressedBytes === 'number') {
                    totalOriginalBytes += meta.originalBytes;
                    totalCompressedBytes += meta.compressedBytes;
                }
                const pct = Number(r.compression_savings_pct || meta?.savingsPercent || 0);
                if (pct > 0) pctSamples.push(pct);
            }
            const totalBytesSaved = Math.max(0, totalOriginalBytes - totalCompressedBytes);
            const avgSavingsPct =
                pctSamples.length > 0
                    ? Number((pctSamples.reduce((a, b) => a + b, 0) / pctSamples.length).toFixed(2))
                    : 0;

            const mem = process.memoryUsage();
            res.json({
                server: {
                    uptimeSeconds: Math.floor(process.uptime()),
                    rssMemoryMb: Math.round(mem.rss / 1024 / 1024),
                    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                    nodeVersion: process.version,
                    platform: process.platform
                },
                redis: { ok: redisOk, pingMs: redisPingMs },
                ollamaCluster,
                supabase: {
                    counts: {
                        users: usersCnt.count || 0,
                        room_conversations: roomsCnt.count || 0,
                        chat_sessions: sessionsCnt.count || 0,
                        reports: reportsCnt.count || 0,
                        site_events: eventsCnt.count || 0
                    },
                    huffmanStorage: {
                        totalOriginalBytes,
                        totalCompressedBytes,
                        totalBytesSaved,
                        avgSavingsPct
                    }
                },
                economy: {
                    totalStonesInCirculation,
                    earlyBirdAvatars
                }
            });
        } catch (err: any) {
            console.error('Admin system health error:', err);
            res.status(500).json({ error: err?.message || 'Failed to check system health' });
        }
    });

    // 6. Live CSE246 Algorithm Workflows Inspector (Coin Change, 0/1 Knapsack, Backtracking, KMP/LCS/Rabin-Karp)
    app.get('/api/admin/algorithms/workflows', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const walletStones = Math.max(0, Math.min(100, parseInt((req.query.stones as string) || '13', 10) || 13));
            const targetGoal = Math.max(1, Math.min(100, parseInt((req.query.target as string) || '12', 10) || 12));
            const sampleMessage = (req.query.sample as string) || 'call me at zero one seven 8 9 1 2 3 4 5 6 later';

            const { data: perks } = await supabase
                .from('stone_perks')
                .select('id, name, category, stone_cost, engagement_boost, icon_emoji')
                .eq('is_active', true);

            const activePerks =
                perks && perks.length > 0
                    ? perks
                    : [
                          { id: 'perk_dept_hint', name: 'Mid-Chat Dept Reveal Hint', category: 'In-Chat Boost', stone_cost: 2, engagement_boost: 18, icon_emoji: '🕵️' },
                          { id: 'perk_priority_queue', name: 'Rush-Hour Priority Queue Pass', category: 'Matchmaking', stone_cost: 3, engagement_boost: 29, icon_emoji: '⚡' },
                          { id: 'avatar_campus_cat', name: 'Campus Cat Collectible Badge', category: 'Avatar Shop', stone_cost: 4, engagement_boost: 36, icon_emoji: '🐱' },
                          { id: 'perk_custom_alias', name: 'Custom Anonymous Pseudonym Pass', category: 'Identity', stone_cost: 5, engagement_boost: 48, icon_emoji: '🎭' },
                          { id: 'avatar_tea_philosopher', name: 'Tea Stall Philosopher Flair', category: 'Avatar Shop', stone_cost: 6, engagement_boost: 62, icon_emoji: '☕' },
                          { id: 'perk_super_extend', name: '+15m Instant Super-Extend Token', category: 'In-Chat Boost', stone_cost: 7, engagement_boost: 74, icon_emoji: '⏳' },
                          { id: 'avatar_night_owl', name: 'Midnight Adda Night-Owl Aura', category: 'Avatar Shop', stone_cost: 9, engagement_boost: 96, icon_emoji: '🦉' }
                      ];

            const knapsack = StonesKnapsackCoinEngine.solve01KnapsackPerks(activePerks, walletStones);
            const coinChange = StonesKnapsackCoinEngine.solveCoinChangeMilestones(targetGoal, [1, 3, 4, 5, 7, 10]);
            const subsetSumBacktrack = StonesKnapsackCoinEngine.solveExactBudgetBacktracking(activePerks, walletStones);

            const loungeColoringBacktrack = BenchlyBacktrackingEngine.solveConflictFreeLoungeColoring(
                [
                    { id: 'Student_A', conflicts: new Set(['Student_B', 'Student_C']) },
                    { id: 'Student_B', conflicts: new Set(['Student_A', 'Student_C']) },
                    { id: 'Student_C', conflicts: new Set(['Student_A', 'Student_B']) },
                    { id: 'Student_D', conflicts: new Set(['Student_A']) },
                    { id: 'Student_E', conflicts: new Set<string>() }
                ],
                4,
                5
            );

            const batchMatchingBacktrack = BenchlyBacktrackingEngine.solveMaxMatchBatchBacktrack(4, [
                [0, 100, 80, 0],
                [100, 0, 0, 80],
                [80, 0, 0, 0],
                [0, 80, 0, 0]
            ]);

            const piiVerdict = BenchlyPiiShield.sanitizeLiveMessage(sampleMessage);
            const kmpLpsSample = {
                pattern: 'instagramcom',
                lpsTable: BenchlyPiiShield.buildKmpLps('instagramcom')
            };

            res.json({
                inputs: { walletStones, targetGoal, sampleMessage },
                knapsack,
                coinChange,
                subsetSumBacktrack,
                loungeColoringBacktrack,
                batchMatchingBacktrack,
                piiShield: {
                    verdict: piiVerdict,
                    kmpLpsSample
                }
            });
        } catch (err: any) {
            console.error('Admin algorithm workflows error:', err);
            res.status(500).json({ error: 'Failed to run algorithm workflows' });
        }
    });

    // 8. Admin Dynamic Content, Campaigns & User Stone Rewards
    app.get('/api/admin/content', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const [{ data: setting }, { data: campaigns }, { data: perks }, { data: usersStones }, { data: claimRows }] =
                await Promise.all([
                    supabase.from('app_settings').select('value, updated_at, updated_by').eq('key', 'todays_bench_topic').maybeSingle(),
                    supabase.from('reward_campaigns').select('*').order('created_at', { ascending: false }),
                    supabase
                        .from('stone_perks')
                        .select('id, name, category, icon_emoji, stone_cost, free_claim_limit, claimed_count')
                        .order('stone_cost', { ascending: true }),
                    supabase.from('users').select('stones_balance').limit(5000),
                    supabase.from('user_campaign_claims').select('campaign_id').limit(5000)
                ]);

            const totalStonesInCirculation = (usersStones || []).reduce(
                (sum: number, u: any) => sum + Number(u.stones_balance || 0),
                0
            );
            const earlyBirdAvatars = (perks || []).filter(
                (p: any) => Number(p.free_claim_limit || 0) > 0 || String(p.category || '').toLowerCase().includes('avatar')
            );
            const claimCounts: Record<string, number> = {};
            for (const cl of claimRows || []) {
                if (cl.campaign_id) claimCounts[cl.campaign_id] = (claimCounts[cl.campaign_id] || 0) + 1;
            }
            const campaignsWithClaims = (campaigns || []).map((c: any) => ({
                ...c,
                claims_count: claimCounts[c.id] || 0
            }));

            res.json({
                todaysBenchTopic: setting?.value || DEFAULT_BENCH_TOPIC,
                topicUpdatedAt: setting?.updated_at || null,
                campaigns: campaignsWithClaims,
                earlyBirdAvatars,
                totalStonesInCirculation
            });
        } catch (err: any) {
            console.error('Admin content load error:', err);
            res.status(500).json({ error: 'Failed to load dynamic topics & campaigns' });
        }
    });

    app.put('/api/admin/topic', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const topic = (req.body?.topic || '').toString().trim();
            if (!topic || topic.length < 5 || topic.length > 240) {
                return res.status(400).json({ error: 'Topic must be 5–240 characters.' });
            }
            const { error } = await supabase.from('app_settings').upsert({
                key: 'todays_bench_topic',
                value: topic,
                updated_by: admin.email,
                updated_at: new Date().toISOString()
            });
            if (error) throw error;

            io.emit('bench_topic_updated', { topic });
            await logAdminAction(admin.email, 'update_topic', 'app_settings', 'todays_bench_topic', { topic });
            res.json({ success: true, topic });
        } catch (err: any) {
            console.error('Admin update topic error:', err);
            res.status(500).json({ error: "Failed to update Today's Bench Topic" });
        }
    });

    app.post('/api/admin/campaigns', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const title = (req.body?.title || '').toString().trim();
            const description = (req.body?.description || '').toString().trim();
            const metricType = (req.body?.metric_type || 'streak_days').toString().trim();
            const targetValue = parseInt(req.body?.target_value, 10);
            const rewardStones = parseInt(req.body?.reward_stones, 10);
            const iconEmoji = (req.body?.icon_emoji || '⭐').toString().trim() || '⭐';

            if (!title || !description) return res.status(400).json({ error: 'Title and description are required.' });
            if (!['streak_days', 'total_chats', 'referrals'].includes(metricType)) {
                return res.status(400).json({ error: 'Invalid metric_type.' });
            }
            if (Number.isNaN(targetValue) || targetValue < 1 || Number.isNaN(rewardStones) || rewardStones < 1) {
                return res.status(400).json({ error: 'Target and reward stones must be positive numbers.' });
            }

            const { data, error } = await supabase
                .from('reward_campaigns')
                .insert({
                    title,
                    description,
                    metric_type: metricType,
                    target_value: targetValue,
                    reward_stones: rewardStones,
                    icon_emoji: iconEmoji,
                    is_active: true
                })
                .select()
                .single();

            if (error) throw error;
            io.emit('campaigns_updated', { action: 'created' });
            await logAdminAction(admin.email, 'create_campaign', 'reward_campaign', data?.id || null, {
                title,
                metricType,
                targetValue,
                rewardStones
            });
            res.json({ success: true, campaign: data });
        } catch (err: any) {
            console.error('Admin create campaign error:', err);
            res.status(500).json({ error: 'Failed to create campaign' });
        }
    });

    app.patch('/api/admin/campaigns/:campaignId', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const updates: Record<string, any> = {};
            if (typeof req.body?.is_active === 'boolean') updates.is_active = req.body.is_active;
            if (typeof req.body?.title === 'string' && req.body.title.trim()) updates.title = req.body.title.trim();
            if (typeof req.body?.description === 'string' && req.body.description.trim())
                updates.description = req.body.description.trim();
            if (req.body?.target_value !== undefined)
                updates.target_value = Math.max(1, parseInt(req.body.target_value, 10) || 1);
            if (req.body?.reward_stones !== undefined)
                updates.reward_stones = Math.max(1, parseInt(req.body.reward_stones, 10) || 1);

            const { data, error } = await supabase
                .from('reward_campaigns')
                .update(updates)
                .eq('id', req.params.campaignId)
                .select()
                .maybeSingle();

            if (error) throw error;
            io.emit('campaigns_updated', { action: 'updated' });
            await logAdminAction(admin.email, 'update_campaign', 'reward_campaign', req.params.campaignId, updates);
            res.json({ success: true, campaign: data });
        } catch (err: any) {
            console.error('Admin update campaign error:', err);
            res.status(500).json({ error: 'Failed to update campaign' });
        }
    });

    app.delete('/api/admin/campaigns/:campaignId', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const { error } = await supabase.from('reward_campaigns').delete().eq('id', req.params.campaignId);
            if (error) throw error;
            io.emit('campaigns_updated', { action: 'deleted' });
            await logAdminAction(admin.email, 'delete_campaign', 'reward_campaign', req.params.campaignId, {});
            res.json({ success: true });
        } catch (err: any) {
            console.error('Admin delete campaign error:', err);
            res.status(500).json({ error: 'Failed to delete campaign' });
        }
    });

    app.post('/api/admin/users/:userId/reward', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const amount = parseInt(req.body?.amount, 10);
            const reason = (req.body?.reason || 'Admin Campus Bonus').toString().trim();
            if (Number.isNaN(amount) || amount === 0 || Math.abs(amount) > 500) {
                return res.status(400).json({ error: 'Amount must be between -500 and +500 (non-zero).' });
            }

            const { data: uRow, error: fetchErr } = await supabase
                .from('users')
                .select('id, stones_balance, generated_alias')
                .eq('id', req.params.userId)
                .single();
            if (fetchErr || !uRow) return res.status(404).json({ error: 'User not found' });

            const newBalance = Math.max(0, Number(uRow.stones_balance || 0) + amount);
            const { error: updErr } = await supabase
                .from('users')
                .update({ stones_balance: newBalance })
                .eq('id', req.params.userId);
            if (updErr) throw updErr;

            await supabase.from('stone_transactions').insert({
                user_id: req.params.userId,
                amount,
                tx_type: 'admin_reward',
                description: `${reason} (${amount > 0 ? '+' : ''}${amount} 💎)`
            });

            await logAdminAction(admin.email, 'reward_stones', 'user', req.params.userId, {
                amount,
                reason,
                alias: uRow.generated_alias,
                newBalance
            });

            res.json({ success: true, userId: req.params.userId, stones_balance: newBalance });
        } catch (err: any) {
            console.error('Admin reward user error:', err);
            res.status(500).json({ error: 'Failed to award stones' });
        }
    });
}
