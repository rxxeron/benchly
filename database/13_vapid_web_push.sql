-- =============================================================================
-- Migration 13: W3C VAPID Web Push Subscriptions (Firebase-Free Background Push)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES public.users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON public.push_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_created_at
    ON public.push_subscriptions (created_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Admins can read push_subscriptions"
    ON public.push_subscriptions
    FOR SELECT
    TO authenticated
    USING (public.is_benchly_admin());
