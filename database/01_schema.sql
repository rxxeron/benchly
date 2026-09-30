-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE (Linked to Supabase Auth)
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    generated_alias TEXT UNIQUE NOT NULL,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ DEFAULT NOW(),
    streak_count INT DEFAULT 0
);

-- Secure the users table (Row Level Security)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- Users can only read their own profile data
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
-- Users can update their own profile (except alias/email if we want to lock them)
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- 2. MESSAGES TABLE (For Batch Persistence from Redis)
CREATE TABLE public.messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    room_id UUID NOT NULL,
    author_id UUID REFERENCES public.users(id) ON DELETE SET NULL, -- Kept internal, NEVER sent to client
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    moderation_status TEXT DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'flagged', 'removed'))
);

-- We don't expose messages directly via Supabase API (Frontend gets them via Socket.IO)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 3. REPORTS TABLE (For Abuse Prevention)
CREATE TABLE public.reports (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    reporter_id UUID REFERENCES public.users(id),
    reported_message_id UUID REFERENCES public.messages(id),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert reports" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
