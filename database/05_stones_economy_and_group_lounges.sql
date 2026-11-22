-- ====================================================================
-- BENCHLY — PHASE 3 CAMPUS STONES 💎 ECONOMY, PERKS & HUFFMAN ARCHIVE
-- ====================================================================

-- 1. PERKS & COLLECTIBLES CATALOG TABLE (0/1 Knapsack Items)
CREATE TABLE IF NOT EXISTS public.stone_perks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    stone_cost INT NOT NULL CHECK (stone_cost > 0),
    engagement_boost INT NOT NULL CHECK (engagement_boost > 0),
    icon_emoji TEXT NOT NULL DEFAULT '💎',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.stone_perks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read active stone perks" ON public.stone_perks;
CREATE POLICY "Anyone authenticated can read active stone perks"
ON public.stone_perks FOR SELECT
USING (true);

-- Seed default production perks (idempotent upsert)
INSERT INTO public.stone_perks (id, name, category, stone_cost, engagement_boost, icon_emoji, description)
VALUES
    ('perk_dept_hint', 'Mid-Chat Dept Reveal Hint', 'In-Chat Boost', 2, 18, '🕵️', 'Peek at your partner''s department badge early during an adda.'),
    ('perk_priority_queue', 'Rush-Hour Priority Queue Pass', 'Matchmaking', 3, 29, '⚡', 'Boost your queue priority weight in the Edmonds-Karp matchmaker.'),
    ('avatar_campus_cat', 'Campus Cat Collectible Badge', 'Avatar Shop', 4, 36, '🐱', 'Display the EWU Courtyard Cat badge next to your alias.'),
    ('perk_custom_alias', 'Custom Anonymous Pseudonym Pass', 'Identity', 5, 48, '🎭', 'Roll a custom alias early without waiting for the 15-day timer.'),
    ('avatar_tea_philosopher', 'Tea Stall Philosopher Flair', 'Avatar Shop', 6, 62, '☕', 'Aftabnagar main gate cha-lover flair on your chat header.'),
    ('perk_super_extend', '+15m Instant Super-Extend Token', 'In-Chat Boost', 7, 74, '⏳', 'Extend a great bench adda by +15 minutes with one tap.'),
    ('avatar_night_owl', 'Midnight Adda Night-Owl Aura', 'Avatar Shop', 9, 96, '🦉', 'Exclusive glowing neon badge for 10 PM – 2 AM night-owl addas.')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    stone_cost = EXCLUDED.stone_cost,
    engagement_boost = EXCLUDED.engagement_boost,
    icon_emoji = EXCLUDED.icon_emoji,
    description = EXCLUDED.description;

-- 2. USER UNLOCKED PERKS TABLE
CREATE TABLE IF NOT EXISTS public.user_perks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    perk_id TEXT NOT NULL REFERENCES public.stone_perks(id) ON DELETE CASCADE,
    is_equipped BOOLEAN NOT NULL DEFAULT TRUE,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, perk_id)
);

CREATE INDEX IF NOT EXISTS idx_user_perks_user ON public.user_perks(user_id);

ALTER TABLE public.user_perks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own unlocked perks" ON public.user_perks;
CREATE POLICY "Users can view own unlocked perks"
ON public.user_perks FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own unlocked perks" ON public.user_perks;
CREATE POLICY "Users can insert own unlocked perks"
ON public.user_perks FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own unlocked perks" ON public.user_perks;
CREATE POLICY "Users can update own unlocked perks"
ON public.user_perks FOR UPDATE
USING (auth.uid() = user_id);

-- 3. STONE TRANSACTIONS LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.stone_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    tx_type TEXT NOT NULL, -- 'daily_login', 'chat_milestone', 'referral_join', 'streak_bonus', 'unlock_perk'
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stone_transactions_user ON public.stone_transactions(user_id, created_at DESC);

ALTER TABLE public.stone_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own stone transactions" ON public.stone_transactions;
CREATE POLICY "Users can view own stone transactions"
ON public.stone_transactions FOR SELECT
USING (auth.uid() = user_id);

-- 4. ADD HUFFMAN COMPRESSION TELEMETRY TO ROOM_CONVERSATIONS
ALTER TABLE public.room_conversations
ADD COLUMN IF NOT EXISTS huffman_meta JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS compression_savings_pct NUMERIC(5,2) DEFAULT 0.0;

-- 5. ATOMIC RPC: claim_daily_login_stones
CREATE OR REPLACE FUNCTION public.claim_daily_login_stones(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_already_claimed BOOLEAN;
    v_new_balance INT;
    v_new_streak INT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.stone_transactions
        WHERE user_id = p_user_id
          AND tx_type = 'daily_login'
          AND created_at >= CURRENT_DATE
    ) INTO v_already_claimed;

    IF v_already_claimed THEN
        SELECT stones_balance, streak_count INTO v_new_balance, v_new_streak
        FROM public.users WHERE id = p_user_id;

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

-- 6. ATOMIC RPC: purchase_stone_perk
CREATE OR REPLACE FUNCTION public.purchase_stone_perk(
    p_user_id UUID,
    p_perk_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cost INT;
    v_name TEXT;
    v_balance INT;
    v_already_owned BOOLEAN;
BEGIN
    SELECT stone_cost, name INTO v_cost, v_name
    FROM public.stone_perks
    WHERE id = p_perk_id AND is_active = TRUE;

    IF v_cost IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Perk not found');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.user_perks
        WHERE user_id = p_user_id AND perk_id = p_perk_id
    ) INTO v_already_owned;

    IF v_already_owned THEN
        UPDATE public.user_perks
        SET is_equipped = NOT is_equipped
        WHERE user_id = p_user_id AND perk_id = p_perk_id;

        SELECT stones_balance INTO v_balance FROM public.users WHERE id = p_user_id;
        RETURN jsonb_build_object(
            'success', true,
            'toggled_equip', true,
            'stones_balance', v_balance
        );
    END IF;

    SELECT COALESCE(stones_balance, 0) INTO v_balance
    FROM public.users WHERE id = p_user_id;

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
