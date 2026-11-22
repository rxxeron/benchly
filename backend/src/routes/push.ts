import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAllowedEwuEmail } from '../supabase';
import { WebPushService } from '../push_service';

export function registerPushRoutes(app: express.Express, deps: { supabase: SupabaseClient }) {
    const { supabase } = deps;

    async function getOptionalUserId(req: express.Request): Promise<string | null> {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (!token) return null;
        try {
            const {
                data: { user },
                error
            } = await supabase.auth.getUser(token);
            if (error || !user || !isAllowedEwuEmail(user.email)) return null;
            return user.id;
        } catch {
            return null;
        }
    }

    app.get('/api/push/vapid-public-key', (_req, res) => {
        const publicKey = WebPushService.getPublicKey();
        if (!publicKey) {
            return res.status(503).json({ error: 'VAPID public key is not configured on this server.' });
        }
        return res.json({ publicKey });
    });

    app.post('/api/push/subscribe', async (req, res) => {
        try {
            const sub = req.body?.subscription || req.body;
            const endpoint = (sub?.endpoint || '').toString().trim();
            const p256dh = (sub?.keys?.p256dh || '').toString().trim();
            const auth = (sub?.keys?.auth || '').toString().trim();

            if (!endpoint.startsWith('https://') || !p256dh || !auth) {
                return res.status(400).json({ error: 'Invalid Web Push subscription object.' });
            }

            const userId = await getOptionalUserId(req);
            const ua = String(req.headers['user-agent'] || '').slice(0, 250);

            const { error } = await supabase.from('push_subscriptions').upsert(
                {
                    endpoint,
                    p256dh,
                    auth,
                    user_id: userId,
                    user_agent: ua,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'endpoint' }
            );
            if (error) throw error;

            return res.json({ ok: true, linkedUser: Boolean(userId) });
        } catch (err: any) {
            console.error('Web Push subscribe error:', err?.message || err);
            return res.status(500).json({ error: 'Failed to store push subscription.' });
        }
    });

    app.post('/api/push/unsubscribe', async (req, res) => {
        try {
            const endpoint = (req.body?.endpoint || '').toString().trim();
            if (endpoint) {
                await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
            }
            return res.json({ ok: true });
        } catch {
            return res.status(500).json({ error: 'Failed to remove push subscription.' });
        }
    });
}
