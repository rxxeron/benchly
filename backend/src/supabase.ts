import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { parseEwuEmail } from './ewu_helper';

dotenv.config();

// We use the Service Role Key in the backend so it can securely fetch 
// user data and process batch database writes without RLS blocking it.
export const supabase = createClient(
    process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder_key'
);

export function isAllowedEwuEmail(email: string | undefined | null): boolean {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    if (normalized === 'rhrakibulhasan279@gmail.com') return true;
    return /^[a-z0-9._%+-]+@std\.ewubd\.edu$/i.test(normalized);
}

/**
 * Validates a user's JWT and fetches their private profile (gender, alias, streaks, dept)
 */
export async function authenticateSocket(token: string) {
    // 1. Verify the JWT token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
        throw new Error('Authentication failed');
    }

    if (!isAllowedEwuEmail(user.email)) {
        throw new Error('Only @std.ewubd.edu email addresses are allowed');
    }

    // 2. Fetch their generated profile from the users table
    const { data: profile, error: dbError } = await supabase
        .from('users')
        .select('id, generated_alias, gender, streak_count, dept_code, batch_year, semester_intake, email, alias_changed_at, alias_change_count, created_at')
        .eq('id', user.id)
        .single();

    if (dbError || !profile) {
        throw new Error('User profile not found');
    }

    if (!isAllowedEwuEmail(profile.email || user.email)) {
        throw new Error('Only @std.ewubd.edu email addresses are allowed');
    }

    // Extract meta if not populated in DB
    const meta = parseEwuEmail(profile.email || user.email || '');
    const userMeta = (user.user_metadata || {}) as Record<string, any>;

    const deptCode = profile.dept_code || userMeta.dept_code || meta.dept;
    const currentSemester = profile.semester_intake || userMeta.current_semester || null;
    const batchYear = profile.batch_year || meta.batchYear;
    const shortYear = String(batchYear || '2024').slice(-2);
    const liveBadge = currentSemester ? `${deptCode} • ${currentSemester}` : `${deptCode} '${shortYear}`;

    return {
        id: profile.id,
        alias: profile.generated_alias,
        gender: profile.gender,
        streak_count: profile.streak_count || 0,
        dept_code: deptCode,
        batch_year: batchYear,
        current_semester: currentSemester,
        admitted_semester: userMeta.admitted_semester || null,
        real_name: userMeta.real_name || null,
        real_age: userMeta.real_age ? Number(userMeta.real_age) : null,
        allow_guessing: userMeta.allow_guessing !== false,
        badge: liveBadge,
        email: profile.email || user.email,
        alias_changed_at: profile.alias_changed_at,
        alias_change_count: profile.alias_change_count || 0,
        aliasRotationDue: false
    };
}
