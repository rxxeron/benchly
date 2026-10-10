-- ====================================================================
-- BENCHLY — 15-DAY ALIAS ROTATION, AUDIT HISTORY & STUDENT ENGAGEMENT
-- ====================================================================

-- 1. Create ALIAS_HISTORY table
CREATE TABLE IF NOT EXISTS public.alias_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    old_alias TEXT NOT NULL,
    new_alias TEXT NOT NULL,
    change_type TEXT NOT NULL DEFAULT 'manual' CHECK (change_type IN ('manual', 'auto')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alias_history_user_id ON public.alias_history(user_id);
CREATE INDEX IF NOT EXISTS idx_alias_history_created_at ON public.alias_history(created_at DESC);

ALTER TABLE public.alias_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own alias history" ON public.alias_history;
CREATE POLICY "Users can view own alias history" 
ON public.alias_history FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own alias history" ON public.alias_history;
CREATE POLICY "Users can insert own alias history" 
ON public.alias_history FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on alias history" ON public.alias_history;
CREATE POLICY "Service role full access on alias history"
ON public.alias_history FOR ALL
USING (true) WITH CHECK (true);

-- 2. Create CHAT_SESSIONS table
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    partner_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    messages_sent INT NOT NULL DEFAULT 0,
    messages_received INT NOT NULL DEFAULT 0,
    duration_seconds INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_time ON public.chat_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_room ON public.chat_sessions(room_id);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chat sessions" ON public.chat_sessions;
CREATE POLICY "Users can view own chat sessions"
ON public.chat_sessions FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on chat sessions" ON public.chat_sessions;
CREATE POLICY "Service role full access on chat sessions"
ON public.chat_sessions FOR ALL
USING (true) WITH CHECK (true);

-- 2.5 Create ROOM_CONVERSATIONS table (Entire chat transcript per room in ONE row)
CREATE TABLE IF NOT EXISTS public.room_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    user1_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    user2_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    user1_alias TEXT,
    user2_alias TEXT,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    messages_count INT NOT NULL DEFAULT 0,
    duration_seconds INT NOT NULL DEFAULT 0,
    handshake_agreed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_conversations_room ON public.room_conversations(room_id);
CREATE INDEX IF NOT EXISTS idx_room_conversations_user1 ON public.room_conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_room_conversations_user2 ON public.room_conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_room_conversations_created_at ON public.room_conversations(created_at DESC);

ALTER TABLE public.room_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on room conversations" ON public.room_conversations;
CREATE POLICY "Service role full access on room conversations" 
ON public.room_conversations FOR ALL 
USING (true) WITH CHECK (true);

-- 3. Stored Procedure: get_student_analytics
CREATE OR REPLACE FUNCTION public.get_student_analytics(
    p_user_id UUID,
    p_timeframe TEXT DEFAULT 'weekly'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_start_time TIMESTAMPTZ;
    v_result JSONB;
BEGIN
    IF p_timeframe = 'daily' THEN
        v_start_time := NOW() - INTERVAL '1 day';
    ELSIF p_timeframe = 'monthly' THEN
        v_start_time := NOW() - INTERVAL '30 days';
    ELSE -- 'weekly'
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

-- 4. Stored Procedure: rotate_user_alias
CREATE OR REPLACE FUNCTION public.rotate_user_alias(
    p_user_id UUID,
    p_new_alias TEXT DEFAULT NULL,
    p_change_type TEXT DEFAULT 'manual'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_alias TEXT;
    v_last_changed TIMESTAMPTZ;
    v_change_count INT;
    v_target_alias TEXT;
    v_adjectives TEXT[] := ARRAY['Silent', 'Brave', 'Sleepy', 'Neon', 'Midnight', 'Caffeinated', 'Phantom', 'Shadow', 'Crimson', 'Lost', 'Chill', 'Hungry', 'Genius', 'Rebel', 'Mysterious', 'Electric', 'Chaotic', 'Zen', 'Velvet', 'Cosmic'];
    v_nouns TEXT[] := ARRAY['Panther', 'Scholar', 'Coder', 'Freshman', 'Backbencher', 'Ninja', 'Ghost', 'Senior', 'Engineer', 'Debater', 'Gamer', 'Potato', 'Dinosaur', 'Penguin', 'Hacker', 'Overthinker', 'Falcon', 'Raven'];
    v_random_num INT;
BEGIN
    SELECT generated_alias, alias_changed_at, COALESCE(alias_change_count, 0)
    INTO v_current_alias, v_last_changed, v_change_count
    FROM public.users
    WHERE id = p_user_id;

    IF v_current_alias IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- If not the first change, enforce 15-day cooldown
    IF v_change_count > 0 AND v_last_changed IS NOT NULL THEN
        IF v_last_changed > NOW() - INTERVAL '15 days' THEN
            RAISE EXCEPTION '15-day cooldown active. Please wait before changing alias again.';
        END IF;
    END IF;

    IF p_new_alias IS NOT NULL AND length(trim(p_new_alias)) >= 3 THEN
        v_target_alias := trim(p_new_alias);
    ELSE
        -- Generate random alias
        v_random_num := floor(random() * 90 + 10)::int;
        v_target_alias := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int] || ' ' ||
                          v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int] || ' ' ||
                          v_random_num::text;
    END IF;

    -- Record in alias_history
    INSERT INTO public.alias_history (user_id, old_alias, new_alias, change_type)
    VALUES (p_user_id, v_current_alias, v_target_alias, p_change_type);

    -- Update users table
    UPDATE public.users
    SET generated_alias = v_target_alias,
        alias_changed_at = NOW(),
        alias_change_count = v_change_count + 1
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'old_alias', v_current_alias,
        'new_alias', v_target_alias,
        'change_type', p_change_type,
        'changed_at', NOW()
    );
END;
$$;
