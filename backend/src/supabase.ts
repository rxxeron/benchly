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

/**
 * Validates a user's JWT and fetches their private profile (gender, alias, streaks, dept)
 */
export async function authenticateSocket(token: string) {
    // 1. Verify the JWT token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
        throw new Error('Authentication failed');
    }

    // 2. Fetch their generated profile from the users table
    const { data: profile, error: dbError } = await supabase
        .from('users')
        .select('id, generated_alias, gender, streak_count, dept_code, batch_year, email, alias_changed_at, alias_change_count, created_at')
        .eq('id', user.id)
        .single();

    if (dbError || !profile) {
        throw new Error('User profile not found');
    }

    // Extract meta if not populated in DB
    const meta = parseEwuEmail(profile.email || user.email || '');

    const lastChanged = profile.alias_changed_at 
        ? new Date(profile.alias_changed_at) 
        : (profile.created_at ? new Date(profile.created_at) : null);
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    const isRotationDue = lastChanged ? (Date.now() - lastChanged.getTime() >= fifteenDaysMs) : false;

    return {
        id: profile.id,
        alias: profile.generated_alias,
        gender: profile.gender,
        streak_count: profile.streak_count || 0,
        dept_code: profile.dept_code || meta.dept,
        batch_year: profile.batch_year || meta.batchYear,
        badge: meta.badge,
        email: profile.email || user.email,
        alias_changed_at: profile.alias_changed_at,
        alias_change_count: profile.alias_change_count || 0,
        aliasRotationDue: isRotationDue
    };
}
