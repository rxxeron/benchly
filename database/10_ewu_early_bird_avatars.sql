-- ====================================================================
-- BENCHLY — EWU COLLECTIBLE AVATARS (FREE FOR FIRST 20 USERS, THEN COINS)
-- Migration 10:
--   1. Adds free_claim_limit & claimed_count to public.stone_perks
--   2. Seeds 6 EWU campus collectible avatars (free_claim_limit = 20)
--   3. Updates purchase_stone_perk() with FOR UPDATE lock on stone_perks
--      so the first 20 claims are FREE (0 Stones) and claim #21+ costs Stones.
-- ====================================================================

-- 1. Extend public.stone_perks with early-bird free quota tracking
ALTER TABLE public.stone_perks
ADD COLUMN IF NOT EXISTS free_claim_limit INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS claimed_count INT NOT NULL DEFAULT 0;

-- Backfill claimed_count from existing user_perks
UPDATE public.stone_perks sp
SET claimed_count = COALESCE((
    SELECT COUNT(*)::int FROM public.user_perks up WHERE up.perk_id = sp.id
), 0);

-- 2. Seed 6 EWU-themed Collectible Avatars (Free for first 20 students, then costs Stones)
INSERT INTO public.stone_perks (
    id, name, category, stone_cost, engagement_boost, icon_emoji, description, free_claim_limit
)
VALUES
    ('avatar_ewu_courtyard_cat', 'EWU Courtyard Cat', 'EWU Avatar', 4, 38, '🐱', 'The legendary Aftabnagar courtyard cat perched beside your alias.', 20),
    ('avatar_aftabnagar_cha', 'Aftabnagar Cha Master', 'EWU Avatar', 5, 46, '☕', 'Main gate tong-er cha badge for true evening adda regulars.', 20),
    ('avatar_library_owl', 'Floor-4 Library Owl', 'EWU Avatar', 6, 55, '🦉', 'Silent midnight midterm survivor from EWU Library Floor 4.', 20),
    ('avatar_fuchka_bandit', 'Main Gate Fuchka Bandit', 'EWU Avatar', 5, 44, '🥟', 'Extra tok, extra spice — Aftabnagar gate street food champion.', 20),
    ('avatar_cse_debugger', 'CSE Lab Midnight Debugger', 'EWU Avatar', 7, 68, '💻', 'Survived CSE246 Algorithms labs with zero segmentation faults.', 20),
    ('avatar_banyan_dreamer', 'EWU Banyan Tree Dreamer', 'EWU Avatar', 6, 54, '🌿', 'Breezy campus courtyard vibes for chill between-class addas.', 20)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    stone_cost = EXCLUDED.stone_cost,
    engagement_boost = EXCLUDED.engagement_boost,
    icon_emoji = EXCLUDED.icon_emoji,
    description = EXCLUDED.description,
    free_claim_limit = EXCLUDED.free_claim_limit,
    is_active = TRUE;

-- 3. Update purchase_stone_perk RPC: Atomic First-20-Free then Paid logic
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

    -- Lock the perk row to guarantee atomic first-20-free counting under concurrency
    SELECT stone_cost, name, COALESCE(free_claim_limit, 0), COALESCE(claimed_count, 0)
    INTO v_cost, v_name, v_free_limit, v_claimed_count
    FROM public.stone_perks
    WHERE id = p_perk_id AND is_active = TRUE
    FOR UPDATE;

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

    -- Check Early-Bird Free Quota (first N users claim free, afterwards costs stone_cost)
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

REVOKE ALL ON FUNCTION public.purchase_stone_perk(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_stone_perk(UUID, TEXT) TO authenticated, service_role;
