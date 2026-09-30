export interface UserProfile {
    id: string;            // Supabase Auth UUID (Private)
    alias: string;         // The generated public name (e.g., "Silent Panther")
    gender: 'male' | 'female' | 'other';
    streak_count: number;
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
    users: UserProfile[];
    expiresAt: number;
    extensionRequests: string[]; // Array of user IDs who requested an extension
}
