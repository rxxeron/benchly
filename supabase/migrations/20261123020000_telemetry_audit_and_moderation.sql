-- =============================================================================
-- Migration 12: First-Party Website Telemetry, Admin Audit Logs & Temp-Mute
-- =============================================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS public.site_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_hash TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT 'benchly.live',
    event_type TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '/',
    referrer TEXT NULL,
    utm_source TEXT NULL,
    invite_code TEXT NULL,
    device_type TEXT NOT NULL DEFAULT 'desktop',
    country TEXT NULL,
    platform TEXT NOT NULL DEFAULT 'web',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_events_created_at
    ON public.site_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_events_event_type_created_at
    ON public.site_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_events_visitor_hash_created_at
    ON public.site_events (visitor_hash, created_at DESC);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read site_events" ON public.site_events;
CREATE POLICY "Admins can read site_events"
    ON public.site_events
    FOR SELECT
    TO authenticated
    USING (public.is_benchly_admin());

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
    ON public.admin_audit_logs (created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read admin_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can read admin_audit_logs"
    ON public.admin_audit_logs
    FOR SELECT
    TO authenticated
    USING (public.is_benchly_admin());
