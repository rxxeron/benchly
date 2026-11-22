import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';
import { authenticateSocket, isAllowedEwuEmail, supabase } from './supabase';
import { redis, findOrCreate1v1Match, joinOrCreateGroupLounge, applyCooldown, removeUserFromQueues } from './matchmaker';
import { AnalyticsEngine } from './analytics';
import { getRandomIcebreaker, EWU_CAMPUS_ICEBREAKERS } from './ewu_helper';
import { CanonicalHuffmanCodec, EncryptedHuffmanArchive } from './algorithms/huffman_codec';
import { BenchlyPiiShield } from './algorithms/pii_shield_engine';
import { StonesKnapsackCoinEngine } from './algorithms/stones_knapsack_coin_dp';
import { BenchlyBacktrackingEngine } from './algorithms/backtracking_solver';
import { generateServerNickname, generateServerNicknameBatch } from './nickname_engine';
import { AiCampusCompanionEngine, AiRoomSession } from './ai_campus_companion';

dotenv.config();

const ADMIN_EMAIL = 'rhrakibulhasan279@gmail.com';
const AI_FALLBACK_DELAY_MS = Math.max(4, parseInt(process.env.AI_FALLBACK_SECONDS || '12', 10) || 12) * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';
const CHAT_DURATION_MS = 15 * 60 * 1000;
const CHAT_WARNING_MS = 14 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_GUESSES_PER_ROOM = 10;
const GUESS_COOLDOWN_MS = 2000;

// Allowed origins for CORS (Express + Socket.IO)
const DEFAULT_ALLOWED_ORIGINS = [
    'https://benchly.live',
    'https://www.benchly.live',
    'https://app.benchly.live',
    'https://api.benchly.live',
    'https://admin.benchly.live',
    ...(IS_PROD ? [] : [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:8080'
    ])
];
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
const EFFECTIVE_ORIGINS = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;

const ALLOWED_HOSTNAMES = new Set([
    'benchly.live',
    'www.benchly.live',
    'app.benchly.live',
    'api.benchly.live',
    'admin.benchly.live',
    'labpc1.benchly.live',
    'labpc25.benchly.live',
    'labpc26.benchly.live',
    'labpc31.benchly.live',
    'labpc1',
    'labpc25',
    'labpc26',
    'labpc31'
]);

function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true; // Allow native mobile apps & same-origin/non-browser clients
    if (EFFECTIVE_ORIGINS.includes(origin)) return true;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        if (ALLOWED_HOSTNAMES.has(host)) return true;
    } catch {}
    return false;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// HTTP Security Headers (Zero-dependency Helmet equivalent)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.benchly.live wss://api.benchly.live https://accounts.google.com ws://localhost:* http://localhost:*; frame-ancestors 'none'; base-uri 'self';"
    );
    if (IS_PROD) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
}));
app.use(express.json({ limit: '32kb' }));

// Simple sliding-window in-memory HTTP rate limiter
function createHttpRateLimiter(windowMs: number, maxRequests: number) {
    const hits = new Map<string, { count: number; resetAt: number }>();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits.entries()) {
            if (now >= v.resetAt) hits.delete(k);
        }
    }, Math.min(windowMs, 60_000)).unref();

    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = hits.get(ip);
        if (!entry || now >= entry.resetAt) {
            hits.set(ip, { count: 1, resetAt: now + windowMs });
            return next();
        }
        entry.count += 1;
        if (entry.count > maxRequests) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        return next();
    };
}

const apiRateLimiter = createHttpRateLimiter(60 * 1000, 60);
const authRegisterRateLimiter = createHttpRateLimiter(15 * 60 * 1000, 5);
app.use('/api/', apiRateLimiter);

function requireAdminKey(req: express.Request, res: express.Response, next: express.NextFunction) {
    const expected = process.env.ADMIN_API_KEY || '';
    if (!expected) {
        return res.status(503).json({ error: 'Admin analytics endpoint is not configured.' });
    }
    const provided = String(req.headers['x-admin-key'] || '');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
}

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 16 * 1024 // 16 KB max Socket.IO frame
});

const analytics = new AnalyticsEngine(redis);

// Mappings for active users, socket routing, and rooms
const activeUsers = new Map<string, any>();
const userSocketMap = new Map<string, string>();
const roomTimeouts = new Map<string, NodeJS.Timeout[]>();
const roomScreenshotVotes = new Map<string, Set<string>>();
const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();
const DISCONNECT_GRACE_MS = 15 * 1000; // 15s grace window for browser refresh / mobile network blip
interface RoomSessionData {
    user1: string;
    user2: string;
    user1Alias?: string;
    user2Alias?: string;
    startTime: number;
    user1Messages: number;
    user2Messages: number;
    recorded?: boolean;
}

const roomMembers = new Map<string, RoomSessionData>();
const handshakeVotes = new Map<string, Set<string>>();
const queueTimeouts = new Map<string, NodeJS.Timeout>();
const aiRoomSessions = new Map<string, AiRoomSession>();
const pendingGuessReveals = new Map<
    string,
    {
        roomId: string;
        guesserId: string;
        guesserSocketId: string;
        guesserAlias: string;
        partnerId: string;
        partnerAlias: string;
        field: string;
        fieldLabel: string;
        revealedValue: string;
        createdAt: number;
    }
>();
const guessAttempts = new Map<string, { count: number; lastAt: number }>();

async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
    if (!roomId || !userId) return false;
    const mem = roomMembers.get(roomId);
    if (mem && (mem.user1 === userId || mem.user2 === userId)) {
        return true;
    }
    if (roomId.startsWith('group_')) {
        const isGroupMem = await redis.sismember(`group_members:${roomId}`, userId).catch(() => 0);
        return Boolean(isGroupMem);
    }
    return false;
}

async function saveRoomSession(roomId: string) {
    const mem = roomMembers.get(roomId);
    if (!mem || mem.recorded) return;
    mem.recorded = true;

    const durationSec = Math.max(1, Math.round((Date.now() - mem.startTime) / 1000));
    try {
        // 1. Fetch entire chat message transcript from Redis
        const rawMsgs = await redis.lrange(`room_messages:${roomId}`, 0, -1);
        const messagesList = rawMsgs.map((m: string) => {
            try { return JSON.parse(m); } catch (e) { return null; }
        }).filter(Boolean);

        const isHandshakeAgreed = (await redis.get(`room:${roomId}:handshake_agreed`)) === 'true';

        // 1.5 Compress transcript via CSE246 Canonical Huffman Coding & seal with AES-256-GCM before single-row archive
        const rawTranscriptJson = JSON.stringify(messagesList);
        const sealedArchive = CanonicalHuffmanCodec.sealEncryptedHuffmanArchive(rawTranscriptJson);

        // 2. Persist entire chat session in ONE SINGLE ROW in room_conversations (zero plaintext at rest)
        const isUuid = (v: string | undefined | null) =>
            Boolean(v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
        const user1Uuid = isUuid(mem.user1) ? mem.user1 : null;
        const user2Uuid = isUuid(mem.user2) ? mem.user2 : null;

        const { error: convErr } = await supabase.from('room_conversations').insert({
            room_id: roomId,
            user1_id: user1Uuid,
            user2_id: user2Uuid,
            user1_alias: mem.user1Alias || 'Anonymous Student',
            user2_alias: mem.user2Alias || 'Anonymous Student',
            messages: [],
            huffman_meta: sealedArchive,
            compression_savings_pct: sealedArchive.savingsPercent,
            messages_count: messagesList.length,
            duration_seconds: durationSec,
            handshake_agreed: isHandshakeAgreed,
            closed_at: new Date().toISOString()
        });
        if (convErr) {
            console.error(`❌ room_conversations insert failed for ${roomId}:`, convErr.message);
        } else {
            console.log(
                `🔐🗜️ Huffman+AES-256-GCM archived room ${roomId}: ${sealedArchive.originalBytes}B -> ${sealedArchive.compressedBytes}B (${sealedArchive.savingsPercent}% saved, H(X)=${sealedArchive.shannonEntropy})`
            );
        }

        // 3. Persist individual student engagement statistics in chat_sessions (real UUID students only)
        const sessionRows: any[] = [];
        if (user1Uuid) {
            sessionRows.push({
                room_id: roomId,
                user_id: user1Uuid,
                partner_id: user2Uuid,
                messages_sent: mem.user1Messages,
                messages_received: mem.user2Messages,
                duration_seconds: durationSec
            });
        }
        if (user2Uuid) {
            sessionRows.push({
                room_id: roomId,
                user_id: user2Uuid,
                partner_id: user1Uuid,
                messages_sent: mem.user2Messages,
                messages_received: mem.user1Messages,
                duration_seconds: durationSec
            });
        }
        if (sessionRows.length > 0) {
            const { error: sessErr } = await supabase.from('chat_sessions').insert(sessionRows);
            if (sessErr) console.error(`❌ chat_sessions insert failed for ${roomId}:`, sessErr.message);
        }

        // 4. Free Redis cache RAM for this concluded room
        await redis.del(
            `room_messages:${roomId}`,
            `room_handshake:${roomId}`,
            `room:${roomId}:handshake_agreed`,
            `room_extension:${roomId}`
        );
        console.log(`💾 Persisted entire room chat (${messagesList.length} msgs) in 1 row to Supabase for room ${roomId}`);
    } catch (err) {
        console.error('Failed to save room conversation / chat_sessions:', err);
    }
}

// 30-minute flusher for long active bench sessions or fulfilling cache
setInterval(async () => {
    const now = Date.now();
    for (const [roomId, mem] of roomMembers.entries()) {
        if (!mem.recorded && (now - mem.startTime) >= 30 * 60 * 1000) {
            console.log(`⏱️ 30-minute threshold reached for room ${roomId}. Archiving whole chat to Supabase.`);
            await saveRoomSession(roomId);
        }
    }
}, 60 * 1000);

const rateLimitMap = new Map<string, number>();
setInterval(() => rateLimitMap.clear(), 1000);

// ==========================================
// REST API Endpoints (Admin Analytics & Health)
// ==========================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'benchly-backend', uptime: process.uptime() });
});

// Real-time telemetry endpoint for Benchly Admin Dashboard (Admin-key protected)
app.get('/api/analytics/realtime', requireAdminKey, async (req, res) => {
    try {
        const metrics = await analytics.getRealtimeMetrics();
        res.json(metrics);
    } catch (err: any) {
        console.error('Realtime analytics error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Aggregated campus intelligence endpoint (Admin-key protected)
app.get('/api/analytics/summary', requireAdminKey, async (req, res) => {
    try {
        const summary = await analytics.getAggregatedSummary();
        res.json(summary);
    } catch (err: any) {
        console.error('Summary analytics error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// EWU Campus Icebreakers endpoint
app.get('/api/icebreakers', (req, res) => {
    res.json({ icebreakers: EWU_CAMPUS_ICEBREAKERS });
});

// Student Engagement Analytics (Daily, Weekly, Monthly) — Authenticated, derives userId from JWT
app.get('/api/student/analytics', async (req, res) => {
    try {
        const authUser = await getBearerUser(req);
        if (!authUser) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
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

// Short URL Bench Invite Redirect (e.g. benchly.live/b/a9x7k2)
app.get('/b/:code', (req, res) => {
    const code = req.params.code;
    res.redirect(`https://benchly.live/?invite=${encodeURIComponent(code)}`);
});

// Campus @std.ewubd.edu Registration Helper (Strictly @std.ewubd.edu only — Requires Email Verification)
app.post('/api/auth/campus-register', authRegisterRateLimiter, async (req, res) => {
    const rawEmail = (req.body?.email || '').toString().trim().toLowerCase();
    const password = (req.body?.password || '').toString();

    if (!isAllowedEwuEmail(rawEmail)) {
        return res.status(400).json({
            error: 'Only official @std.ewubd.edu student emails are allowed.'
        });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    try {
        const { error } = await supabase.auth.signUp({
            email: rawEmail,
            password,
            options: {
                emailRedirectTo: 'https://benchly.live/'
            }
        });
        if (error) {
            console.error('Campus register error:', error.message);
            return res.status(400).json({ error: 'Unable to complete registration. Check your email or try signing in.' });
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

// Authenticated Account Deletion Endpoint
app.delete('/api/account', async (req, res) => {
    try {
        const authUser = await getBearerUser(req);
        if (!authUser) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
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

// Live Campus Stones 0/1 Knapsack & Coin Change DP Optimization Endpoint (Bounded inputs)
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

        const activePerks = perks && perks.length > 0 ? perks : [
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

// ==========================================
// Server-Side Nickname & Student Profile API
// ==========================================

async function getBearerUser(req: express.Request) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user || !isAllowedEwuEmail(user.email)) return null;
    return user;
}

// Database-backed profile options (EWU Departments, Current Semesters, Admitted Semesters)
app.get('/api/profile/options', async (_req, res) => {
    try {
        const [{ data: deptRows }, { data: semRows }] = await Promise.all([
            supabase.from('ewu_departments').select('code, label').order('sort_order', { ascending: true }),
            supabase.from('ewu_semesters').select('code, kind').order('sort_order', { ascending: true }),
        ]);

        const departments = (deptRows && deptRows.length > 0)
            ? deptRows.map((d: any) => d.code)
            : ['CSE', 'EEE', 'BBA', 'English', 'Pharmacy', 'Economics', 'Law', 'Civil', 'Data Science', 'ICE', 'GEB', 'Sociology', 'IS', 'MPS', 'MBA', 'Other'];

        const currentSemesters = (semRows && semRows.length > 0)
            ? semRows.filter((s: any) => s.kind === 'current').map((s: any) => s.code)
            : Array.from({ length: 12 }, (_, i) => {
                const n = i + 1;
                const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
                return `${n}${suffix} Sem`;
            }).concat(['Grad / Masters']);

        const admittedSemesters = (semRows && semRows.length > 0)
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
            source: (deptRows && deptRows.length > 0 && semRows && semRows.length > 0) ? 'database' : 'dynamic_fallback',
            departments,
            currentSemesters,
            admittedSemesters,
        });
    } catch (err: any) {
        console.error('Profile options error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Generate fresh, unique server-side eclectic nicknames (non-coding, non-gaming)
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
    } catch (err: any) {
        res.json({ suggestions: generateServerNicknameBatch(6) });
    }
});

// Fetch authenticated student's full profile (including private guessing fields)
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
            aliasChangeCount: profile.alias_change_count || 0,
        });
    } catch (err: any) {
        console.error('Profile options error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update nickname (anytime, server-side), department, current semester, admitted semester, real name & real age
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
        const rollRandom = body.rollRandom === true;
        let nextAlias: string = current.generated_alias;

        if (rollRandom) {
            // Pick a fresh unique server-side nickname
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
        const deptCode = typeof body.deptCode === 'string' && body.deptCode.trim()
            ? body.deptCode.trim()
            : (current.dept_code || 'CSE');
        const currentSemester = typeof body.currentSemester === 'string' && body.currentSemester.trim()
            ? body.currentSemester.trim()
            : (current.semester_intake || null);

        const existingMeta = (authUser.user_metadata || {}) as Record<string, any>;
        const admittedSemester = body.admittedSemester !== undefined
            ? (body.admittedSemester ? String(body.admittedSemester).trim() : null)
            : (existingMeta.admitted_semester || null);
        const realName = body.realName !== undefined
            ? String(body.realName || '').trim().slice(0, 40)
            : (existingMeta.real_name || '');
        const parsedAge = body.realAge !== undefined && body.realAge !== null && body.realAge !== ''
            ? Math.max(15, Math.min(45, parseInt(String(body.realAge), 10) || 0))
            : (existingMeta.real_age ? Number(existingMeta.real_age) : null);
        const realAge = parsedAge && parsedAge >= 15 ? parsedAge : null;
        const allowGuessing = body.allowGuessing !== undefined
            ? Boolean(body.allowGuessing)
            : (existingMeta.allow_guessing !== false);

        const userUpdates: Record<string, any> = {
            dept_code: deptCode,
            semester_intake: currentSemester,
        };
        if (aliasChanged) {
            userUpdates.generated_alias = nextAlias;
            userUpdates.alias_changed_at = new Date().toISOString();
            userUpdates.alias_change_count = (current.alias_change_count || 0) + 1;
        }

        const { error: updateErr } = await supabase
            .from('users')
            .update(userUpdates)
            .eq('id', authUser.id);

        if (updateErr) {
            if (updateErr.message.toLowerCase().includes('unique')) {
                return res.status(409).json({ error: 'That nickname is already taken on campus — try another!' });
            }
            throw updateErr;
        }

        // Persist private profile & guessing settings in Supabase Auth user_metadata
        await supabase.auth.admin.updateUserById(authUser.id, {
            user_metadata: {
                ...existingMeta,
                dept_code: deptCode,
                current_semester: currentSemester,
                admitted_semester: admittedSemester,
                real_name: realName,
                real_age: realAge,
                allow_guessing: allowGuessing,
            }
        });

        if (aliasChanged) {
            await supabase.from('alias_history').insert({
                user_id: authUser.id,
                old_alias: current.generated_alias,
                new_alias: nextAlias,
                change_type: 'manual',
            });
        }

        const shortYear = String(current.batch_year || '2024').slice(-2);
        const liveBadge = currentSemester ? `${deptCode} • ${currentSemester}` : `${deptCode} '${shortYear}`;

        // Sync live Socket.IO session in RAM if user is connected
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
            badge: liveBadge,
        });
    } catch (err: any) {
        console.error('Profile update error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// Admin Panel JSON API (rhrakibulhasan279@gmail.com)
// ==========================================

async function requireAdmin(req: express.Request, res: express.Response): Promise<{ email: string; id?: string } | null> {
    // 1. Optional header secret for automated admin tooling
    const adminSecret = process.env.ADMIN_SECRET;
    const providedSecret = (req.headers['x-admin-secret'] || '').toString();
    if (adminSecret && providedSecret && adminSecret.length === providedSecret.length) {
        if (timingSafeEqual(Buffer.from(adminSecret), Buffer.from(providedSecret))) {
            return { email: ADMIN_EMAIL };
        }
    }

    // 2. Supabase JWT Bearer authentication for React Admin Web App
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
        res.status(401).json({ error: 'Unauthorized: Admin Bearer token required' });
        return null;
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
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

// 1. Admin Overview & Live Algorithm Telemetry
app.get('/api/admin/overview', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
        const [liveStats, usersCount, reportsCount, roomsRes] = await Promise.all([
            analytics.getRealtimeMetrics(),
            supabase.from('users').select('id', { count: 'exact', head: true }),
            supabase.from('reports').select('id', { count: 'exact', head: true }),
            supabase.from('room_conversations').select('compression_savings_pct').order('closed_at', { ascending: false }).limit(100)
        ]);

        const savingsList = (roomsRes.data || [])
            .map((r: any) => Number(r.compression_savings_pct || 0))
            .filter((n: number) => n > 0);
        const avgHuffmanSavingsPct = savingsList.length > 0
            ? Number((savingsList.reduce((a: number, b: number) => a + b, 0) / savingsList.length).toFixed(2))
            : 0;

        res.json({
            adminEmail: admin.email,
            liveStats,
            totals: {
                users: usersCount.count || 0,
                reports: reportsCount.count || 0,
                archivedRoomsSampled: (roomsRes.data || []).length,
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
            .select('room_id, user1_id, user2_id, user1_alias, user2_alias, messages_count, duration_seconds, handshake_agreed, compression_savings_pct, huffman_meta, closed_at')
            .order('closed_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        const rooms = (data || []).map((row: any) => ({
            roomId: row.room_id,
            user1Alias: row.user1_alias,
            user2Alias: row.user2_alias,
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
            // Legacy plaintext row fallback: compute Huffman compression & tree on-the-fly for inspection
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
        res.json({ reports: data || [] });
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
        res.json({ success: true, report: data });
    } catch (err: any) {
        console.error('Admin resolve report error:', err);
        res.status(500).json({ error: 'Failed to update report' });
    }
});

// 5. User Moderation & Full Telemetry Profiling (List, Deep Profile, Ban/Unban)
app.get('/api/admin/users', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
        const [{ data: rawUsers, error }, { data: sessions }] = await Promise.all([
            supabase
                .from('users')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200),
            supabase
                .from('chat_sessions')
                .select('user_id, partner_id, messages_sent, messages_received, duration_seconds, created_at')
                .limit(5000)
        ]);
        if (error) throw error;

        // Aggregate per-user telemetry in O(S)
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
            supabase
                .from('user_perks')
                .select('perk_id, is_equipped, unlocked_at')
                .eq('user_id', userId),
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
        res.json({ success: true, user: data });
    } catch (err: any) {
        console.error('Admin ban error:', err);
        res.status(500).json({ error: 'Failed to update ban status' });
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

        const activePerks = perks && perks.length > 0 ? perks : [
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

// 7. Dynamic Today's Bench Topic & Custom Reward Campaigns (Public + Admin)
const DEFAULT_BENCH_TOPIC =
    'Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?';

app.get('/api/campus/config', async (req, res) => {
    try {
        const [{ data: setting }, { data: campaigns }] = await Promise.all([
            supabase.from('app_settings').select('value').eq('key', 'todays_bench_topic').maybeSingle(),
            supabase
                .from('reward_campaigns')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
        ]);

        const todaysBenchTopic = setting?.value || DEFAULT_BENCH_TOPIC;
        let userMetrics = { streak_days: 0, total_chats: 0, referrals: 0 };
        const claimedIds = new Set<string>();

        const authUser = await getBearerUser(req);
        if (authUser) {
            const [{ data: uRow }, { data: claims }] = await Promise.all([
                supabase
                    .from('users')
                    .select('streak_count, total_chats, total_referrals')
                    .eq('id', authUser.id)
                    .maybeSingle(),
                supabase
                    .from('user_campaign_claims')
                    .select('campaign_id')
                    .eq('user_id', authUser.id)
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
            return res.status(400).json({
                error: `Goal not reached yet (${progress}/${camp.target_value})`
            });
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

app.get('/api/admin/content', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
        const [{ data: setting }, { data: campaigns }] = await Promise.all([
            supabase.from('app_settings').select('value, updated_at, updated_by').eq('key', 'todays_bench_topic').maybeSingle(),
            supabase.from('reward_campaigns').select('*').order('created_at', { ascending: false })
        ]);
        res.json({
            todaysBenchTopic: setting?.value || DEFAULT_BENCH_TOPIC,
            topicUpdatedAt: setting?.updated_at || null,
            campaigns: campaigns || []
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
        res.json({ success: true, topic });
    } catch (err: any) {
        console.error('Admin update topic error:', err);
        res.status(500).json({ error: 'Failed to update Today\'s Bench Topic' });
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
        if (typeof req.body?.description === 'string' && req.body.description.trim()) updates.description = req.body.description.trim();
        if (req.body?.target_value !== undefined) updates.target_value = Math.max(1, parseInt(req.body.target_value, 10) || 1);
        if (req.body?.reward_stones !== undefined) updates.reward_stones = Math.max(1, parseInt(req.body.reward_stones, 10) || 1);

        const { data, error } = await supabase
            .from('reward_campaigns')
            .update(updates)
            .eq('id', req.params.campaignId)
            .select()
            .maybeSingle();

        if (error) throw error;
        io.emit('campaigns_updated', { action: 'updated' });
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

        res.json({ success: true, userId: req.params.userId, stones_balance: newBalance });
    } catch (err: any) {
        console.error('Admin reward user error:', err);
        res.status(500).json({ error: 'Failed to award stones' });
    }
});

// ==========================================
// WebSocket Real-Time Gateway
// ==========================================

io.on('connection', async (socket) => {
    await analytics.trackUserConnect(socket.id);

    // 1. Authenticate immediately
    const token = socket.handshake.auth.token;
    if (!token) {
        return socket.disconnect();
    }

    try {
        const profile = await authenticateSocket(token);
        activeUsers.set(socket.id, profile);
        userSocketMap.set(profile.id, socket.id);
        socket.join(profile.id); // Guarantee user can be messaged by user ID

        socket.emit('authenticated', {
            alias: profile.alias,
            streak: profile.streak_count,
            badge: profile.badge,
            dept: profile.dept_code,
            aliasRotationDue: profile.aliasRotationDue,
            aliasChangedAt: profile.alias_changed_at,
            aliasChangeCount: profile.alias_change_count
        });

        // Broadcast live campus presence count to connected clients
        io.emit('campus_pulse', { onlineUsers: activeUsers.size });

        // Cancel any pending refresh grace timer for this user
        const graceTimer = disconnectGraceTimers.get(profile.id);
        if (graceTimer) {
            clearTimeout(graceTimer);
            disconnectGraceTimers.delete(profile.id);
        }

        // Auto-resume active 1v1 bench session if student refreshed the page!
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
                                timestamp: parsed.timestamp || Date.now(),
                            };
                        } catch (_) {
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
                    partnerAllowedSs: ssVotes.has(partnerId),
                });
                socket.to(activeRoomId).emit('partner_reconnected', {
                    alias: profile.alias || 'Your partner',
                });
                console.log(`🔄 Auto-resumed room ${activeRoomId} for ${profile.alias} after refresh (${restoredMessages.length} msgs)`);
                break;
            }
        }
    } catch (err) {
        console.error('Auth failed for socket', socket.id);
        return socket.disconnect();
    }

    const user = activeUsers.get(socket.id);

    // 1.5 Handle Alias Rotation (Server-side, anytime, zero cooldown)
    socket.on('rotate_alias', async (data, callback) => {
        try {
            const oldAlias = user.alias;
            let nextAlias = (data?.newAlias || '').toString().trim();
            if (!nextAlias || nextAlias.length < 3) {
                nextAlias = generateServerNickname();
            }

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

    // 1.6 Fun Opt-In "Guess My Vibe" Mini-Game in Live 1v1 Chat (Server-Verified, Membership-Checked & Rate-Limited!)
    socket.on('submit_guess', async (data, callback) => {
        try {
            const roomId = (data?.roomId || '').toString();
            const field = (data?.field || '').toString(); // 'dept' | 'current_semester' | 'admitted_semester' | 'age' | 'real_name'
            const guessRaw = (data?.guess || '').toString().trim().slice(0, 60);
            if (!roomId || !field || !guessRaw) return;

            const members = roomMembers.get(roomId);
            if (!members || (members.user1 !== user.id && members.user2 !== user.id)) {
                if (callback) callback({ success: false, message: 'Forbidden.' });
                return;
            }

            // Enforce per-room attempt cap & cooldown to prevent PII brute-forcing
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
                // Privacy-first: partner MUST approve before revealing a matched guess!
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
                isGuessHit: false,
            });

            if (callback) callback({ success: true, matched: false, message: sysText });
        } catch (e: any) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    // 1.7 Partner Approval / Decline for Matched Guess Reveal
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
                io.to(pending.guesserSocketId).emit('guess_feedback', {
                    ok: false,
                    message: declinedMsg
                });
                if (callback) callback({ success: true, approved: false });
            }
        } catch (e: any) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    // 1.75 Anonymous Partner Profile & Trust Card (Zero-PII: successful chats, report status, equipped EWU avatars)
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

            // AI EWU Student Companion card
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

            const equippedAvatars = (perksRes.data || [])
                .map((row: any) => row.stone_perks)
                .filter(Boolean);

            const avatarFirst =
                equippedAvatars.find((p: any) => String(p.category || '').toLowerCase().includes('avatar')) ||
                equippedAvatars[0] ||
                null;

            const successfulChats = Math.max(
                Number(sessCountRes.count || 0),
                Number(uRes.data?.total_chats || 0)
            );
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

    // 1.8 Create Direct Bench Short URL Invite (Cryptographically Random Code)
    socket.on('create_invite_bench', async (_, callback) => {
        try {
            const code = randomBytes(6).toString('base64url').toLowerCase();
            const roomId = `invite_room_${code}`;

            const inviteData = {
                roomId,
                code,
                creatorId: user.id,
                creatorAlias: user.alias || 'Anonymous Student',
                creatorBadge: user.badge || 'EWU Student',
                createdAt: Date.now()
            };

            await redis.set(`bench_invite:${code}`, JSON.stringify(inviteData), 'EX', 1800);
            socket.join(roomId);

            // Record initial attribution in Supabase
            await supabase.from('referrals').insert({
                inviter_id: user.id,
                short_code: code,
                status: 'created'
            });

            const inviteUrl = `https://benchly.live/b/${code}`;
            if (callback) callback({ success: true, code, inviteUrl, roomId });
            socket.emit('invite_bench_created', { code, inviteUrl, roomId });
        } catch (e: any) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    // 1.9 Join Direct Bench Invite (Friend clicks short URL)
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

            // Remove from Redis to make it single-use
            await redis.del(`bench_invite:${code}`);

            // Join room
            socket.join(invite.roomId);

            // Record referral attribution & reward stones (+5 stones)
            await supabase.rpc('record_referral_join', {
                p_short_code: code,
                p_invitee_id: user.id
            });

            const icebreaker = getRandomIcebreaker();

            // Dispatch to creator (keep dept & semester hidden for privacy & guessing game!)
            io.to(invite.creatorId).emit('match_found', {
                roomId: invite.roomId,
                role: 'creator',
                icebreaker,
                partnerAlias: user.alias || 'Anonymous Student',
                partnerBadge: 'EWU Student',
                isDirectInvite: true
            });

            // Dispatch to joiner
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

            // 15-minute timers
            const warningTimeout = setTimeout(() => {
                io.to(invite.roomId).emit('chat_ending_soon');
            }, CHAT_WARNING_MS);

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

    // 2. Matchmaking Intent
    socket.on('join_1v1_queue', async (data) => {
        const userGender = (user.gender || 'male').toLowerCase();
        const requestedSeeking = (data?.seeking || 'anyone').toString().toLowerCase();
        // Safety rule: only female students can choose 'female' (Girls Only) or 'anyone'.
        // Male students are always matched with 'anyone'.
        const seeking = (userGender === 'female' && (requestedSeeking === 'female' || requestedSeeking === 'girls'))
            ? 'female'
            : 'anyone';
        const matchMode = data?.mode || 'campus_adda';
        
        try {
            await removeUserFromQueues(user.id);
            const match = await findOrCreate1v1Match(user, seeking, matchMode);
            
            if (match.roomId) {
                // We found a match! Generate campus icebreaker
                const icebreaker = getRandomIcebreaker();
                
                // 1. Join creator to room
                socket.join(match.roomId);

                // 2. Lookup joiner socket & profile, and join them to room immediately
                const otherSocketId = userSocketMap.get(match.matchedUser!);
                const otherSocket = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
                if (otherSocket) {
                    otherSocket.join(match.roomId);
                }
                const otherProfile = otherSocketId ? activeUsers.get(otherSocketId) : null;

                // 3. Dispatch to creator (hide dept & semester so guessing game & anonymity stay intact!)
                socket.emit('match_found', { 
                    roomId: match.roomId, 
                    role: 'creator',
                    icebreaker: icebreaker,
                    partnerAlias: otherProfile?.alias || 'Anonymous Student',
                    partnerBadge: 'EWU Student'
                });
                
                // 4. Dispatch to joiner
                const joinerPayload = { 
                    roomId: match.roomId, 
                    role: 'joiner',
                    icebreaker: icebreaker,
                    partnerAlias: user.alias || 'Anonymous Student',
                    partnerBadge: 'EWU Student'
                };
                io.to(match.matchedUser!).emit('match_found', joinerPayload);
                if (otherSocketId) {
                    io.to(otherSocketId).emit('match_found', joinerPayload);
                }
                
                // Clear queue timeouts for both matched users
                const tCreator = queueTimeouts.get(socket.id);
                if (tCreator) { clearTimeout(tCreator); queueTimeouts.delete(socket.id); }
                if (otherSocketId) {
                    const tJoiner = queueTimeouts.get(otherSocketId);
                    if (tJoiner) { clearTimeout(tJoiner); queueTimeouts.delete(otherSocketId); }
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

                // Record telemetry
                analytics.recordEvent('match_created', user.dept_code, user.batch_year, 0, { seeking });
                
                // Set the timeouts
                const warningTimeout = setTimeout(() => {
                    io.to(match.roomId!).emit('chat_ending_soon');
                }, CHAT_WARNING_MS);
                
                const closeTimeout = setTimeout(async () => {
                    io.to(match.roomId!).emit('chat_closed');
                    io.in(match.roomId!).socketsLeave(match.roomId!);
                    
                    await saveRoomSession(match.roomId!);

                    const durationSec = Math.round((Date.now() - (roomMembers.get(match.roomId!)?.startTime || Date.now())) / 1000);
                    analytics.recordEvent('chat_completed', user.dept_code, user.batch_year, durationSec);

                    applyCooldown(user.id);
                    applyCooldown(match.matchedUser!);
                    roomTimeouts.delete(match.roomId!);
                    roomMembers.delete(match.roomId!);
                    handshakeVotes.delete(match.roomId!);
                }, CHAT_DURATION_MS);
                
                roomTimeouts.set(match.roomId, [warningTimeout, closeTimeout]);

            } else {
                // Waiting in queue — if no real classmate joins within AI_FALLBACK_DELAY_MS,
                // pair seamlessly with a Gemma 4 12B EWU Student Companion (Bangla / English / Banglish)
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

                    // Send a natural short opening line from the EWU AI companion
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
        if (t) { clearTimeout(t); queueTimeouts.delete(socket.id); }
        if (user && user.id) {
            await removeUserFromQueues(user.id);
        }
    });

    // 2.5 Phase 4 Live 5-Person "Cafeteria Group Adda" Lounge Join
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

    // 3. Handle incoming 'joiner' joining the created room (Membership-Verified!)
    socket.on('join_room', async (roomId) => {
        if (typeof roomId !== 'string' || !(await isRoomMember(roomId, user.id))) {
            return;
        }
        socket.join(roomId);
        io.to(roomId).emit('room_ready');
    });

    // Handle user exiting the bench early (Membership-Verified!)
    socket.on('leave_room', async (roomId) => {
        if (typeof roomId !== 'string' || !(await isRoomMember(roomId, user.id))) {
            return;
        }
        socket.leave(roomId);

        // Group lounges stay open when one member leaves
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

        const payload = {
            alias: user?.alias || 'Your partner',
            reason: 'left_bench'
        };
        socket.to(roomId).emit('partner_left', payload);

        // Also notify partner directly via userSocketMap so they never get stuck even if join_room raced
        const mem = roomMembers.get(roomId);
        if (mem) {
            const partnerId = mem.user1 === user.id ? mem.user2 : mem.user1;
            const partnerSockId = userSocketMap.get(partnerId);
            if (partnerSockId) {
                io.to(partnerSockId).emit('partner_left', payload);
            }
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

    // 4. Mutual Handshake Feature (Membership-Verified!)
    socket.on('request_handshake', async (roomId) => {
        if (!user || !user.id || typeof roomId !== 'string') return;
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

    // 5. Reporting (Membership-Verified!)
    socket.on('report_user', async (data) => {
        const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
        const messageId = typeof data?.messageId === 'string' ? data.messageId : null;
        const reason = typeof data?.reason === 'string' ? data.reason.trim().slice(0, 500) : '';
        if (!roomId || !reason || !(await isRoomMember(roomId, user.id))) return;
        try {
            await supabase.from('reports').insert({
                room_id: roomId,
                message_id: messageId,
                reason: reason,
                reporter_id: user.id
            });
            analytics.recordEvent('report_filed', user.dept_code, user.batch_year, 0, { reason });
            socket.emit('report_submitted');
        } catch (err) {
            console.error('Failed to report user', err);
        }
    });

    // 6. Messaging & Strict PII Sanitization (Membership-Verified & Length-Capped!)
    socket.on('send_message', async (data) => {
        const rateCount = rateLimitMap.get(socket.id) || 0;
        if (rateCount >= 3) return;
        rateLimitMap.set(socket.id, rateCount + 1);

        const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
        const rawContent = typeof data?.content === 'string' ? data.content.trim() : '';
        if (!roomId || !rawContent || rawContent.length > MAX_MESSAGE_LENGTH) return;
        if (!(await isRoomMember(roomId, user.id))) return;

        const messageId = randomUUID();
        
        let safeContent = rawContent;

        // Check if mutual handshake has been completed in this room
        const isHandshakeAgreed = await redis.get(`room:${roomId}:handshake_agreed`);

        if (!isHandshakeAgreed) {
            // Apply CSE246 KMP + Rabin-Karp + LCS Anti-Evasion PII Shield
            const shieldVerdict = BenchlyPiiShield.sanitizeLiveMessage(safeContent);
            safeContent = shieldVerdict.safeContent;
            if (shieldVerdict.wasModified) {
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
                safeContent = safeContent.replace(/https?:\/\/[^\s]+/gi, '[CENSORED LINK]').replace(/www\.[^\s]+/gi, '[CENSORED LINK]');
                analytics.recordPiiBlocked('link', user.dept_code);
            }
            if (/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi.test(safeContent)) {
                safeContent = safeContent.replace(/\b(?:facebook|fb|instagram|ig|snapchat|whatsapp|wa\.me|telegram|t\.me)\b/gi, '[CENSORED SOCIAL]');
                analytics.recordPiiBlocked('social', user.dept_code);
            }
        }

        // Increment user message count for engagement metrics
        const mem = roomMembers.get(roomId);
        if (mem) {
            if (mem.user1 === user.id) mem.user1Messages++;
            else if (mem.user2 === user.id) mem.user2Messages++;
        }

        // Broadcast to the room (showing ONLY the alias, never the DB ID; include isMine for reliable client alignment)
        const ts = Date.now();
        socket.emit('new_message', {
            id: messageId,
            authorAlias: user.alias,
            content: safeContent,
            timestamp: ts,
            isMine: true
        });
        socket.to(roomId).emit('new_message', {
            id: messageId,
            authorAlias: user.alias,
            content: safeContent,
            timestamp: ts,
            isMine: false
        });

        // In-memory Redis list per room: Pure memory, ZERO database queries during live chat!
        const msgRecord = {
            id: messageId,
            author_id: user.id,
            author_alias: user.alias,
            content: safeContent,
            timestamp: Date.now()
        };
        await redis.rpush(`room_messages:${roomId}`, JSON.stringify(msgRecord));
        await redis.expire(`room_messages:${roomId}`, 7200);

        // Check if cache is fulfilling (e.g. 100 messages reached in this single room)
        const currentMsgCount = await redis.llen(`room_messages:${roomId}`);
        if (currentMsgCount >= 100) {
            console.log(`📦 Cache threshold (100 msgs) reached for room ${roomId}. Archiving whole chat to Supabase.`);
            await saveRoomSession(roomId);
        }

        // If this room is paired with the Gemma 4 12B AI EWU Student Companion, generate a natural reply
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
                    socket.emit('new_message', {
                        id: replyId,
                        authorAlias: aiSession.aiAlias,
                        content: replyText,
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

    // 6.5 Real-Time Screenshot Notification (Membership-Verified!)
    socket.on('screenshot_taken', async (roomId: string) => {
        if (!user || !user.id || typeof roomId !== 'string') return;
        if (!(await isRoomMember(roomId, user.id))) return;
        io.to(roomId).emit('new_message', {
            id: `ss_notify_${Date.now()}`,
            authorAlias: 'System',
            content: `📸 ${user.alias || 'Your partner'} took a screenshot of this chat!`,
            timestamp: Date.now(),
            isSystem: true,
        });
    });

    // 7. Extend Chat (Membership-Verified!)
    socket.on('request_extension', async (roomId) => {
        if (!user || !user.id || typeof roomId !== 'string') return;
        if (!(await isRoomMember(roomId, user.id))) return;
        await redis.sadd(`room_extension:${roomId}`, user.id);
        await redis.expire(`room_extension:${roomId}`, 3600);
        const votes = await redis.scard(`room_extension:${roomId}`);

        if (votes >= 2) {
            io.to(roomId).emit('chat_extended', { minutes: 15 });
            analytics.recordEvent('chat_extended', user.dept_code, user.batch_year);
            
            const existing = roomTimeouts.get(roomId);
            if (existing) {
                existing.forEach(clearTimeout);
            }

            const warningTimeout = setTimeout(() => {
                io.to(roomId).emit('chat_ending_soon');
            }, CHAT_WARNING_MS);
            
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

    socket.on('disconnect', async () => {
        const qT = queueTimeouts.get(socket.id);
        if (qT) { clearTimeout(qT); queueTimeouts.delete(socket.id); }

        await analytics.trackUserDisconnect(socket.id);
        activeUsers.delete(socket.id);
        io.emit('campus_pulse', { onlineUsers: activeUsers.size });
        
        if (user && user.id) {
            await removeUserFromQueues(user.id);
            // Only remove userSocketMap if this socket is still the active one (not already replaced by a fast refresh!)
            if (userSocketMap.get(user.id) === socket.id) {
                userSocketMap.delete(user.id);
            }
            for (const [roomId, members] of roomMembers.entries()) {
                if (members.user1 === user.id || members.user2 === user.id) {
                    // Grace window (15s) so a browser refresh reconnects straight back into the live chat!
                    socket.to(roomId).emit('partner_reconnecting', {
                        alias: user?.alias || 'Your partner',
                    });

                    const existingGrace = disconnectGraceTimers.get(user.id);
                    if (existingGrace) clearTimeout(existingGrace);

                    const timer = setTimeout(async () => {
                        disconnectGraceTimers.delete(user.id);
                        // If user reconnected within grace window, keep the room alive!
                        if (userSocketMap.has(user.id)) return;
                        if (!roomMembers.has(roomId)) return;

                        io.to(roomId).emit('partner_left', {
                            alias: user?.alias || 'Your partner',
                            reason: 'disconnected'
                        });

                        await saveRoomSession(roomId);

                        const existing = roomTimeouts.get(roomId);
                        if (existing) {
                            existing.forEach(clearTimeout);
                        }
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

const PORT = Number(process.env.PORT || 3001);

// Serve compiled Flutter Web App (works both inside Docker volume /frontend/build/web and local dev)
// Dotfiles are strictly denied so .env or hidden files are never served publicly.
const webBuildPath = fs.existsSync('/frontend/build/web')
    ? '/frontend/build/web'
    : path.resolve(__dirname, '../../frontend/build/web');
app.use(express.static(webBuildPath, {
    dotfiles: 'deny',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.json')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Benchly Backend + Web UI running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Admin analytics endpoints protected at /api/analytics/realtime and /api/analytics/summary`);
});

// Optional secondary port 3000 for local OAuth redirect dev only (never enabled blindly in production)
if (!IS_PROD && process.env.ENABLE_OAUTH_PORT_3000 === 'true') {
    const oauthServer = createServer(app);
    io.attach(oauthServer);
    oauthServer.listen(3000, '0.0.0.0', () => {
        console.log(`🔑 Benchly local OAuth dev gateway listening on http://0.0.0.0:3000`);
    });
}
