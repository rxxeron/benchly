import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { timingSafeEqual } from 'crypto';
import dotenv from 'dotenv';
import { supabase } from './supabase';
import { redis } from './matchmaker';
import { AnalyticsEngine } from './analytics';
import { registerTelemetryRoutes } from './routes/telemetry';
import { registerPublicRoutes } from './routes/public';
import { registerAdminRoutes } from './routes/admin';
import { registerPushRoutes } from './routes/push';
import { createSocketState } from './sockets/state';
import { registerSocketGateway } from './sockets/gateway';

dotenv.config();

const ADMIN_EMAIL = 'rhrakibulhasan279@gmail.com';
const DEFAULT_BENCH_TOPIC =
    'Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?';
const IS_PROD = process.env.NODE_ENV === 'production';

const DEFAULT_ALLOWED_ORIGINS = [
    'https://benchly.live',
    'https://www.benchly.live',
    'https://app.benchly.live',
    'https://api.benchly.live',
    'https://admin.benchly.live',
    ...(IS_PROD
        ? []
        : [
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
    if (!origin) return true;
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

app.use((_req, res, next) => {
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

app.use(
    cors({
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
    })
);
app.use(express.json({ limit: '32kb' }));

function createHttpRateLimiter(windowMs: number, maxRequests: number): express.RequestHandler {
    const hits = new Map<string, { count: number; resetAt: number }>();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits.entries()) {
            if (now >= v.resetAt) hits.delete(k);
        }
    }, Math.min(windowMs, 60_000)).unref();

    return (req, res, next) => {
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
    maxHttpBufferSize: 16 * 1024
});

const analytics = new AnalyticsEngine(redis);
const socketState = createSocketState({ supabase, redis });

registerTelemetryRoutes(app, { supabase, redis });
registerPushRoutes(app, { supabase });
registerPublicRoutes(app, {
    supabase,
    redis,
    analytics,
    activeUsers: socketState.activeUsers,
    userSocketMap: socketState.userSocketMap,
    requireAdminKey,
    authRegisterRateLimiter,
    DEFAULT_BENCH_TOPIC
});
registerAdminRoutes(app, {
    supabase,
    redis,
    io,
    analytics,
    activeUsers: socketState.activeUsers,
    userSocketMap: socketState.userSocketMap,
    ADMIN_EMAIL,
    DEFAULT_BENCH_TOPIC
});
registerSocketGateway(io, socketState, { analytics, supabase, redis });

const webBuildPath = fs.existsSync('/frontend/build/web')
    ? '/frontend/build/web'
    : path.resolve(__dirname, '../../frontend/build/web');
app.use(
    express.static(webBuildPath, {
        dotfiles: 'deny',
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.json')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    })
);

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Benchly Backend + Web UI running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Admin analytics endpoints protected at /api/analytics/realtime and /api/analytics/summary`);
});

if (!IS_PROD && process.env.ENABLE_OAUTH_PORT_3000 === 'true') {
    const oauthServer = createServer(app);
    io.attach(oauthServer);
    oauthServer.listen(3000, '0.0.0.0', () => {
        console.log(`🔑 Benchly local OAuth dev gateway listening on http://0.0.0.0:3000`);
    });
}
