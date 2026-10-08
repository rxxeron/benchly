/**
 * EWU Campus Intelligence Helper
 * Parses East West University student IDs safely without exposing private roll numbers.
 * Provides tailored campus icebreakers for student engagement.
 */

export interface EwuStudentMeta {
    dept: string;
    batchYear: string;
    semester: string;
    badge: string; // e.g. "CSE '22"
}

const DEPT_MAP: Record<string, string> = {
    '60': 'CSE',
    '10': 'BBA',
    '20': 'EEE',
    '30': 'Pharmacy',
    '40': 'English',
    '50': 'Economics',
    '70': 'Law',
    '80': 'Civil',
    '11': 'MBA',
    '61': 'Data Science'
};

const SEMESTER_MAP: Record<string, string> = {
    '1': 'Spring',
    '2': 'Summer',
    '3': 'Fall'
};

export function parseEwuEmail(email: string): EwuStudentMeta {
    if (!email) {
        return { dept: 'General', batchYear: '2024', semester: 'Spring', badge: 'EWU Student' };
    }

    const username = email.split('@')[0];
    const parts = username.split('-');

    // Standard pattern: YYYY-S-DD-NNN (e.g. 2022-1-60-045)
    if (parts.length === 4) {
        const year = parts[0];
        const semCode = parts[1];
        const deptCode = parts[2];

        const dept = DEPT_MAP[deptCode] || 'Campus';
        const semester = SEMESTER_MAP[semCode] || 'Semester';
        const shortYear = year.length === 4 ? `'${year.slice(2)}` : year;

        return {
            dept,
            batchYear: year,
            semester,
            badge: `${dept} ${shortYear}`
        };
    }

    // Developer / bypass fallback
    return {
        dept: 'CSE',
        batchYear: '2023',
        semester: 'Spring',
        badge: 'Benchly Dev'
    };
}

/**
 * Curated East West University Campus Icebreakers ("Adda Sparks")
 * Designed to spark instant conversation and avoid awkward silences.
 */
export const EWU_CAMPUS_ICEBREAKERS: string[] = [
    "Which faculty gave the hardest midterm this semester?",
    "Campus Canteen food vs Aftabnagar street food: which one wins?",
    "Are you chilling on the ground floor benches or hiding in the library?",
    "What department do you think has the highest stress level in EWU?",
    "Coffee from the cafeteria or Cha from the Aftabnagar main gate?",
    "Are you an all-nighter crammer or do you actually study before exam week?",
    "What's the best spot on campus for a peaceful adda?",
    "Did you ever get lost looking for a classroom in the new building?",
    "Which club in EWU is actually the most fun to join?",
    "If you could cancel one mandatory course from your degree, which one?",
    "Morning 8:30 AM class or evening 4:40 PM class: which is worse?",
    "What's your secret spot on campus to take a quick nap?",
    "Has anyone ever asked you for assignments 10 minutes before the deadline?",
    "Are you studying for grades, a CGPA flex, or just trying to survive?",
    "What is the most underrated food stall right outside EWU gate?",
    "Rate the campus WiFi right now from 1 to 10.",
    "Do you prefer rainy day adda in Aftabnagar or AC chill in the library?",
    "What course made you question all your life decisions so far?",
    "Are you an introvert who likes anonymous chat, or just bored between classes?",
    "Who is your favorite professor this semester and why?",
    "How many assignments are pending on your to-do list right now?",
    "If Benchly had a campus meetup at the canteen, would you show up?"
];

export function getRandomIcebreaker(): string {
    const idx = Math.floor(Math.random() * EWU_CAMPUS_ICEBREAKERS.length);
    return EWU_CAMPUS_ICEBREAKERS[idx];
}
