/**
 * CSE246 Lab 6 & Lab 10: Anti-Evasion PII & Harassment Shield for Benchly
 * Combines:
 * 1. Knuth-Morris-Pratt (KMP O(N+M) with pi-Prefix/LPS Table)
 * 2. Rabin-Karp rolling hash (sliding K-char window + verification on hash hit) for
 *    per-sender copy-paste flood detection across rooms
 * 3. Longest Common Subsequence (LCS) Dynamic Programming for Obfuscated Social Handles
 */

export interface PiiInspectionVerdict {
    safeContent: string;
    wasModified: boolean;
    blockedTypes: string[];
    kmpMatches: string[];
    rabinKarpSpamDetected: boolean;
    lcsMaxSimilarity: number;
}

const WORD_DIGIT_MAP: Record<string, string> = {
    zero: '0', oh: '0', o: '0', shunno: '0',
    one: '1', ek: '1',
    two: '2', dui: '2',
    three: '3', tin: '3',
    four: '4', char: '4',
    five: '5', pach: '5',
    six: '6', choy: '6',
    seven: '7', shat: '7',
    eight: '8', aat: '8',
    nine: '9', noy: '9'
};

export class BenchlyPiiShield {
    /** Window length for Rabin-Karp flood detection (characters of normalized a-z0-9 text). */
    static readonly RK_WINDOW = 12;
    private static readonly RK_BASE = 257;
    private static readonly RK_MOD = 1000000007;
    private static readonly FLOOD_WINDOW_MS = 45000;
    /** A message is flood when it repeats a K-window from this many of the sender's recent messages. */
    private static readonly FLOOD_REPEATS = 3;
    private static recentBySender = new Map<string, Array<{ text: string; at: number }>>();

    /**
     * Builds the KMP Longest Proper Prefix which is also Suffix (LPS / pi) array in O(M)
     */
    static buildKmpLps(pattern: string): number[] {
        const m = pattern.length;
        const lps = new Array<number>(m).fill(0);
        let len = 0;
        let i = 1;
        while (i < m) {
            if (pattern[i] === pattern[len]) {
                len++;
                lps[i] = len;
                i++;
            } else {
                if (len !== 0) {
                    len = lps[len - 1];
                } else {
                    lps[i] = 0;
                    i++;
                }
            }
        }
        return lps;
    }

    /**
     * Searches text for pattern in strict O(N + M) time using KMP
     */
    static kmpSearch(text: string, pattern: string): number[] {
        if (!text || !pattern || pattern.length > text.length) return [];
        const lps = this.buildKmpLps(pattern);
        const matches: number[] = [];
        let i = 0;
        let j = 0;

        while (i < text.length) {
            if (pattern[j] === text[i]) {
                i++;
                j++;
            }
            if (j === pattern.length) {
                matches.push(i - j);
                j = lps[j - 1];
            } else if (i < text.length && pattern[j] !== text[i]) {
                if (j !== 0) {
                    j = lps[j - 1];
                } else {
                    i++;
                }
            }
        }
        return matches;
    }

    /**
     * Space-optimized Longest Common Subsequence (LCS) DP in O(N * M) time, O(M) space
     */
    static computeLcsRatio(text: string, target: string): number {
        if (!text || !target) return 0;
        const n = text.length;
        const m = target.length;
        let prev = new Array<number>(m + 1).fill(0);
        let cur = new Array<number>(m + 1).fill(0);

        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                if (text[i - 1] === target[j - 1]) {
                    cur[j] = prev[j - 1] + 1;
                } else {
                    cur[j] = Math.max(prev[j], cur[j - 1]);
                }
            }
            for (let j = 0; j <= m; j++) {
                prev[j] = cur[j];
                cur[j] = 0;
            }
        }
        return prev[m] / m;
    }

    /** (base^(k-1)) mod p, used to drop the leading character from a rolling hash. */
    private static rkHighPow(k: number): number {
        let h = 1;
        for (let i = 0; i < k - 1; i++) h = (h * this.RK_BASE) % this.RK_MOD;
        return h;
    }

    /** Hash of every length-k window of s, computed in O(n) with a rolling update. */
    static rollingWindowHashes(s: string, k: number): number[] {
        const n = s.length;
        if (k <= 0 || n < k) return [];
        const B = this.RK_BASE;
        const P = this.RK_MOD;
        const high = this.rkHighPow(k);
        const out: number[] = [];
        let h = 0;
        for (let i = 0; i < k; i++) h = (h * B + s.charCodeAt(i)) % P;
        out.push(h);
        for (let i = k; i < n; i++) {
            // remove s[i-k], shift, add s[i]; adding P keeps the value non-negative before the mod
            h = (h - ((s.charCodeAt(i - k) * high) % P) + P) % P;
            h = (h * B + s.charCodeAt(i)) % P;
            out.push(h);
        }
        return out;
    }

    /**
     * Classic Rabin-Karp search: compare the pattern hash with each rolling text-window hash and
     * verify character-by-character on a hit (so hash collisions never produce false matches).
     * Average O(N + M); worst case O(N·M) when every window collides.
     */
    static rabinKarpSearch(text: string, pattern: string): { matches: number[]; spuriousHits: number } {
        const m = pattern.length;
        if (!m || m > text.length) return { matches: [], spuriousHits: 0 };
        const target = this.rollingWindowHashes(pattern, m)[0];
        const windows = this.rollingWindowHashes(text, m);
        const matches: number[] = [];
        let spuriousHits = 0;
        windows.forEach((h, i) => {
            if (h !== target) return;
            if (text.startsWith(pattern, i)) matches.push(i);
            else spuriousHits++;
        });
        return { matches, spuriousHits };
    }

    /**
     * Counts how many of `previous` share at least one verified length-k substring with `current`.
     * Builds a hash index of current's windows, then rolls over each previous message.
     */
    static countMessagesSharingWindow(current: string, previous: string[], k: number): number {
        const curHashes = this.rollingWindowHashes(current, k);
        if (curHashes.length === 0) return 0;
        const index = new Map<number, number[]>();
        curHashes.forEach((h, i) => {
            const list = index.get(h);
            if (list) list.push(i);
            else index.set(h, [i]);
        });
        let sharing = 0;
        for (const prev of previous) {
            const prevHashes = this.rollingWindowHashes(prev, k);
            let found = false;
            for (let j = 0; j < prevHashes.length && !found; j++) {
                const positions = index.get(prevHashes[j]);
                if (!positions) continue;
                for (const i of positions) {
                    // Verification step: rule out a hash collision
                    if (current.substr(i, k) === prev.substr(j, k)) {
                        found = true;
                        break;
                    }
                }
            }
            if (found) sharing++;
        }
        return sharing;
    }

    /**
     * Full real-time message sanitization pipeline called on every send_message event
     */
    static sanitizeLiveMessage(rawContent: string, senderId?: string): PiiInspectionVerdict {
        let safeContent = rawContent;
        const blockedTypes: string[] = [];
        const kmpMatches: string[] = [];

        // 1. Standard direct regex pass
        if (/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi.test(safeContent)) {
            safeContent = safeContent.replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi, '[CENSORED EMAIL]');
            blockedTypes.push('email');
        }
        if (/(?:\+88)?01[3-9]\d{8}/g.test(safeContent)) {
            safeContent = safeContent.replace(/(?:\+88)?01[3-9]\d{8}/g, '[CENSORED PHONE]');
            blockedTypes.push('phone');
        }

        // 2. Phonetic & separator de-obfuscation ("zero one seven 12 34..." or "0 1 7 - ...")
        const lower = safeContent.toLowerCase();
        const tokens = lower.split(/[\s,.\-_:/\\|]+/);
        let digitStream = '';
        for (const tok of tokens) {
            if (WORD_DIGIT_MAP[tok] !== undefined) {
                digitStream += WORD_DIGIT_MAP[tok];
            } else {
                for (let i = 0; i < tok.length; i++) {
                    const code = tok.charCodeAt(i);
                    if (code >= 48 && code <= 57) {
                        digitStream += tok[i];
                    }
                }
            }
        }

        // KMP scan on normalized digit stream for Bangladeshi mobile operators (013..019)
        const bdOperators = ['013', '014', '015', '016', '017', '018', '019'];
        for (const op of bdOperators) {
            const hits = this.kmpSearch(digitStream, op);
            for (const idx of hits) {
                if (digitStream.length - idx >= 11) {
                    kmpMatches.push(`bd_phone_${op}`);
                    if (!blockedTypes.includes('obfuscated_phone')) {
                        blockedTypes.push('obfuscated_phone');
                        safeContent = '🛡️ [CENSORED OBFUSCATED PHONE NUMBER]';
                    }
                    break;
                }
            }
        }

        // 3. KMP + LCS scan for disguised social media handles
        const strippedAlpha = lower.replace(/[^a-z0-9]/g, '');
        const forbiddenSocials = ['facebookcom', 'fbcom', 'instagramcom', 'telegramme', 'whatsapp'];
        for (const sig of forbiddenSocials) {
            if (this.kmpSearch(strippedAlpha, sig).length > 0) {
                kmpMatches.push(sig);
                if (!blockedTypes.includes('social_link')) {
                    blockedTypes.push('social_link');
                    safeContent = '🛡️ [CENSORED SOCIAL HANDLE — COMPLETE MUTUAL HANDSHAKE FIRST]';
                }
            }
        }

        let lcsMaxSimilarity = 0;
        if (strippedAlpha.length >= 7 && strippedAlpha.length <= 45) {
            for (const target of ['instagramcom', 'facebookcom', 'whatsappme', 'telegramme']) {
                const ratio = this.computeLcsRatio(strippedAlpha, target);
                if (ratio > lcsMaxSimilarity) lcsMaxSimilarity = ratio;
            }
            if (lcsMaxSimilarity >= 0.88 && !blockedTypes.includes('social_link')) {
                blockedTypes.push('lcs_obfuscated_social');
                safeContent = '🛡️ [CENSORED DISGUISED HANDLE — COMPLETE MUTUAL HANDSHAKE FIRST]';
            }
        }

        // 4. Rabin-Karp flood check (per sender, across rooms): block when this message repeats a
        //    12-char window that also appears in FLOOD_REPEATS of the sender's last messages.
        //    Without a senderId (e.g. the admin demo) the check is skipped and no state is stored.
        let rabinKarpSpamDetected = false;
        if (senderId && strippedAlpha.length >= this.RK_WINDOW) {
            const now = Date.now();
            if (this.recentBySender.size > 5000) {
                for (const [key, list] of this.recentBySender.entries()) {
                    if (!list.length || now - list[list.length - 1].at >= this.FLOOD_WINDOW_MS) {
                        this.recentBySender.delete(key);
                    }
                }
            }
            const recent = (this.recentBySender.get(senderId) || []).filter(
                m => now - m.at < this.FLOOD_WINDOW_MS
            );
            const sharing = this.countMessagesSharingWindow(
                strippedAlpha,
                recent.map(m => m.text),
                this.RK_WINDOW
            );
            if (sharing >= this.FLOOD_REPEATS) {
                rabinKarpSpamDetected = true;
                blockedTypes.push('rabin_karp_spam');
                safeContent = '🛡️ [SPAM FLOOD BLOCKED BY RABIN-KARP FILTER]';
            }
            recent.push({ text: strippedAlpha, at: now });
            this.recentBySender.set(senderId, recent.slice(-6));
        }

        return {
            safeContent,
            wasModified: blockedTypes.length > 0,
            blockedTypes,
            kmpMatches,
            rabinKarpSpamDetected,
            lcsMaxSimilarity: Number(lcsMaxSimilarity.toFixed(3))
        };
    }
}
