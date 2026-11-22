import express from 'express';
import type { AdminHelpers, AdminRoutesDeps } from './helpers';

export function registerAdminContentRoutes(
    app: express.Express,
    deps: AdminRoutesDeps,
    helpers: AdminHelpers
) {
    const { supabase, io, DEFAULT_BENCH_TOPIC } = deps;
    const { requireAdmin, logAdminAction } = helpers;

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
