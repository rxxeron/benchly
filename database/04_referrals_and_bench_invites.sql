-- ====================================================================
-- BENCHLY — SHORT URL BENCH INVITES & REFERRAL ATTRIBUTION TRACKING
-- ====================================================================

-- 1. Add referral columns to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS total_referrals INT DEFAULT 0;

-- 2. Create referrals tracking table
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    invitee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    short_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'visited', 'joined_bench', 'registered')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON public.referrals(inviter_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals(short_code);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own referrals" ON public.referrals;
CREATE POLICY "Users can view own referrals" 
ON public.referrals FOR SELECT 
USING (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Service role full access on referrals" ON public.referrals;
CREATE POLICY "Service role full access on referrals" 
ON public.referrals FOR ALL 
USING (true) WITH CHECK (true);

-- 3. Stored Procedure: record_referral_join
CREATE OR REPLACE FUNCTION public.record_referral_join(
    p_short_code TEXT,
    p_invitee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_inviter_id UUID;
    v_already_joined BOOLEAN;
BEGIN
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

    -- Check if this invitee was already recorded
    SELECT EXISTS (
        SELECT 1 FROM public.referrals 
        WHERE short_code = p_short_code AND invitee_id = p_invitee_id
    ) INTO v_already_joined;

    IF NOT v_already_joined THEN
        -- Insert referral join record
        INSERT INTO public.referrals (inviter_id, invitee_id, short_code, status)
        VALUES (v_inviter_id, p_invitee_id, p_short_code, 'joined_bench');

        -- Update inviter's total referrals and award stones (+5 stones per student)
        UPDATE public.users
        SET total_referrals = COALESCE(total_referrals, 0) + 1,
            stones_balance = COALESCE(stones_balance, 0) + 5
        WHERE id = v_inviter_id;

        -- Update invitee's referred_by if not set
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
