/**
 * CSE246 Lab 6 & Lab 10: Anti-Evasion PII & Harassment Shield for Benchly
 * Combines:
 * 1. Knuth-Morris-Pratt (KMP O(N+M) with pi-Prefix/LPS Table)
 * 2. Rabin-Karp Polynomial Rolling Hash for Cross-Room Flood/Spam Detection
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
    private static recentRollingHashes = new Map<number, { count: number; lastSeen: number }>();

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

    /**
     * Rabin-Karp Polynomial Rolling Hash over message shingles
     */
    static computeRabinKarpFingerprint(normalized: string): number {
        const BASE = 257;
        const MOD = 1000000007;
        let h = 0;
        for (let i = 0; i < normalized.length; i++) {
            h = (h * BASE + normalized.charCodeAt(i)) % MOD;
        }
        return h;
    }

    /**
     * Full real-time message sanitization pipeline called on every send_message event
     */
    static sanitizeLiveMessage(rawContent: string): PiiInspectionVerdict {
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

        // 4. Rabin-Karp Rolling Hash Cross-Room Spam / Flood Check
        let rabinKarpSpamDetected = false;
        if (strippedAlpha.length >= 12) {
            const fp = this.computeRabinKarpFingerprint(strippedAlpha);
            const now = Date.now();
            // Bound memory usage by pruning expired hashes when map grows
            if (this.recentRollingHashes.size > 5000) {
                for (const [key, val] of this.recentRollingHashes.entries()) {
                    if (now - val.lastSeen >= 45000) {
                        this.recentRollingHashes.delete(key);
                    }
                }
                if (this.recentRollingHashes.size > 5000) {
                    this.recentRollingHashes.clear();
                }
            }
            const existing = this.recentRollingHashes.get(fp);
            if (existing && now - existing.lastSeen < 45000) {
                existing.count += 1;
                existing.lastSeen = now;
                if (existing.count >= 4) {
                    rabinKarpSpamDetected = true;
                    blockedTypes.push('rabin_karp_spam');
                    safeContent = '🛡️ [SPAM FLOOD BLOCKED BY RABIN-KARP FILTER]';
                }
            } else {
                this.recentRollingHashes.set(fp, { count: 1, lastSeen: now });
            }
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
