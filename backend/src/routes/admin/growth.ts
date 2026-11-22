import express from 'express';
import type { AdminHelpers, AdminRoutesDeps } from './helpers';

export function registerAdminGrowthRoutes(
    app: express.Express,
    deps: AdminRoutesDeps,
    helpers: AdminHelpers
) {
    const { supabase } = deps;
    const { requireAdmin, computeChatQualityStats } = helpers;

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

            const dailyMap = new Map<string, { visitors: Set<string>; pageviews: number }>();
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(nowMs - i * 86400000 + 6 * 3600 * 1000);
                dailyMap.set(d.toISOString().split('T')[0], { visitors: new Set(), pageviews: 0 });
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
                    const bucket = dailyMap.get(bdtDate.toISOString().split('T')[0]);
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

                if (ev.platform === 'android') platforms.android++;
                else {
                    platforms.web++;
                    if (ev.device_type === 'mobile') platforms.mobileWeb++;
                    else platforms.desktopWeb++;
                }

                if (ev.event_type === 'landing_view' || ev.event_type === 'invite_link_clicked') {
                    const refRaw = (ev.utm_source || ev.referrer || '').toString().trim();
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
                    const hrBdt = new Date(tsMs + 6 * 3600 * 1000).getUTCHours();
                    if (hrBdt >= 0 && hrBdt < 24) hourlyBdtCounts[hrBdt] += 1;
                }
            }

            const active24h = new Set<string>();
            const active7d = new Set<string>();
            const active30d = new Set<string>();
            const deptCounts = new Map<string, number>();
            const sessTimesByUser = new Map<string, number[]>();

            for (const s of recentSessions) {
                if (!s.user_id || !s.created_at) continue;
                const ts = new Date(s.created_at).getTime();
                active30d.add(s.user_id);
                if (ts >= since7dMs) active7d.add(s.user_id);
                if (ts >= since24hMs) active24h.add(s.user_id);
                const list = sessTimesByUser.get(s.user_id) || [];
                list.push(ts);
                sessTimesByUser.set(s.user_id, list);
            }

            let d1Eligible = 0, d1Retained = 0, d7Eligible = 0, d7Retained = 0;
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
                    const latestAct = Math.max(loginMs, ...(sessTimesByUser.get(u.id) || []), 0);
                    if (createdMs <= twoDaysAgoMs) {
                        d1Eligible++;
                        if (latestAct >= createdMs + 86400000) d1Retained++;
                    }
                    if (createdMs <= eightDaysAgoMs) {
                        d7Eligible++;
                        if (latestAct >= createdMs + 7 * 86400000) d7Retained++;
                    }
                }
            }

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
            for (const s of recentSessions) if (s.user_id) matchedSet.add(s.user_id);

            const dau = active24h.size;
            const mau = active30d.size;
            res.json({
                days,
                visitors: {
                    unique24h: uniq24h.size,
                    unique7d: uniq7d.size,
                    unique30d: uniq30d.size,
                    pageviews7d,
                    pageviews30d: events.length,
                    dailySeries: Array.from(dailyMap.entries()).map(([date, info]) => ({
                        date,
                        uniqueVisitors: info.visitors.size,
                        pageviews: info.pageviews
                    }))
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
                    wau: active7d.size,
                    mau,
                    stickinessPct: mau > 0 ? Math.round((dau / mau) * 100) : 0,
                    d1RetentionPct: d1Eligible > 0 ? Math.round((d1Retained / d1Eligible) * 100) : 0,
                    d7RetentionPct: d7Eligible > 0 ? Math.round((d7Retained / d7Eligible) * 100) : 0
                },
                chatQuality: computeChatQualityStats(allRooms, extensionsCount),
                roomsInWindowCount: allRooms.filter((r: any) => !r.closed_at || r.closed_at >= sinceDaysIso).length,
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
}
