import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import { CanonicalHuffmanCodec } from '../algorithms/huffman_codec';
import type { AiRoomSession } from '../ai_campus_companion';

export const CHAT_DURATION_MS = 15 * 60 * 1000;
export const CHAT_WARNING_MS = 14 * 60 * 1000;
export const DISCONNECT_GRACE_MS = 15 * 1000;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_GUESSES_PER_ROOM = 10;
export const GUESS_COOLDOWN_MS = 2000;

export interface RoomSessionData {
    user1: string;
    user2: string;
    user1Alias?: string;
    user2Alias?: string;
    startTime: number;
    user1Messages: number;
    user2Messages: number;
    recorded?: boolean;
}

export interface PendingGuessReveal {
    roomId: string;
    guesserId: string;
    guesserSocketId: string;
    guesserAlias: string;
    partnerId: string;
    partnerAlias: string;
    field: string;
    fieldLabel: string;
    revealedValue: string;
    createdAt: number;
}

export interface SocketState {
    activeUsers: Map<string, any>;
    userSocketMap: Map<string, string>;
    roomTimeouts: Map<string, NodeJS.Timeout[]>;
    roomScreenshotVotes: Map<string, Set<string>>;
    disconnectGraceTimers: Map<string, NodeJS.Timeout>;
    roomMembers: Map<string, RoomSessionData>;
    handshakeVotes: Map<string, Set<string>>;
    queueTimeouts: Map<string, NodeJS.Timeout>;
    aiRoomSessions: Map<string, AiRoomSession>;
    pendingGuessReveals: Map<string, PendingGuessReveal>;
    guessAttempts: Map<string, { count: number; lastAt: number }>;
    rateLimitMap: Map<string, number>;
    isRoomMember: (roomId: string, userId: string) => Promise<boolean>;
    saveRoomSession: (roomId: string) => Promise<void>;
}

export function createSocketState(deps: { supabase: SupabaseClient; redis: Redis }): SocketState {
    const { supabase, redis } = deps;
    const activeUsers = new Map<string, any>();
    const userSocketMap = new Map<string, string>();
    const roomTimeouts = new Map<string, NodeJS.Timeout[]>();
    const roomScreenshotVotes = new Map<string, Set<string>>();
    const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();
    const roomMembers = new Map<string, RoomSessionData>();
    const handshakeVotes = new Map<string, Set<string>>();
    const queueTimeouts = new Map<string, NodeJS.Timeout>();
    const aiRoomSessions = new Map<string, AiRoomSession>();
    const pendingGuessReveals = new Map<string, PendingGuessReveal>();
    const guessAttempts = new Map<string, { count: number; lastAt: number }>();
    const rateLimitMap = new Map<string, number>();

    async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
        if (!roomId || !userId) return false;
        const mem = roomMembers.get(roomId);
        if (mem && (mem.user1 === userId || mem.user2 === userId)) return true;
        if (roomId.startsWith('group_')) {
            const isGroupMem = await redis.sismember(`group_members:${roomId}`, userId).catch(() => 0);
            return Boolean(isGroupMem);
        }
        return false;
    }

    async function saveRoomSession(roomId: string): Promise<void> {
        const mem = roomMembers.get(roomId);
        if (!mem || mem.recorded) return;
        mem.recorded = true;

        const durationSec = Math.max(1, Math.round((Date.now() - mem.startTime) / 1000));
        try {
            const rawMsgs = await redis.lrange(`room_messages:${roomId}`, 0, -1);
            const messagesList = rawMsgs
                .map((m: string) => {
                    try {
                        return JSON.parse(m);
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);

            const isHandshakeAgreed = (await redis.get(`room:${roomId}:handshake_agreed`)) === 'true';
            const rawTranscriptJson = JSON.stringify(messagesList);
            const sealedArchive = CanonicalHuffmanCodec.sealEncryptedHuffmanArchive(rawTranscriptJson);

            const isUuid = (v: string | undefined | null) =>
                Boolean(v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
            const user1Uuid = isUuid(mem.user1) ? mem.user1 : null;
            const user2Uuid = isUuid(mem.user2) ? mem.user2 : null;

            const { error: convErr } = await supabase.from('room_conversations').insert({
                room_id: roomId,
                user1_id: user1Uuid,
                user2_id: user2Uuid,
                user1_alias: mem.user1Alias || 'Anonymous Student',
                user2_alias: mem.user2Alias || 'Anonymous Student',
                messages: [],
                huffman_meta: sealedArchive,
                compression_savings_pct: sealedArchive.savingsPercent,
                messages_count: messagesList.length,
                duration_seconds: durationSec,
                handshake_agreed: isHandshakeAgreed,
                closed_at: new Date().toISOString()
            });
            if (convErr) {
                console.error(`❌ room_conversations insert failed for ${roomId}:`, convErr.message);
            } else {
                console.log(
                    `🔐🗜️ Huffman+AES-256-GCM archived room ${roomId}: ${sealedArchive.originalBytes}B -> ${sealedArchive.compressedBytes}B (${sealedArchive.savingsPercent}% saved, H(X)=${sealedArchive.shannonEntropy})`
                );
            }

            const sessionRows: any[] = [];
            if (user1Uuid) {
                sessionRows.push({
                    room_id: roomId,
                    user_id: user1Uuid,
                    partner_id: user2Uuid,
                    messages_sent: mem.user1Messages,
                    messages_received: mem.user2Messages,
                    duration_seconds: durationSec
                });
            }
            if (user2Uuid) {
                sessionRows.push({
                    room_id: roomId,
                    user_id: user2Uuid,
                    partner_id: user1Uuid,
                    messages_sent: mem.user2Messages,
                    messages_received: mem.user1Messages,
                    duration_seconds: durationSec
                });
            }
            if (sessionRows.length > 0) {
                const { error: sessErr } = await supabase.from('chat_sessions').insert(sessionRows);
                if (sessErr) console.error(`❌ chat_sessions insert failed for ${roomId}:`, sessErr.message);
            }

            await redis.del(
                `room_messages:${roomId}`,
                `room_handshake:${roomId}`,
                `room:${roomId}:handshake_agreed`,
                `room_extension:${roomId}`
            );
            console.log(`💾 Persisted entire room chat (${messagesList.length} msgs) in 1 row to Supabase for room ${roomId}`);
        } catch (err) {
            console.error('Failed to save room conversation / chat_sessions:', err);
        }
    }

    // 30-minute flusher & per-second socket message rate-limit reset
    setInterval(async () => {
        const now = Date.now();
        for (const [roomId, mem] of roomMembers.entries()) {
            if (!mem.recorded && now - mem.startTime >= 30 * 60 * 1000) {
                console.log(`⏱️ 30-minute threshold reached for room ${roomId}. Archiving whole chat to Supabase.`);
                await saveRoomSession(roomId);
            }
        }
    }, 60 * 1000).unref();

    setInterval(() => rateLimitMap.clear(), 1000).unref();

    return {
        activeUsers,
        userSocketMap,
        roomTimeouts,
        roomScreenshotVotes,
        disconnectGraceTimers,
        roomMembers,
        handshakeVotes,
        queueTimeouts,
        aiRoomSessions,
        pendingGuessReveals,
        guessAttempts,
        rateLimitMap,
        isRoomMember,
        saveRoomSession
    };
}
