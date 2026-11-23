/**
 * CSE246 L11 / Lab 6: Sequence DP — LIS and LCS, each in both styles the lab asks for.
 *
 * LIS powers the student "growth streak" (longest run of weeks, not necessarily consecutive,
 * where weekly chat counts strictly increased). LCS memoization is the top-down counterpart of
 * the space-optimised tabulation used by the PII shield.
 */

export interface LisResult {
    length: number;
    /** Indices into the input forming one longest strictly increasing subsequence. */
    indices: number[];
    values: number[];
}

/** O(n²) tabulation: dp[i] = length of the LIS ending at i. Kept for comparison with patience. */
export function lisQuadratic(a: number[]): LisResult {
    const n = a.length;
    if (n === 0) return { length: 0, indices: [], values: [] };
    const dp = new Array<number>(n).fill(1);
    const prev = new Array<number>(n).fill(-1);
    let best = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < i; j++) {
            if (a[j] < a[i] && dp[j] + 1 > dp[i]) {
                dp[i] = dp[j] + 1;
                prev[i] = j;
            }
        }
        if (dp[i] > dp[best]) best = i;
    }
    const indices: number[] = [];
    for (let k = best; k !== -1; k = prev[k]) indices.push(k);
    indices.reverse();
    return { length: dp[best], indices, values: indices.map(i => a[i]) };
}

/**
 * O(n log n) patience sorting: tails[k] holds the index of the smallest possible tail of an
 * increasing subsequence of length k+1; binary search (lower bound) finds where a[i] goes.
 */
export function lisPatience(a: number[]): LisResult {
    const n = a.length;
    const tails: number[] = [];
    const prev = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (a[tails[mid]] < a[i]) lo = mid + 1;
            else hi = mid;
        }
        if (lo > 0) prev[i] = tails[lo - 1];
        tails[lo] = i;
    }
    const indices: number[] = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k !== -1; k = prev[k]) indices.push(k);
    indices.reverse();
    return { length: tails.length, indices, values: indices.map(i => a[i]) };
}

/**
 * Top-down (memoized) LCS length. memo[i][j] = LCS of a[i..] and b[j..].
 * Iterative DFS with an explicit stack so long inputs cannot overflow the call stack.
 */
export function lcsMemo(a: string, b: string): { length: number; subproblemsSolved: number } {
    const n = a.length;
    const m = b.length;
    if (n === 0 || m === 0) return { length: 0, subproblemsSolved: 0 };
    const memo = Array.from({ length: n + 1 }, () => new Int32Array(m + 1).fill(-1));
    let solved = 0;
    const get = (i: number, j: number) => (i === n || j === m ? 0 : memo[i][j]);

    const stack: Array<[number, number]> = [[0, 0]];
    while (stack.length) {
        const [i, j] = stack[stack.length - 1];
        if (i === n || j === m || memo[i][j] !== -1) {
            stack.pop();
            continue;
        }
        if (a[i] === b[j]) {
            if (get(i + 1, j + 1) === -1) {
                stack.push([i + 1, j + 1]);
                continue;
            }
            memo[i][j] = 1 + get(i + 1, j + 1);
        } else {
            const down = get(i + 1, j);
            const right = get(i, j + 1);
            if (down === -1) {
                stack.push([i + 1, j]);
                continue;
            }
            if (right === -1) {
                stack.push([i, j + 1]);
                continue;
            }
            memo[i][j] = Math.max(down, right);
        }
        solved++;
        stack.pop();
    }
    return { length: memo[0][0], subproblemsSolved: solved };
}

/**
 * Buckets timestamps into `weeks` consecutive 7-day windows ending now (oldest first) and returns
 * the LIS of the weekly counts: the student's longest "growth streak".
 */
export function weeklyGrowthStreak(timestamps: number[], weeks = 12, now = Date.now()) {
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const start = now - weeks * WEEK;
    const counts = new Array<number>(weeks).fill(0);
    for (const t of timestamps) {
        if (t < start || t > now) continue;
        const idx = Math.min(weeks - 1, Math.floor((t - start) / WEEK));
        counts[idx]++;
    }
    // Weeks with zero chats are not "growth"; ignore them so the streak counts active weeks only.
    const activeIdx = counts.map((c, i) => (c > 0 ? i : -1)).filter(i => i >= 0);
    const lis = lisPatience(activeIdx.map(i => counts[i]));
    return {
        weeklyChats: counts,
        weekStarts: counts.map((_, i) => new Date(start + i * WEEK).toISOString().slice(0, 10)),
        streakLength: lis.length,
        streakWeeks: lis.indices.map(k => activeIdx[k])
    };
}
