import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PushPayload {
    title: string;
    body: string;
    tag?: string;
    url?: string;
}

export class WebPushService {
    private static configured = false;
    private static publicKey = '';

    static init() {
        if (this.configured) return;
        const pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
        const priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
        const subject = (process.env.VAPID_SUBJECT || 'mailto:rhrakibulhasan279@gmail.com').trim();
        if (!pub || !priv) return;
        try {
            webpush.setVapidDetails(subject, pub, priv);
            this.publicKey = pub;
            this.configured = true;
        } catch (err: any) {
            console.error('Failed to configure VAPID Web Push:', err?.message || err);
        }
    }

    static getPublicKey(): string {
        this.init();
        return this.publicKey;
    }

    static isConfigured(): boolean {
        this.init();
        return this.configured;
    }

    private static async deliverToRow(
        supabase: SupabaseClient,
        row: { id: string; endpoint: string; p256dh: string; auth: string },
        payload: PushPayload
    ): Promise<'sent' | 'pruned' | 'failed'> {
        if (!this.isConfigured()) return 'failed';
        try {
            await webpush.sendNotification(
                {
                    endpoint: row.endpoint,
                    keys: { p256dh: row.p256dh, auth: row.auth }
                },
                JSON.stringify({
                    title: payload.title,
                    body: payload.body,
                    tag: payload.tag || 'benchly',
                    url: payload.url || 'https://app.benchly.live/'
                }),
                { TTL: 3600 }
            );
            return 'sent';
        } catch (err: any) {
            const status = Number(err?.statusCode || 0);
            if (status === 404 || status === 410) {
                // Auto-prune expired/unsubscribed browser endpoint
                await supabase.from('push_subscriptions').delete().eq('id', row.id);
                return 'pruned';
            }
            return 'failed';
        }
    }

    static async sendToUser(supabase: SupabaseClient, userId: string, payload: PushPayload) {
        if (!userId || !this.isConfigured()) return { sent: 0, pruned: 0, failed: 0 };
        try {
            const { data: rows } = await supabase
                .from('push_subscriptions')
                .select('id, endpoint, p256dh, auth')
                .eq('user_id', userId)
                .limit(10);

            let sent = 0, pruned = 0, failed = 0;
            for (const row of rows || []) {
                const res = await this.deliverToRow(supabase, row, payload);
                if (res === 'sent') sent++;
                else if (res === 'pruned') pruned++;
                else failed++;
            }
            return { sent, pruned, failed };
        } catch {
            return { sent: 0, pruned: 0, failed: 0 };
        }
    }

    static async broadcastAll(supabase: SupabaseClient, payload: PushPayload) {
        if (!this.isConfigured()) return { sent: 0, pruned: 0, failed: 0, total: 0 };
        try {
            const { data: rows } = await supabase
                .from('push_subscriptions')
                .select('id, endpoint, p256dh, auth')
                .order('updated_at', { ascending: false })
                .limit(1000);

            const list = rows || [];
            let sent = 0, pruned = 0, failed = 0;
            await Promise.all(
                list.map(async (row) => {
                    const res = await this.deliverToRow(supabase, row, payload);
                    if (res === 'sent') sent++;
                    else if (res === 'pruned') pruned++;
                    else failed++;
                })
            );
            return { sent, pruned, failed, total: list.length };
        } catch {
            return { sent: 0, pruned: 0, failed: 0, total: 0 };
        }
    }
}
