import express from 'express';
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';

const ALLOWED_TELEMETRY_EVENTS = new Set([
    'landing_view',
    'cta_open_app',
    'app_open',
    'auth_signup_started',
    'auth_signup_completed',
    'queue_joined',
    'match_started',
    'chat_first_message',
    'invite_link_clicked'
]);

function buildVisitorHash(req: express.Request): string {
    const today = new Date().toISOString().split('T')[0];
    const ip =
        (req.headers['cf-connecting-ip'] as string) ||
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip ||
        'anon';
    const ua = (req.headers['user-agent'] || '').toString();
    return createHash('sha256').update(`${today}:${ip}:${ua}`).digest('hex').slice(0, 16);
}

function detectDeviceType(ua: string): 'mobile' | 'desktop' {
    return /mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop';
}

export function registerTelemetryRoutes(
    app: express.Express,
    deps: { supabase: SupabaseClient; redis: Redis }
) {
    const { supabase, redis } = deps;

    function recordSiteEvent(
        req: express.Request,
        payload: {
            domain?: string;
            event_type: string;
            path?: string;
            referrer?: string | null;
            utm_source?: string | null;
            invite_code?: string | null;
            platform?: string;
            metadata?: Record<string, any>;
        }
    ) {
        const today = new Date().toISOString().split('T')[0];
        const ua = (req.headers['user-agent'] || '').toString();
        const visitorHash = buildVisitorHash(req);
        const country = String(req.headers['cf-ipcountry'] || 'BD').slice(0, 8);
        const deviceType = detectDeviceType(ua);

        redis.incr(`benchly:visits:${today}`).catch(() => {});

        supabase
            .from('site_events')
            .insert({
                visitor_hash: visitorHash,
                domain: String(payload.domain || 'benchly.live').slice(0, 100),
                event_type: payload.event_type,
                path: String(payload.path || '/').slice(0, 200),
                referrer: payload.referrer ? String(payload.referrer).slice(0, 300) : null,
                utm_source: payload.utm_source ? String(payload.utm_source).slice(0, 80) : null,
                invite_code: payload.invite_code ? String(payload.invite_code).slice(0, 40) : null,
                device_type: deviceType,
                country,
                platform: String(payload.platform || 'web').slice(0, 20),
                metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
            })
            .then(({ error }) => {
                if (error) console.error('site_events insert error:', error.message);
            });
    }

    // Public Privacy-First Visitor & Funnel Beacon (Zero PII, daily rotating salt)
    app.post('/api/telemetry/visit', (req, res) => {
        const eventType = String(req.body?.event_type || '').trim();
        if (!ALLOWED_TELEMETRY_EVENTS.has(eventType)) {
            return res.status(400).json({ error: 'Invalid telemetry event_type' });
        }
        recordSiteEvent(req, {
            domain: req.body?.domain,
            event_type: eventType,
            path: req.body?.path,
            referrer: req.body?.referrer,
            utm_source: req.body?.utm_source,
            invite_code: req.body?.invite_code,
            platform: req.body?.platform,
            metadata: req.body?.metadata
        });
        return res.json({ ok: true });
    });

    // Short URL Bench Invite Redirect (e.g. benchly.live/b/a9x7k2)
    app.get('/b/:code', (req, res) => {
        const code = req.params.code;
        recordSiteEvent(req, {
            domain: 'benchly.live',
            event_type: 'invite_link_clicked',
            path: `/b/${code}`,
            referrer: (req.headers.referer as string) || null,
            invite_code: code,
            platform: 'web'
        });
        res.redirect(`https://benchly.live/?invite=${encodeURIComponent(code)}`);
    });
}
