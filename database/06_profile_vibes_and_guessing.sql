-- ====================================================================
-- BENCHLY — PROFILE VIBES, DB-BACKED SEMESTERS & DEPARTMENTS, GUESSING
-- ====================================================================

-- 1. Add optional private profile & guessing columns to public.users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS real_name TEXT,
    ADD COLUMN IF NOT EXISTS admitted_semester TEXT,
    ADD COLUMN IF NOT EXISTS real_age INT CHECK (real_age IS NULL OR (real_age >= 15 AND real_age <= 45)),
    ADD COLUMN IF NOT EXISTS allow_guessing BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Database-backed EWU Departments lookup table
CREATE TABLE IF NOT EXISTS public.ewu_departments (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 100
);

ALTER TABLE public.ewu_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ewu_departments" ON public.ewu_departments;
CREATE POLICY "Public read ewu_departments" ON public.ewu_departments FOR SELECT USING (true);

INSERT INTO public.ewu_departments (code, label, sort_order) VALUES
    ('CSE', 'Computer Science & Engineering', 1),
    ('EEE', 'Electrical & Electronic Engineering', 2),
    ('BBA', 'Business Administration', 3),
    ('English', 'English', 4),
    ('Pharmacy', 'Pharmacy', 5),
    ('Economics', 'Economics', 6),
    ('Law', 'Law', 7),
    ('Civil', 'Civil Engineering', 8),
    ('Data Science', 'Data Science & Analytics', 9),
    ('ICE', 'Information & Communications Engineering', 10),
    ('GEB', 'Genetic Engineering & Biotechnology', 11),
    ('Sociology', 'Sociology', 12),
    ('IS', 'Information Studies', 13),
    ('MPS', 'Mathematical & Physical Sciences', 14),
    ('MBA', 'MBA / Graduate', 15),
    ('Other', 'Other Department', 99)
ON CONFLICT (code) DO NOTHING;

-- 3. Database-backed EWU Semesters lookup table (both current & admitted terms)
CREATE TABLE IF NOT EXISTS public.ewu_semesters (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('current', 'admitted')),
    sort_order INT NOT NULL DEFAULT 100
);

ALTER TABLE public.ewu_semesters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ewu_semesters" ON public.ewu_semesters;
CREATE POLICY "Public read ewu_semesters" ON public.ewu_semesters FOR SELECT USING (true);

INSERT INTO public.ewu_semesters (code, kind, sort_order) VALUES
    ('1st Sem', 'current', 1),
    ('2nd Sem', 'current', 2),
    ('3rd Sem', 'current', 3),
    ('4th Sem', 'current', 4),
    ('5th Sem', 'current', 5),
    ('6th Sem', 'current', 6),
    ('7th Sem', 'current', 7),
    ('8th Sem', 'current', 8),
    ('9th Sem', 'current', 9),
    ('10th Sem', 'current', 10),
    ('11th Sem', 'current', 11),
    ('12th Sem', 'current', 12),
    ('Grad / Masters', 'current', 13),
    ('Fall 2026', 'admitted', 1),
    ('Summer 2026', 'admitted', 2),
    ('Spring 2026', 'admitted', 3),
    ('Fall 2025', 'admitted', 4),
    ('Summer 2025', 'admitted', 5),
    ('Spring 2025', 'admitted', 6),
    ('Fall 2024', 'admitted', 7),
    ('Summer 2024', 'admitted', 8),
    ('Spring 2024', 'admitted', 9),
    ('Fall 2023', 'admitted', 10),
    ('Summer 2023', 'admitted', 11),
    ('Spring 2023', 'admitted', 12),
    ('Fall 2022', 'admitted', 13),
    ('Summer 2022', 'admitted', 14),
    ('Spring 2022', 'admitted', 15),
    ('Fall 2021', 'admitted', 16),
    ('Summer 2021', 'admitted', 17),
    ('Spring 2021', 'admitted', 18),
    ('Before 2021', 'admitted', 99)
ON CONFLICT (code) DO NOTHING;

-- 4. Upgrade rotate_user_alias:
--    - Changeable ANYTIME (removes 15-day cooldown)
--    - Eclectic, non-coding, non-gaming nickname pool
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
    SELECT generated_alias
    INTO v_current_alias
    FROM public.users
    WHERE id = p_user_id;

    IF v_current_alias IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    IF p_new_alias IS NOT NULL AND length(trim(p_new_alias)) >= 3 THEN
        v_target_alias := trim(p_new_alias);
    ELSE
        v_random_num := floor(random() * 90 + 10)::int;
        v_target_alias := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int] || ' ' ||
                          v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int] || ' ' ||
                          v_random_num::text;
    END IF;

    INSERT INTO public.alias_history (user_id, old_alias, new_alias, change_type)
    VALUES (p_user_id, v_current_alias, v_target_alias, p_change_type);

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
