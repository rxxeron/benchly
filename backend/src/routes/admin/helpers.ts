import express from 'express';
import { timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import type { Server } from 'socket.io';
import type { AnalyticsEngine } from '../../analytics';

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

export function createAdminHelpers(deps: AdminRoutesDeps) {
    const { supabase, ADMIN_EMAIL } = deps;

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

    return { requireAdmin, logAdminAction, computeChatQualityStats };
}

export type AdminHelpers = ReturnType<typeof createAdminHelpers>;
