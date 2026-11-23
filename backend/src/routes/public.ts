import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import type { AnalyticsEngine } from '../analytics';
import { isAllowedEwuEmail } from '../supabase';
import { EWU_CAMPUS_ICEBREAKERS } from '../ewu_helper';
import { StonesKnapsackCoinEngine } from '../algorithms/stones_knapsack_coin_dp';
import { weeklyGrowthStreak } from '../algorithms/sequence_dp';
import { generateServerNickname, generateServerNicknameBatch } from '../nickname_engine';

export interface PublicRoutesDeps {
    supabase: SupabaseClient;
    redis: Redis;
    analytics: AnalyticsEngine;
    activeUsers: Map<string, any>;
    userSocketMap: Map<string, string>;
    requireAdminKey: express.RequestHandler;
    authRegisterRateLimiter: express.RequestHandler;
    DEFAULT_BENCH_TOPIC: string;
}

export function registerPublicRoutes(app: express.Express, deps: PublicRoutesDeps) {
    const {
        supabase,
        analytics,
        activeUsers,
        userSocketMap,
        requireAdminKey,
        authRegisterRateLimiter,
        DEFAULT_BENCH_TOPIC
    } = deps;

    async function getBearerUser(req: express.Request) {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (!token) return null;
        const {
            data: { user },
            error
        } = await supabase.auth.getUser(token);
        if (error || !user || !isAllowedEwuEmail(user.email)) return null;
        return user;
    }

    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'benchly-backend', uptime: process.uptime() });
    });

    app.get('/api/analytics/realtime', requireAdminKey, async (_req, res) => {
        try {
            const metrics = await analytics.getRealtimeMetrics();
            res.json(metrics);
        } catch (err: any) {
            console.error('Realtime analytics error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/analytics/summary', requireAdminKey, async (_req, res) => {
        try {
            const summary = await analytics.getAggregatedSummary();
            res.json(summary);
        } catch (err: any) {
            console.error('Summary analytics error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/icebreakers', (_req, res) => {
        res.json({ icebreakers: EWU_CAMPUS_ICEBREAKERS });
    });

    app.get('/api/student/analytics', async (req, res) => {
        try {
            const authUser = await getBearerUser(req);
            if (!authUser) return res.status(401).json({ error: 'Unauthorized' });
            const rawTimeframe = String(req.query.timeframe || 'weekly').toLowerCase();
            const timeframe = ['daily', 'weekly', 'monthly'].includes(rawTimeframe) ? rawTimeframe : 'weekly';

            const { data, error } = await supabase.rpc('get_student_analytics', {
                p_user_id: authUser.id,
                p_timeframe: timeframe
            });
            if (error) throw error;

            return res.json(data);
        } catch (err: any) {
            console.error('Student analytics error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * Growth streak (CSE246 L11 / Lab 6): LIS over the student's weekly chat counts for the last
     * 12 weeks, via patience sorting (O(n log n)). Longest run of active weeks, not necessarily
     * consecutive, in which the number of chats strictly increased.
     */
    app.get('/api/student/growth', async (req, res) => {
        try {
            const authUser = await getBearerUser(req);
            if (!authUser) return res.status(401).json({ error: 'Unauthorized' });
            const since = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data: rows, error } = await supabase
                .from('chat_sessions')
                .select('created_at')
                .eq('user_id', authUser.id)
                .gte('created_at', since)
                .limit(5000);
            if (error) throw error;
            return res.json(weeklyGrowthStreak((rows || []).map((r: any) => new Date(r.created_at).getTime())));
        } catch (err: any) {
            console.error('Student growth error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/auth/campus-register', authRegisterRateLimiter, async (req, res) => {
        const rawEmail = (req.body?.email || '').toString().trim().toLowerCase();
        const password = (req.body?.password || '').toString();

        if (!isAllowedEwuEmail(rawEmail)) {
            return res.status(400).json({ error: 'Only official @std.ewubd.edu student emails are allowed.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }

        try {
            const { error } = await supabase.auth.signUp({
                email: rawEmail,
                password,
                options: { emailRedirectTo: 'https://benchly.live/' }
            });
            if (error) {
                console.error('Campus register error:', error.message);
                return res
                    .status(400)
                    .json({ error: 'Unable to complete registration. Check your email or try signing in.' });
            }
            return res.json({
                success: true,
                requiresEmailVerification: true,
                message: 'Verification link sent to your @std.ewubd.edu email. Please verify before signing in.'
            });
        } catch (err: any) {
            console.error('Campus register unexpected error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.delete('/api/account', async (req, res) => {
        try {
            const authUser = await getBearerUser(req);
            if (!authUser) return res.status(401).json({ error: 'Unauthorized' });
            const { error } = await supabase.auth.admin.deleteUser(authUser.id);
            if (error) {
                console.error('Delete account error:', error.message);
                return res.status(500).json({ error: 'Failed to delete account.' });
            }
            return res.json({ success: true });
        } catch (err: any) {
            console.error('Delete account unexpected error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/stones/optimize', async (req, res) => {
        const rawStones = parseInt((req.query.stones as string) || '12', 10);
        const rawTarget = parseInt((req.query.target as string) || '6', 10);
        const walletStones = Math.max(0, Math.min(200, Number.isNaN(rawStones) ? 12 : rawStones));
        const targetGoal = Math.max(1, Math.min(200, Number.isNaN(rawTarget) ? 6 : rawTarget));
        try {
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
            const exactBudgetBacktrack = StonesKnapsackCoinEngine.solveExactBudgetBacktracking(activePerks, walletStones);
            res.json({ knapsack, coinChange, exactBudgetBacktrack, perks: activePerks });
        } catch (err: any) {
            console.error('Stones optimize error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/profile/options', async (_req, res) => {
        try {
            const [{ data: deptRows }, { data: semRows }] = await Promise.all([
                supabase.from('ewu_departments').select('code, label').order('sort_order', { ascending: true }),
                supabase.from('ewu_semesters').select('code, kind').order('sort_order', { ascending: true })
            ]);

            const departments =
                deptRows && deptRows.length > 0
                    ? deptRows.map((d: any) => d.code)
                    : ['CSE', 'EEE', 'BBA', 'English', 'Pharmacy', 'Economics', 'Law', 'Civil', 'Data Science', 'ICE', 'GEB', 'Sociology', 'IS', 'MPS', 'MBA', 'Other'];

            const currentSemesters =
                semRows && semRows.length > 0
                    ? semRows.filter((s: any) => s.kind === 'current').map((s: any) => s.code)
                    : Array.from({ length: 12 }, (_, i) => {
                          const n = i + 1;
                          const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
                          return `${n}${suffix} Sem`;
                      }).concat(['Grad / Masters']);

            const admittedSemesters =
                semRows && semRows.length > 0
                    ? semRows.filter((s: any) => s.kind === 'admitted').map((s: any) => s.code)
                    : (() => {
                          const nowYear = new Date().getFullYear();
                          const list: string[] = [];
                          for (let y = nowYear; y >= nowYear - 5; y--) {
                              list.push(`Fall ${y}`, `Summer ${y}`, `Spring ${y}`);
                          }
                          list.push(`Before ${nowYear - 5}`);
                          return list;
                      })();

            res.json({
                source: deptRows && deptRows.length > 0 && semRows && semRows.length > 0 ? 'database' : 'dynamic_fallback',
                departments,
                currentSemesters,
                admittedSemesters
            });
        } catch (err: any) {
            console.error('Profile options error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/profile/nicknames/suggestions', async (req, res) => {
        try {
            const count = Math.min(12, Math.max(4, parseInt((req.query.count as string) || '6', 10)));
            const candidates = generateServerNicknameBatch(count + 4);
            const { data: taken } = await supabase
                .from('users')
                .select('generated_alias')
                .in('generated_alias', candidates);

            const takenSet = new Set((taken || []).map((r: any) => r.generated_alias));
            const available = candidates.filter((c) => !takenSet.has(c)).slice(0, count);
            res.json({ suggestions: available.length > 0 ? available : candidates.slice(0, count) });
        } catch {
            res.json({ suggestions: generateServerNicknameBatch(6) });
        }
    });

    app.get('/api/profile/me', async (req, res) => {
        try {
            const authUser = await getBearerUser(req);
            if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

            const { data: profile, error } = await supabase
                .from('users')
                .select('id, generated_alias, gender, dept_code, batch_year, semester_intake, alias_change_count, alias_changed_at')
                .eq('id', authUser.id)
                .single();

            if (error || !profile) return res.status(404).json({ error: 'Profile not found' });

            const meta = (authUser.user_metadata || {}) as Record<string, any>;
            res.json({
                alias: profile.generated_alias,
                gender: profile.gender,
                deptCode: profile.dept_code || meta.dept_code || 'CSE',
                currentSemester: profile.semester_intake || meta.current_semester || null,
                admittedSemester: meta.admitted_semester || null,
                realName: meta.real_name || '',
                realAge: meta.real_age ? Number(meta.real_age) : null,
                allowGuessing: meta.allow_guessing !== false,
                aliasChangeCount: profile.alias_change_count || 0
            });
        } catch (err: any) {
            console.error('Profile load error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/profile/update', async (req, res) => {
        try {
            const authUser = await getBearerUser(req);
            if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

            const { data: current, error: fetchErr } = await supabase
                .from('users')
                .select('generated_alias, dept_code, batch_year, semester_intake, alias_change_count')
                .eq('id', authUser.id)
                .single();

            if (fetchErr || !current) return res.status(404).json({ error: 'Profile not found' });

            const body = req.body || {};
            let nextAlias: string = current.generated_alias;

            if (body.rollRandom === true) {
                for (let attempt = 0; attempt < 6; attempt++) {
                    const candidate = generateServerNickname();
                    const { data: exists } = await supabase
                        .from('users')
                        .select('id')
                        .eq('generated_alias', candidate)
                        .maybeSingle();
                    if (!exists) {
                        nextAlias = candidate;
                        break;
                    }
                }
            } else if (typeof body.newAlias === 'string' && body.newAlias.trim().length > 0) {
                const trimmed = body.newAlias.trim();
                if (trimmed.length < 3 || trimmed.length > 28) {
                    return res.status(400).json({ error: 'Nickname must be 3 to 28 characters.' });
                }
                nextAlias = trimmed;
            }

            const aliasChanged = nextAlias !== current.generated_alias;
            const deptCode =
                typeof body.deptCode === 'string' && body.deptCode.trim()
                    ? body.deptCode.trim()
                    : current.dept_code || 'CSE';
            const currentSemester =
                typeof body.currentSemester === 'string' && body.currentSemester.trim()
                    ? body.currentSemester.trim()
                    : current.semester_intake || null;

            const existingMeta = (authUser.user_metadata || {}) as Record<string, any>;
            const admittedSemester =
                body.admittedSemester !== undefined
                    ? body.admittedSemester
                        ? String(body.admittedSemester).trim()
                        : null
                    : existingMeta.admitted_semester || null;
            const realName =
                body.realName !== undefined
                    ? String(body.realName || '').trim().slice(0, 40)
                    : existingMeta.real_name || '';
            const parsedAge =
                body.realAge !== undefined && body.realAge !== null && body.realAge !== ''
                    ? Math.max(15, Math.min(45, parseInt(String(body.realAge), 10) || 0))
                    : existingMeta.real_age
                      ? Number(existingMeta.real_age)
                      : null;
            const realAge = parsedAge && parsedAge >= 15 ? parsedAge : null;
            const allowGuessing =
                body.allowGuessing !== undefined
                    ? Boolean(body.allowGuessing)
                    : existingMeta.allow_guessing !== false;

            const userUpdates: Record<string, any> = {
                dept_code: deptCode,
                semester_intake: currentSemester
            };
            if (aliasChanged) {
                userUpdates.generated_alias = nextAlias;
                userUpdates.alias_changed_at = new Date().toISOString();
                userUpdates.alias_change_count = (current.alias_change_count || 0) + 1;
            }

            const { error: updateErr } = await supabase.from('users').update(userUpdates).eq('id', authUser.id);
            if (updateErr) {
                if (updateErr.message.toLowerCase().includes('unique')) {
                    return res.status(409).json({ error: 'That nickname is already taken on campus — try another!' });
                }
                throw updateErr;
            }

            await supabase.auth.admin.updateUserById(authUser.id, {
                user_metadata: {
                    ...existingMeta,
                    dept_code: deptCode,
                    current_semester: currentSemester,
                    admitted_semester: admittedSemester,
                    real_name: realName,
                    real_age: realAge,
                    allow_guessing: allowGuessing
                }
            });

            if (aliasChanged) {
                await supabase.from('alias_history').insert({
                    user_id: authUser.id,
                    old_alias: current.generated_alias,
                    new_alias: nextAlias,
                    change_type: 'manual'
                });
            }

            const shortYear = String(current.batch_year || '2024').slice(-2);
            const liveBadge = currentSemester ? `${deptCode} • ${currentSemester}` : `${deptCode} '${shortYear}`;

            const sockId = userSocketMap.get(authUser.id);
            if (sockId && activeUsers.has(sockId)) {
                const liveUser = activeUsers.get(sockId);
                liveUser.alias = nextAlias;
                liveUser.dept_code = deptCode;
                liveUser.current_semester = currentSemester;
                liveUser.admitted_semester = admittedSemester;
                liveUser.real_name = realName || null;
                liveUser.real_age = realAge;
                liveUser.allow_guessing = allowGuessing;
                liveUser.badge = liveBadge;
                activeUsers.set(sockId, liveUser);
            }

            return res.json({
                success: true,
                alias: nextAlias,
                deptCode,
                currentSemester,
                admittedSemester,
                realName,
                realAge,
                allowGuessing,
                badge: liveBadge
            });
        } catch (err: any) {
            console.error('Profile update error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/campus/config', async (req, res) => {
        try {
            const [{ data: setting }, { data: campaigns }] = await Promise.all([
                supabase.from('app_settings').select('value').eq('key', 'todays_bench_topic').maybeSingle(),
                supabase.from('reward_campaigns').select('*').eq('is_active', true).order('created_at', { ascending: false })
            ]);

            const todaysBenchTopic = setting?.value || DEFAULT_BENCH_TOPIC;
            let userMetrics = { streak_days: 0, total_chats: 0, referrals: 0 };
            const claimedIds = new Set<string>();

            const authUser = await getBearerUser(req);
            if (authUser) {
                const [{ data: uRow }, { data: claims }] = await Promise.all([
                    supabase.from('users').select('streak_count, total_chats, total_referrals').eq('id', authUser.id).maybeSingle(),
                    supabase.from('user_campaign_claims').select('campaign_id').eq('user_id', authUser.id)
                ]);
                if (uRow) {
                    userMetrics = {
                        streak_days: Number(uRow.streak_count || 0),
                        total_chats: Number(uRow.total_chats || 0),
                        referrals: Number(uRow.total_referrals || 0)
                    };
                }
                for (const c of claims || []) claimedIds.add(c.campaign_id);
            }

            const activeCampaigns = (campaigns || []).map((c: any) => {
                const progress =
                    c.metric_type === 'streak_days'
                        ? userMetrics.streak_days
                        : c.metric_type === 'total_chats'
                          ? userMetrics.total_chats
                          : userMetrics.referrals;
                const claimed = claimedIds.has(c.id);
                return {
                    ...c,
                    current_progress: progress,
                    claimed,
                    can_claim: !claimed && progress >= Number(c.target_value || 1)
                };
            });

            res.json({ todaysBenchTopic, activeCampaigns });
        } catch (err: any) {
            console.error('Campus config error:', err);
            res.json({ todaysBenchTopic: DEFAULT_BENCH_TOPIC, activeCampaigns: [] });
        }
    });

    app.post('/api/campaigns/:campaignId/claim', async (req, res) => {
        try {
            const authUser = await getBearerUser(req);
            if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

            const campaignId = req.params.campaignId;
            const { data: camp } = await supabase
                .from('reward_campaigns')
                .select('*')
                .eq('id', campaignId)
                .eq('is_active', true)
                .maybeSingle();
            if (!camp) return res.status(404).json({ error: 'Campaign not found or inactive' });

            const { data: existing } = await supabase
                .from('user_campaign_claims')
                .select('id')
                .eq('user_id', authUser.id)
                .eq('campaign_id', campaignId)
                .maybeSingle();
            if (existing) return res.status(400).json({ error: 'Campaign reward already claimed' });

            const { data: uRow } = await supabase
                .from('users')
                .select('stones_balance, streak_count, total_chats, total_referrals')
                .eq('id', authUser.id)
                .single();

            const progress =
                camp.metric_type === 'streak_days'
                    ? Number(uRow?.streak_count || 0)
                    : camp.metric_type === 'total_chats'
                      ? Number(uRow?.total_chats || 0)
                      : Number(uRow?.total_referrals || 0);

            if (progress < Number(camp.target_value)) {
                return res.status(400).json({ error: `Goal not reached yet (${progress}/${camp.target_value})` });
            }

            const newBalance = Number(uRow?.stones_balance || 0) + Number(camp.reward_stones);
            await supabase.from('user_campaign_claims').insert({
                user_id: authUser.id,
                campaign_id: campaignId,
                reward_stones: camp.reward_stones
            });
            await supabase.from('users').update({ stones_balance: newBalance }).eq('id', authUser.id);
            await supabase.from('stone_transactions').insert({
                user_id: authUser.id,
                amount: camp.reward_stones,
                tx_type: 'campaign_reward',
                description: `Claimed campaign: ${camp.title} (+${camp.reward_stones} 💎)`
            });

            res.json({ success: true, awarded: camp.reward_stones, stones_balance: newBalance });
        } catch (err: any) {
            console.error('Claim campaign error:', err);
            res.status(500).json({ error: 'Failed to claim campaign reward' });
        }
    });
}
