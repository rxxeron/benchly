import express from 'express';
import type { AdminHelpers, AdminRoutesDeps } from './helpers';
import { BenchlyPiiShield } from '../../algorithms/pii_shield_engine';
import { StonesKnapsackCoinEngine, MAX_STONES_BUDGET } from '../../algorithms/stones_knapsack_coin_dp';
import { MatchEdge, greedyMatching, solveBatchMatching } from '../../algorithms/batch_matcher';
import { lcsMemo } from '../../algorithms/sequence_dp';
import { BATCH_STATS_KEY, BATCH_WINDOW_MS } from '../../sockets/matchmaking_handlers';
import { BenchlyBacktrackingEngine } from '../../algorithms/backtracking_solver';
import { AiCampusCompanionEngine } from '../../ai_campus_companion';

export function registerAdminAnalyticsRoutes(
    app: express.Express,
    deps: AdminRoutesDeps,
    helpers: AdminHelpers
) {
    const { supabase, redis, analytics } = deps;
    const { requireAdmin, computeChatQualityStats } = helpers;

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

    app.get('/api/admin/system-health', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const redisStart = Date.now();
            let redisOk = true;
            let redisPingMs = 0;
            const redisMode = process.env.REDIS_URL ? 'External Redis' : 'In-Memory Valkey';
            try {
                if (typeof redis.ping === 'function') {
                    await redis.ping();
                } else {
                    await redis.get('__health_check__');
                }
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

            const mem = process.memoryUsage();
            res.json({
                server: {
                    uptimeSeconds: Math.floor(process.uptime()),
                    rssMemoryMb: Math.round(mem.rss / 1024 / 1024),
                    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                    nodeVersion: process.version,
                    platform: process.platform
                },
                redis: { ok: redisOk, pingMs: redisPingMs, mode: redisMode },
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
                        totalBytesSaved: Math.max(0, totalOriginalBytes - totalCompressedBytes),
                        avgSavingsPct:
                            pctSamples.length > 0
                                ? Number((pctSamples.reduce((a, b) => a + b, 0) / pctSamples.length).toFixed(2))
                                : 0
                    }
                },
                economy: { totalStonesInCirculation, earlyBirdAvatars }
            });
        } catch (err: any) {
            console.error('Admin system health error:', err);
            res.status(500).json({ error: err?.message || 'Failed to check system health' });
        }
    });

    app.get('/api/admin/algorithms/workflows', async (req, res) => {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
            const walletStones = Math.max(
                0,
                Math.min(MAX_STONES_BUDGET, parseInt((req.query.stones as string) || '13', 10) || 13)
            );
            const targetGoal = Math.max(
                0,
                Math.min(MAX_STONES_BUDGET, parseInt((req.query.target as string) || '12', 10) || 12)
            );
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

            // Batch matcher demo: the classic greedy trap (path A-B-C-D, heavy middle edge B-C).
            const demoNames = ['Arif (CSE)', 'Bushra (EEE)', 'Chandni (BBA)', 'Dipto (CSE)'];
            const demoEdges: MatchEdge[] = [
                { u: 0, v: 1, w: 60 },
                { u: 1, v: 2, w: 100 },
                { u: 2, v: 3, w: 60 }
            ];
            const demoSolved = solveBatchMatching(demoNames.length, demoEdges);
            const demoGreedy = greedyMatching(demoNames.length, demoEdges);
            const toNames = (pairs: MatchEdge[]) => pairs.map(p => ({ a: demoNames[p.u], b: demoNames[p.v], w: p.w }));

            // Live batch ticks recorded by the matchmaker (most recent first)
            const rawTicks: string[] = await redis.lrange(BATCH_STATS_KEY, 0, 49).catch(() => [] as string[]);
            const ticks = rawTicks
                .map(t => {
                    try {
                        return JSON.parse(t);
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
            const sum = (k: string) => ticks.reduce((acc: number, t: any) => acc + (Number(t[k]) || 0), 0);

            const strippedSample = sampleMessage.toLowerCase().replace(/[^a-z0-9]/g, '');
            const lcsTarget = 'instagramcom';
            const lcsTop = lcsMemo(strippedSample.slice(0, 200), lcsTarget);

            res.json({
                inputs: { walletStones, targetGoal, sampleMessage },
                knapsack: StonesKnapsackCoinEngine.solve01KnapsackPerks(activePerks, walletStones),
                coinChange: StonesKnapsackCoinEngine.solveCoinChangeMilestones(targetGoal, [1, 3, 4, 5, 7, 10]),
                subsetSumBacktrack: StonesKnapsackCoinEngine.solveExactBudgetBacktracking(activePerks, walletStones),
                loungeColoringBacktrack: BenchlyBacktrackingEngine.solveConflictFreeLoungeColoring(
                    [
                        { id: 'Student_A', conflicts: new Set(['Student_B', 'Student_C']) },
                        { id: 'Student_B', conflicts: new Set(['Student_A', 'Student_C']) },
                        { id: 'Student_C', conflicts: new Set(['Student_A', 'Student_B']) },
                        { id: 'Student_D', conflicts: new Set(['Student_A']) },
                        { id: 'Student_E', conflicts: new Set<string>() }
                    ],
                    4,
                    5
                ),
                batchMatching: {
                    windowMs: BATCH_WINDOW_MS,
                    demo: {
                        students: demoNames,
                        edges: demoEdges.map(e => ({ a: demoNames[e.u], b: demoNames[e.v], w: e.w })),
                        solverPairs: toNames(demoSolved.pairs),
                        greedyPairs: toNames(demoGreedy),
                        components: demoSolved.components
                    },
                    live: {
                        ticks: ticks.slice(0, 15),
                        tickCount: ticks.length,
                        studentsSeen: sum('poolSize'),
                        solverMatched: sum('solverMatchedStudents'),
                        greedyMatched: sum('greedyMatchedStudents'),
                        solverWeight: sum('solverWeight'),
                        greedyWeight: sum('greedyWeight')
                    }
                },
                piiShield: {
                    verdict: BenchlyPiiShield.sanitizeLiveMessage(sampleMessage),
                    kmpLpsSample: {
                        pattern: 'instagramcom',
                        lpsTable: BenchlyPiiShield.buildKmpLps('instagramcom')
                    },
                    rabinKarp: {
                        window: BenchlyPiiShield.RK_WINDOW,
                        normalized: strippedSample.slice(0, 200),
                        windowHashes: BenchlyPiiShield.rollingWindowHashes(
                            strippedSample.slice(0, 200),
                            BenchlyPiiShield.RK_WINDOW
                        ).slice(0, 8)
                    },
                    lcs: {
                        target: lcsTarget,
                        length: lcsTop.length,
                        memoSubproblems: lcsTop.subproblemsSolved,
                        tableCells: Math.min(200, strippedSample.length) * lcsTarget.length
                    }
                }
            });
        } catch (err: any) {
            console.error('Admin algorithm workflows error:', err);
            res.status(500).json({ error: 'Failed to run algorithm workflows' });
        }
    });
}
