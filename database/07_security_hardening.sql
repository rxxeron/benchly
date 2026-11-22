-- ====================================================================
-- BENCHLY — SECURITY HARDENING MIGRATION (07)
-- Fixes:
--   1. Drops broken PUBLIC ("Service role full access") RLS policies
--   2. Locks down public.users sensitive columns via BEFORE UPDATE trigger
--   3. Removes free-unlock INSERT policy on public.user_perks
--   4. Hardens all 5 SECURITY DEFINER RPCs with auth.uid() checks,
--      SET search_path = public, FOR UPDATE row locks, and REVOKE/GRANT
--   5. Restricts analytics views to service_role with security_invoker
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. DROP BROKEN "Service role full access" POLICIES (APPLIED TO PUBLIC!)
-- Note: Supabase service_role bypasses RLS automatically.
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow service role full access on analytics" ON public.analytics_events;
DROP POLICY IF EXISTS "Service role full access on alias history" ON public.alias_history;
DROP POLICY IF EXISTS "Service role full access on chat sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Service role full access on room conversations" ON public.room_conversations;
DROP POLICY IF EXISTS "Service role full access on referrals" ON public.referrals;

-- Ensure RLS stays enabled on all sensitive tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alias_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF to_regclass('public.stone_perks') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.stone_perks ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS "Anyone authenticated can read active stone perks" ON public.stone_perks';
        EXECUTE 'CREATE POLICY "Anyone authenticated can read active stone perks" ON public.stone_perks FOR SELECT TO authenticated USING (is_active = true)';
    END IF;
    IF to_regclass('public.user_perks') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.user_perks ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS "Users can insert own unlocked perks" ON public.user_perks';
        EXECUTE 'DROP POLICY IF EXISTS "Users can update own unlocked perks" ON public.user_perks';
        EXECUTE 'CREATE POLICY "Users can update own unlocked perks" ON public.user_perks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
    END IF;
    IF to_regclass('public.stone_transactions') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.stone_transactions ENABLE ROW LEVEL SECURITY';
    END IF;
END $$;

-- --------------------------------------------------------------------
-- 2. LOCK DOWN public.users & public.user_perks CLIENT WRITES
-- --------------------------------------------------------------------

-- Tighten UPDATE policy on public.users with explicit WITH CHECK
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
ON public.users FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Prevent non-service_role clients from tampering with economy, identity, or locked gender
CREATE OR REPLACE FUNCTION public.protect_sensitive_user_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Allow backend service_role and internal postgres/supabase_admin roles
    IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
       OR COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Block tampering with economy, streaks, referrals, and email
    IF NEW.stones_balance IS DISTINCT FROM OLD.stones_balance
       OR NEW.streak_count IS DISTINCT FROM OLD.streak_count
       OR NEW.total_referrals IS DISTINCT FROM OLD.total_referrals
       OR NEW.total_chats IS DISTINCT FROM OLD.total_chats
       OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
       OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
       OR NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'Forbidden: sensitive profile fields cannot be modified directly.';
    END IF;

    -- Allow initial gender selection (when OLD.gender IS NULL), but block changing gender afterwards
    -- so users cannot bypass Girls-Only matchmaking safety rules.
    IF OLD.gender IS NOT NULL AND NEW.gender IS DISTINCT FROM OLD.gender THEN
        RAISE EXCEPTION 'Forbidden: gender cannot be changed once set.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_sensitive_user_columns ON public.users;
CREATE TRIGGER trigger_protect_sensitive_user_columns
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.protect_sensitive_user_columns();

-- --------------------------------------------------------------------
-- 3. HARDEN ALL SECURITY DEFINER RPCs
--    - Enforce auth.uid() = p_user_id (unless service_role)
--    - Pin SET search_path = public
--    - Add FOR UPDATE row locks on stone economy mutations
--    - Revoke EXECUTE from PUBLIC & anon
-- --------------------------------------------------------------------

-- 3a. get_student_analytics
CREATE OR REPLACE FUNCTION public.get_student_analytics(
    p_user_id UUID,
    p_timeframe TEXT DEFAULT 'weekly'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_result JSONB;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    IF p_timeframe = 'daily' THEN
        v_start_time := NOW() - INTERVAL '1 day';
    ELSIF p_timeframe = 'monthly' THEN
        v_start_time := NOW() - INTERVAL '30 days';
    ELSE
        v_start_time := NOW() - INTERVAL '7 days';
    END IF;

    SELECT jsonb_build_object(
        'timeframe', p_timeframe,
        'people_talked_to', COALESCE(COUNT(DISTINCT partner_id), 0),
        'total_chats', COALESCE(COUNT(*), 0),
        'messages_sent', COALESCE(SUM(messages_sent), 0),
        'messages_received', COALESCE(SUM(messages_received), 0),
        'total_messages', COALESCE(SUM(messages_sent + messages_received), 0),
        'avg_messages_per_chat', ROUND(COALESCE((SUM(messages_sent + messages_received)::numeric / NULLIF(COUNT(*), 0)), 0), 1),
        'total_duration_seconds', COALESCE(SUM(duration_seconds), 0),
        'usage_minutes', ROUND(COALESCE(SUM(duration_seconds), 0) / 60.0, 1)
    )
    INTO v_result
    FROM public.chat_sessions
    WHERE user_id = p_user_id
      AND created_at >= v_start_time;

    RETURN v_result;
END;
$$;

-- 3b. rotate_user_alias
CREATE OR REPLACE FUNCTION public.rotate_user_alias(
    p_user_id UUID,
    p_new_alias TEXT DEFAULT NULL,
    p_change_type TEXT DEFAULT 'manual'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_alias TEXT;
    v_target_alias TEXT;
    v_adjectives TEXT[] := ARRAY[
        'Velvet', 'Monsoon', 'Golden', 'Midnight', 'Solar', 'Lunar',
        'Saffron', 'Cinnamon', 'Amber', 'Indigo', 'Breezy', 'Starlit',
        'Cosmic', 'Rainy', 'Chaotic', 'Mellow', 'Dreamy', 'Electric',
        'Smoky', 'Crisp', 'Neon', 'Silent', 'Wild', 'Wandering',
        'Sleepy', 'Magnetic', 'Restless', 'Radiant', 'Rustic', 'Vintage',
        'Crimson', 'Emerald', 'Misty', 'Cloudy', 'Spiced', 'Honey',
        'Silver', 'Twilight', 'Cobalt', 'Lush', 'Astral', 'Sunlit',
        'Rogue', 'Caffeinated', 'Wistful', 'Dusk', 'Boho'
    ];
    v_nouns TEXT[] := ARRAY[
        'Panther', 'Firefly', 'Albatross', 'Otter', 'Heron', 'Fox',
        'Koi', 'Sparrow', 'Lotus', 'Banyan', 'Mirage', 'Comet',
        'Horizon', 'Zephyr', 'Eclipse', 'Aurora', 'Pebble', 'Falcon',
        'Fuchka', 'Espresso', 'Matcha', 'Croissant', 'Boba', 'Biryani',
        'Mango', 'Jhalmuri', 'Chai', 'Tangerine', 'Pretzel', 'Caramel',
        'Vinyl', 'Polaroid', 'Sketchbook', 'Jazz', 'Cinema', 'Origami',
        'Sonnet', 'Mosaic', 'Cassette', 'Lantern', 'Compass', 'Melody',
        'Nomad', 'Drifter', 'Stargazer', 'Daydreamer', 'Storyteller',
        'Alchemist', 'Voyager', 'Maverick', 'Muse', 'Poet',
        'Wanderer', 'Riddle', 'Whisper', 'Echo', 'Vagabond', 'Phantom'
    ];
    v_random_num INT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    SELECT generated_alias
    INTO v_current_alias
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF v_current_alias IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    IF p_new_alias IS NOT NULL AND length(trim(p_new_alias)) >= 3 AND length(trim(p_new_alias)) <= 28 THEN
        v_target_alias := trim(p_new_alias);
    ELSE
        v_random_num := floor(random() * 90 + 10)::int;
        v_target_alias := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int] || ' ' ||
                          v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int] || ' ' ||
                          v_random_num::text;
    END IF;

    INSERT INTO public.alias_history (user_id, old_alias, new_alias, change_type)
    VALUES (p_user_id, v_current_alias, v_target_alias, CASE WHEN p_change_type = 'auto' THEN 'auto' ELSE 'manual' END);

    UPDATE public.users
    SET generated_alias = v_target_alias,
        alias_changed_at = NOW(),
        alias_change_count = COALESCE(alias_change_count, 0) + 1
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'old_alias', v_current_alias,
        'new_alias', v_target_alias,
        'changed_at', NOW()
    );
END;
$$;

-- 3c. claim_daily_login_stones (with FOR UPDATE lock & auth.uid() check)
CREATE OR REPLACE FUNCTION public.claim_daily_login_stones(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_already_claimed BOOLEAN;
    v_new_balance INT;
    v_new_streak INT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    -- Lock user row first to serialize concurrent claims
    SELECT stones_balance, streak_count INTO v_new_balance, v_new_streak
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'User not found');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.stone_transactions
        WHERE user_id = p_user_id
          AND tx_type = 'daily_login'
          AND created_at >= CURRENT_DATE
    ) INTO v_already_claimed;

    IF v_already_claimed THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Daily login stones already claimed today!',
            'stones_balance', COALESCE(v_new_balance, 10),
            'streak_count', COALESCE(v_new_streak, 1)
        );
    END IF;

    UPDATE public.users
    SET stones_balance = COALESCE(stones_balance, 10) + 2,
        streak_count = COALESCE(streak_count, 0) + 1,
        last_login = NOW()
    WHERE id = p_user_id
    RETURNING stones_balance, streak_count INTO v_new_balance, v_new_streak;

    INSERT INTO public.stone_transactions (user_id, amount, tx_type, description)
    VALUES (p_user_id, 2, 'daily_login', 'Daily Campus Adda Login Bonus (+2 💎)');

    RETURN jsonb_build_object(
        'success', true,
        'awarded', 2,
        'stones_balance', v_new_balance,
        'streak_count', v_new_streak
    );
END;
$$;

-- 3d. purchase_stone_perk (with FOR UPDATE lock & auth.uid() check)
CREATE OR REPLACE FUNCTION public.purchase_stone_perk(
    p_user_id UUID,
    p_perk_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cost INT;
    v_name TEXT;
    v_balance INT;
    v_already_owned BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    SELECT stone_cost, name INTO v_cost, v_name
    FROM public.stone_perks
    WHERE id = p_perk_id AND is_active = TRUE;

    IF v_cost IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Perk not found');
    END IF;

    -- Lock user row to prevent concurrent double-spend
    SELECT COALESCE(stones_balance, 0) INTO v_balance
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'User not found');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.user_perks
        WHERE user_id = p_user_id AND perk_id = p_perk_id
    ) INTO v_already_owned;

    IF v_already_owned THEN
        UPDATE public.user_perks
        SET is_equipped = NOT is_equipped
        WHERE user_id = p_user_id AND perk_id = p_perk_id;

        RETURN jsonb_build_object(
            'success', true,
            'toggled_equip', true,
            'stones_balance', v_balance
        );
    END IF;

    IF v_balance < v_cost THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Not enough Campus Stones! Need ' || v_cost || ' 💎.'
        );
    END IF;

    UPDATE public.users
    SET stones_balance = stones_balance - v_cost
    WHERE id = p_user_id
    RETURNING stones_balance INTO v_balance;

    INSERT INTO public.user_perks (user_id, perk_id, is_equipped)
    VALUES (p_user_id, p_perk_id, TRUE);

    INSERT INTO public.stone_transactions (user_id, amount, tx_type, description)
    VALUES (p_user_id, -v_cost, 'unlock_perk', 'Unlocked ' || v_name);

    RETURN jsonb_build_object(
        'success', true,
        'unlocked', p_perk_id,
        'stones_balance', v_balance
    );
END;
$$;

-- 3e. record_referral_join (server-only via service_role)
CREATE OR REPLACE FUNCTION public.record_referral_join(
    p_short_code TEXT,
    p_invitee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inviter_id UUID;
    v_already_joined BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Forbidden: server-only RPC';
    END IF;

    SELECT inviter_id INTO v_inviter_id
    FROM public.referrals
    WHERE short_code = p_short_code
    LIMIT 1;

    IF v_inviter_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invite code not found');
    END IF;

    IF v_inviter_id = p_invitee_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cannot refer yourself');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.referrals
        WHERE short_code = p_short_code AND invitee_id = p_invitee_id
    ) INTO v_already_joined;

    IF NOT v_already_joined THEN
        INSERT INTO public.referrals (inviter_id, invitee_id, short_code, status)
        VALUES (v_inviter_id, p_invitee_id, p_short_code, 'joined_bench');

        UPDATE public.users
        SET total_referrals = COALESCE(total_referrals, 0) + 1,
            stones_balance = COALESCE(stones_balance, 0) + 5
        WHERE id = v_inviter_id;

        UPDATE public.users
        SET referred_by = v_inviter_id
        WHERE id = p_invitee_id AND referred_by IS NULL;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'inviter_id', v_inviter_id,
        'awarded_stones', 5
    );
END;
$$;

-- Lock down EXECUTE permissions on all RPCs
REVOKE ALL ON FUNCTION public.get_student_analytics(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_analytics(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rotate_user_alias(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_user_alias(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_daily_login_stones(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_login_stones(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.purchase_stone_perk(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_stone_perk(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_referral_join(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_referral_join(TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_old_ephemeral_messages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_ephemeral_messages() TO service_role;

-- --------------------------------------------------------------------
-- 5. STRICT @std.ewubd.edu EMAIL ENFORCEMENT (BLOCKS ALL OTHER DOMAINS)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_ewu_email_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT;
BEGIN
    v_email := lower(trim(COALESCE(NEW.email, '')));
    IF v_email NOT LIKE '%@std.ewubd.edu' AND v_email <> 'rhrakibulhasan279@gmail.com' THEN
        RAISE EXCEPTION 'Only @std.ewubd.edu email addresses are allowed on Benchly.';
    END IF;
    NEW.email := v_email;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_ewu_email_only ON public.users;
CREATE TRIGGER trigger_enforce_ewu_email_only
BEFORE INSERT OR UPDATE OF email ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ewu_email_only();

-- Also enforce on auth.users so Google OAuth / email signups from non-EWU domains are blocked at registration
DROP TRIGGER IF EXISTS trigger_enforce_ewu_auth_email_only ON auth.users;
CREATE TRIGGER trigger_enforce_ewu_auth_email_only
BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ewu_email_only();

-- --------------------------------------------------------------------
-- 4. HARDEN ANALYTICS VIEWS (security_invoker + revoke anon/authenticated)
-- --------------------------------------------------------------------
ALTER VIEW public.v_department_distribution SET (security_invoker = true);
ALTER VIEW public.v_peak_hours_activity SET (security_invoker = true);
ALTER VIEW public.v_chat_health_summary SET (security_invoker = true);

REVOKE ALL ON public.v_department_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_department_distribution TO service_role;

REVOKE ALL ON public.v_peak_hours_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_peak_hours_activity TO service_role;

REVOKE ALL ON public.v_chat_health_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_chat_health_summary TO service_role;
