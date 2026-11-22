-- ====================================================================
-- BENCHLY — ADMIN ROLE & FULL DATABASE ACCESS MIGRATION (08)
-- Designates rhrakibulhasan279@gmail.com as Super Admin with full
-- read/write/moderation access across all Benchly tables while keeping
-- student RLS restrictions strictly enforced.
-- ====================================================================

-- 1. Add is_admin & is_banned columns to public.users
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;

-- Promote rhrakibulhasan279@gmail.com to Admin (if already signed up)
UPDATE public.users
SET is_admin = TRUE
WHERE lower(email) = 'rhrakibulhasan279@gmail.com';

-- Automatically grant is_admin = TRUE if rhrakibulhasan279@gmail.com signs up later
CREATE OR REPLACE FUNCTION public.auto_assign_benchly_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF lower(trim(COALESCE(NEW.email, ''))) = 'rhrakibulhasan279@gmail.com' THEN
        NEW.is_admin := TRUE;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_assign_benchly_admin ON public.users;
CREATE TRIGGER trigger_auto_assign_benchly_admin
BEFORE INSERT OR UPDATE OF email ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_benchly_admin();

-- 2. Central Admin Check Helper (used by all RLS policies & triggers)
CREATE OR REPLACE FUNCTION public.is_benchly_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_jwt_email TEXT;
    v_flag BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN TRUE;
    END IF;

    v_jwt_email := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
    IF v_jwt_email = 'rhrakibulhasan279@gmail.com' THEN
        RETURN TRUE;
    END IF;

    IF auth.uid() IS NOT NULL THEN
        SELECT is_admin INTO v_flag FROM public.users WHERE id = auth.uid();
        IF COALESCE(v_flag, FALSE) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_benchly_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_benchly_admin() TO authenticated, service_role;

-- 3. Update protect_sensitive_user_columns() trigger so Admin can edit any user field (including bans & stones)
CREATE OR REPLACE FUNCTION public.protect_sensitive_user_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
       OR COALESCE(auth.role(), '') = 'service_role'
       OR public.is_benchly_admin() THEN
        RETURN NEW;
    END IF;

    IF NEW.stones_balance IS DISTINCT FROM OLD.stones_balance
       OR NEW.streak_count IS DISTINCT FROM OLD.streak_count
       OR NEW.total_referrals IS DISTINCT FROM OLD.total_referrals
       OR NEW.total_chats IS DISTINCT FROM OLD.total_chats
       OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
       OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.is_banned IS DISTINCT FROM OLD.is_banned THEN
        RAISE EXCEPTION 'Forbidden: sensitive profile fields cannot be modified directly.';
    END IF;

    IF OLD.gender IS NOT NULL AND NEW.gender IS DISTINCT FROM OLD.gender THEN
        RAISE EXCEPTION 'Forbidden: gender cannot be changed once set.';
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Grant Full Admin RLS Policies Across Every Benchly Table
DO $$
DECLARE
    tbl TEXT;
    all_tables TEXT[] := ARRAY[
        'users',
        'messages',
        'reports',
        'analytics_events',
        'daily_metrics',
        'alias_history',
        'chat_sessions',
        'room_conversations',
        'referrals',
        'stone_perks',
        'user_perks',
        'stone_transactions',
        'ewu_departments',
        'ewu_semesters'
    ];
BEGIN
    FOREACH tbl IN ARRAY all_tables LOOP
        IF to_regclass('public.' || tbl) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS "Benchly admin full access" ON public.%I', tbl);
            EXECUTE format(
                'CREATE POLICY "Benchly admin full access" ON public.%I FOR ALL TO authenticated USING (public.is_benchly_admin()) WITH CHECK (public.is_benchly_admin())',
                tbl
            );
        END IF;
    END LOOP;
END $$;
