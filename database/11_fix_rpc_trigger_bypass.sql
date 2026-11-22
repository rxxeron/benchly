-- ====================================================================
-- BENCHLY — FIX SECURITY DEFINER RPC TRIGGER BYPASS (11)
-- Fixes "Could not claim daily stones right now":
-- PostgREST sets current_setting('role') = 'authenticated' even inside
-- SECURITY DEFINER RPCs, causing protect_sensitive_user_columns() to
-- block stones_balance/streak_count updates from trusted RPCs.
-- Solution: trusted RPCs set transaction-local `benchly.internal_rpc = '1'`.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.protect_sensitive_user_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('benchly.internal_rpc', true) = '1'
       OR current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin')
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
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.is_benchly_admin()
       AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    PERFORM set_config('benchly.internal_rpc', '1', true);

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
    v_free_limit INT;
    v_claimed_count INT;
    v_effective_cost INT;
    v_is_free_early_bird BOOLEAN := FALSE;
    v_balance INT;
    v_already_owned BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT public.is_benchly_admin()
       AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    PERFORM set_config('benchly.internal_rpc', '1', true);

    SELECT stone_cost, name, COALESCE(free_claim_limit, 0), COALESCE(claimed_count, 0)
    INTO v_cost, v_name, v_free_limit, v_claimed_count
    FROM public.stone_perks
    WHERE id = p_perk_id AND is_active = TRUE
    FOR UPDATE;

    IF v_cost IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Perk not found');
    END IF;

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

    IF v_free_limit > 0 AND v_claimed_count < v_free_limit THEN
        v_effective_cost := 0;
        v_is_free_early_bird := TRUE;
    ELSE
        v_effective_cost := v_cost;
    END IF;

    IF v_balance < v_effective_cost THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Not enough Campus Stones! Need ' || v_effective_cost || ' 💎.'
        );
    END IF;

    IF v_effective_cost > 0 THEN
        UPDATE public.users
        SET stones_balance = stones_balance - v_effective_cost
        WHERE id = p_user_id
        RETURNING stones_balance INTO v_balance;
    END IF;

    UPDATE public.stone_perks
    SET claimed_count = claimed_count + 1
    WHERE id = p_perk_id
    RETURNING claimed_count INTO v_claimed_count;

    INSERT INTO public.user_perks (user_id, perk_id, is_equipped)
    VALUES (p_user_id, p_perk_id, TRUE);

    INSERT INTO public.stone_transactions (user_id, amount, tx_type, description)
    VALUES (
        p_user_id,
        -v_effective_cost,
        CASE WHEN v_is_free_early_bird THEN 'free_early_bird_avatar' ELSE 'unlock_perk' END,
        CASE
            WHEN v_is_free_early_bird THEN 'Claimed Early-Bird Free Avatar (' || v_claimed_count || '/' || v_free_limit || '): ' || v_name
            ELSE 'Unlocked ' || v_name
        END
    );

    RETURN jsonb_build_object(
        'success', true,
        'unlocked', p_perk_id,
        'free_early_bird', v_is_free_early_bird,
        'free_spots_left', GREATEST(0, v_free_limit - v_claimed_count),
        'claimed_count', v_claimed_count,
        'stones_balance', v_balance
    );
END;
$$;
