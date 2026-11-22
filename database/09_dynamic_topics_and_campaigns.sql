-- ====================================================================
-- BENCHLY — DYNAMIC BENCH TOPICS & CUSTOM REWARD CAMPAIGNS (09)
-- Allows Admin (rhrakibulhasan279@gmail.com) to dynamically update
-- Today's Bench Topic and create/toggle custom Stone reward campaigns
-- (e.g., "Chat for 7 days and earn +15 Stones") with zero hardcoding.
-- ====================================================================

-- 1. DYNAMIC APP SETTINGS TABLE (Key-Value)
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;
CREATE POLICY "Authenticated can read app_settings"
ON public.app_settings FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Benchly admin full access on app_settings" ON public.app_settings;
CREATE POLICY "Benchly admin full access on app_settings"
ON public.app_settings FOR ALL
TO authenticated
USING (public.is_benchly_admin())
WITH CHECK (public.is_benchly_admin());

INSERT INTO public.app_settings (key, value, updated_by)
VALUES (
    'todays_bench_topic',
    'Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?',
    'system'
)
ON CONFLICT (key) DO NOTHING;

-- 2. DYNAMIC REWARD CAMPAIGNS TABLE
CREATE TABLE IF NOT EXISTS public.reward_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN ('streak_days', 'total_chats', 'referrals')),
    target_value INT NOT NULL CHECK (target_value > 0),
    reward_stones INT NOT NULL CHECK (reward_stones > 0),
    icon_emoji TEXT NOT NULL DEFAULT '⭐',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reward_campaigns_active ON public.reward_campaigns(is_active, created_at DESC);

ALTER TABLE public.reward_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read active reward_campaigns" ON public.reward_campaigns;
CREATE POLICY "Authenticated can read active reward_campaigns"
ON public.reward_campaigns FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "Benchly admin full access on reward_campaigns" ON public.reward_campaigns;
CREATE POLICY "Benchly admin full access on reward_campaigns"
ON public.reward_campaigns FOR ALL
TO authenticated
USING (public.is_benchly_admin())
WITH CHECK (public.is_benchly_admin());

-- Seed one default dynamic campaign if table is empty
INSERT INTO public.reward_campaigns (title, description, metric_type, target_value, reward_stones, icon_emoji, is_active)
SELECT
    '7-Day Adda Streak Challenge',
    'Chat on Benchly for 7 days in a row and claim bonus Campus Stones!',
    'streak_days',
    7,
    15,
    '⭐',
    TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.reward_campaigns);

-- 3. USER CAMPAIGN CLAIMS (prevents duplicate claims)
CREATE TABLE IF NOT EXISTS public.user_campaign_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.reward_campaigns(id) ON DELETE CASCADE,
    reward_stones INT NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_user_campaign_claims_user ON public.user_campaign_claims(user_id);

ALTER TABLE public.user_campaign_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own campaign claims" ON public.user_campaign_claims;
CREATE POLICY "Users can view own campaign claims"
ON public.user_campaign_claims FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Benchly admin full access on user_campaign_claims" ON public.user_campaign_claims;
CREATE POLICY "Benchly admin full access on user_campaign_claims"
ON public.user_campaign_claims FOR ALL
TO authenticated
USING (public.is_benchly_admin())
WITH CHECK (public.is_benchly_admin());
