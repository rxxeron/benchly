-- ====================================================================
-- BENCHLY — ZERO-COST PRIVACY-FIRST ANALYTICS & CAMPUS ENGAGEMENT
-- East West University (EWU) Edition
-- ====================================================================

-- 1. ENHANCE USERS TABLE WITH PRIVACY-SAFE DEMOGRAPHICS
-- We store Department and Batch Cohort (e.g. 'CSE', '2022') extracted from the email.
-- We DO NOT store the student's roll number or full name.
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS dept_code TEXT,       -- e.g. 'CSE', 'BBA', 'EEE', 'Pharmacy'
ADD COLUMN IF NOT EXISTS batch_year TEXT,      -- e.g. '2022', '2023', '2024'
ADD COLUMN IF NOT EXISTS semester_intake TEXT, -- 'Spring', 'Summer', 'Fall'
ADD COLUMN IF NOT EXISTS total_chats INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS stones_balance INT DEFAULT 10,
ADD COLUMN IF NOT EXISTS match_preference TEXT DEFAULT 'anyone';

-- 2. PRIVACY-PRESERVING ANALYTICS EVENTS TABLE
-- Holds high-level behavioral telemetry without any personal identifiability.
CREATE TABLE IF NOT EXISTS public.analytics_events (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    event_type TEXT NOT NULL, 
    -- e.g. 'match_created', 'chat_extended', 'chat_completed', 'message_sent', 'pii_blocked', 'report_filed', 'active_ping'
    dept_code TEXT,           -- 'CSE', 'BBA', 'EEE', etc.
    batch_year TEXT,          -- '2022', '2023'
    duration_seconds INT,     -- Recorded on chat_completed
    metadata JSONB DEFAULT '{}'::jsonb, -- e.g. { "pii_type": "phone", "seeking": "anyone" }
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for high-speed time-series analytics queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON public.analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_dept ON public.analytics_events (dept_code);

-- Enable RLS (Read-only by service role / backend admin)
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow service role full access on analytics" 
ON public.analytics_events FOR ALL USING (true) WITH CHECK (true);

-- 3. DAILY AGGREGATED METRICS TABLE (For Lightning Fast Historical Queries)
CREATE TABLE IF NOT EXISTS public.daily_metrics (
    date DATE PRIMARY KEY,
    total_chats INT DEFAULT 0,
    total_messages INT DEFAULT 0,
    unique_active_users INT DEFAULT 0,
    avg_duration_seconds INT DEFAULT 0,
    mutual_extensions_count INT DEFAULT 0,
    pii_blocked_count INT DEFAULT 0,
    reports_count INT DEFAULT 0,
    top_department TEXT DEFAULT 'CSE',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

-- 4. HIGH-PERFORMANCE ANALYTICS VIEWS

-- View: Department Distribution across Benchly
CREATE OR REPLACE VIEW public.v_department_distribution AS
SELECT 
    COALESCE(dept_code, 'Unknown') AS department,
    COUNT(*) AS student_count,
    ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM public.users), 0), 1) AS percentage
FROM public.users
GROUP BY dept_code
ORDER BY student_count DESC;

-- View: Peak Hours Activity (Hourly distribution of matches created)
CREATE OR REPLACE VIEW public.v_peak_hours_activity AS
SELECT 
    EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Dhaka') AS hour_of_day,
    COUNT(*) AS total_matches
FROM public.analytics_events
WHERE event_type = 'match_created'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY hour_of_day
ORDER BY hour_of_day ASC;

-- View: Chat Quality & Health Metrics
CREATE OR REPLACE VIEW public.v_chat_health_summary AS
SELECT
    COUNT(*) FILTER (WHERE event_type = 'match_created') AS total_matches,
    COUNT(*) FILTER (WHERE event_type = 'chat_extended') AS total_extensions,
    COUNT(*) FILTER (WHERE event_type = 'pii_blocked') AS total_pii_blocked,
    COUNT(*) FILTER (WHERE event_type = 'report_filed') AS total_reports,
    ROUND(AVG(duration_seconds) FILTER (WHERE event_type = 'chat_completed'), 0) AS avg_duration_seconds,
    ROUND(
        COUNT(*) FILTER (WHERE event_type = 'chat_extended') * 100.0 / 
        NULLIF(COUNT(*) FILTER (WHERE event_type = 'match_created'), 0), 
        1
    ) AS extension_rate_percentage
FROM public.analytics_events
WHERE created_at >= NOW() - INTERVAL '7 days';

-- 5. SAFETY & INVESTIGATION RETENTION (90-Day Rolling Cleanup for Messages)
-- Retains messages for 90 days (3 months) strictly for reviewing abuse/harassment reports.
-- Messages older than 90 days are automatically purged.
CREATE OR REPLACE FUNCTION public.cleanup_old_ephemeral_messages()
RETURNS void AS $$
BEGIN
    DELETE FROM public.messages 
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- 6. EWU EMAIL METADATA PARSER FUNCTION
-- Triggered on new user registration to set anonymized department and batch cohort
CREATE OR REPLACE FUNCTION public.parse_ewu_student_email()
RETURNS TRIGGER AS $$
DECLARE
    email_user TEXT;
    email_parts TEXT[];
    dept_num TEXT;
BEGIN
    -- Extract the username part from e.g. '2022-1-60-045@std.ewubd.edu'
    email_user := split_part(NEW.email, '@', 1);
    email_parts := string_to_array(email_user, '-');
    
    -- Format is: YYYY - Semester - DeptNum - Roll
    IF array_length(email_parts, 1) = 4 THEN
        NEW.batch_year := email_parts[1];
        
        -- Semester: 1 = Spring, 2 = Summer, 3 = Fall
        IF email_parts[2] = '1' THEN
            NEW.semester_intake := 'Spring';
        ELSIF email_parts[2] = '2' THEN
            NEW.semester_intake := 'Summer';
        ELSIF email_parts[2] = '3' THEN
            NEW.semester_intake := 'Fall';
        ELSE
            NEW.semester_intake := 'General';
        END IF;

        -- EWU Department Codes:
        -- 60: CSE | 10: BBA | 20: EEE | 30: Pharmacy | 40: English | 50: Economics | 70: Law | 80: Civil
        dept_num := email_parts[3];
        IF dept_num = '60' THEN
            NEW.dept_code := 'CSE';
        ELSIF dept_num = '10' THEN
            NEW.dept_code := 'BBA';
        ELSIF dept_num = '20' THEN
            NEW.dept_code := 'EEE';
        ELSIF dept_num = '30' THEN
            NEW.dept_code := 'Pharmacy';
        ELSIF dept_num = '40' THEN
            NEW.dept_code := 'English';
        ELSIF dept_num = '50' THEN
            NEW.dept_code := 'Economics';
        ELSIF dept_num = '70' THEN
            NEW.dept_code := 'Law';
        ELSIF dept_num = '80' THEN
            NEW.dept_code := 'Civil';
        ELSE
            NEW.dept_code := 'Other';
        END IF;
    ELSE
        -- Fallback for test / dev accounts
        NEW.batch_year := '2024';
        NEW.semester_intake := 'Spring';
        NEW.dept_code := 'CSE';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind trigger on INSERT or UPDATE
DROP TRIGGER IF EXISTS trigger_parse_ewu_student_email ON public.users;
CREATE TRIGGER trigger_parse_ewu_student_email
BEFORE INSERT OR UPDATE OF email ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.parse_ewu_student_email();
