export interface UserProfile {
    id: string;            // Supabase Auth UUID (Private)
    alias: string;         // The generated public name (e.g., "Silent Panther")
    gender: 'male' | 'female' | 'other';
    streak_count: number;
    dept_code?: string;    // 'CSE', 'BBA', 'EEE', etc.
    batch_year?: string;   // '2022', '2023', etc.
    badge?: string;        // 'CSE \'22'
    email?: string;
}

export interface ChatMessage {
    id: string;
    roomId: string;
    authorAlias: string;
    content: string;
    timestamp: number;
}

export interface RoomState {
    id: string;
    type: '1v1' | 'group';
    users: string[];
    createdAt: number;
    icebreaker?: string;
}
