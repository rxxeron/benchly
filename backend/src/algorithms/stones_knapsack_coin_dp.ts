/**
 * CSE246 Lab 4 & Lab 5:
 * 1. 0/1 Knapsack DP vs. Fractional Knapsack (Greedy) for Campus Stones 💎 Loadout
 *    and Azure Standard_B1s (1.5 GB RAM) Redis Room Cache Eviction.
 * 2. Coin Change (Greedy vs. 1D/2D DP) for Campus Stones Milestone Planning.
 */

export interface PerkCandidate {
    id: string;
    name: string;
    category: string;
    stone_cost: number;
    engagement_boost: number;
    icon_emoji: string;
}

/**
 * Largest Stones budget/target the engines accept. Must stay >= the clamp the API routes
 * apply (routes/public.ts allows up to 200), otherwise larger wallets are silently truncated.
 */
export const MAX_STONES_BUDGET = 200;

/** Boost per Stone; free perks rank first, and 0/0 never produces NaN in the sort. */
function valueDensity(p: PerkCandidate): number {
    if (p.stone_cost <= 0) return p.engagement_boost > 0 ? Infinity : 0;
    return p.engagement_boost / p.stone_cost;
}

export class StonesKnapsackCoinEngine {
    static solve01KnapsackPerks(perks: PerkCandidate[], walletStones: number) {
        const n = perks.length;
        const W = Math.max(0, Math.min(Math.floor(walletStones), MAX_STONES_BUDGET));
        const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(W + 1).fill(0));

        for (let i = 1; i <= n; i++) {
            const p = perks[i - 1];
            for (let w = 0; w <= W; w++) {
                if (p.stone_cost <= w) {
                    dp[i][w] = Math.max(dp[i - 1][w], p.engagement_boost + dp[i - 1][w - p.stone_cost]);
                } else {
                    dp[i][w] = dp[i - 1][w];
                }
            }
        }

        const selectedPerks: PerkCandidate[] = [];
        let remW = W;
        for (let i = n; i >= 1; i--) {
            if (dp[i][remW] !== dp[i - 1][remW]) {
                selectedPerks.push(perks[i - 1]);
                remW -= perks[i - 1].stone_cost;
            }
        }

        // Greedy by density comparison
        const sortedByDensity = [...perks].sort((a, b) => {
            const da = valueDensity(a);
            const db = valueDensity(b);
            return da === db ? 0 : db > da ? 1 : -1;
        });
        let greedyWeight = 0;
        let greedyValue = 0;
        const greedySelected: PerkCandidate[] = [];

        for (const p of sortedByDensity) {
            if (greedyWeight + p.stone_cost <= W) {
                greedyWeight += p.stone_cost;
                greedyValue += p.engagement_boost;
                greedySelected.push(p);
            }
        }

        const memo = this.solve01KnapsackMemo(perks, W);
        const fractional = this.solveFractionalKnapsack(perks, W);

        return {
            walletStones: W,
            // Bottom-up tabulation fills every (item, capacity) cell...
            tableCellsComputed: n * (W + 1),
            // ...top-down memoization only visits the states reachable from (n, W).
            memoOptimalBoost: memo.bestBoost,
            memoSubproblemsSolved: memo.subproblemsSolved,
            // Fractional (greedy) knapsack is the LP relaxation: an upper bound on any 0/1 answer.
            fractionalUpperBound: fractional.upperBound,
            fractionalTakes: fractional.takes,
            dpOptimalBoost: dp[n][W],
            dpStonesUsed: W - remW,
            dpSelectedPerks: selectedPerks.reverse(),
            greedy01Boost: greedyValue,
            greedy01StonesUsed: greedyWeight,
            greedySelectedPerks: greedySelected
        };
    }

    /**
     * Top-down 0/1 knapsack: best(i, w) = best boost using perks[0..i-1] with capacity w.
     * Same recurrence as the table, but only reachable states are solved and cached.
     */
    static solve01KnapsackMemo(perks: PerkCandidate[], walletStones: number) {
        const W = Math.max(0, Math.min(Math.floor(walletStones), MAX_STONES_BUDGET));
        const memo = new Map<number, number>();
        let subproblemsSolved = 0;
        const best = (i: number, w: number): number => {
            // Only i === 0 is a base case: free (0-Stone) perks can still be taken when w === 0.
            if (i === 0) return 0;
            const key = i * (W + 1) + w;
            const cached = memo.get(key);
            if (cached !== undefined) return cached;
            const p = perks[i - 1];
            let value = best(i - 1, w);
            if (p.stone_cost <= w) value = Math.max(value, p.engagement_boost + best(i - 1, w - p.stone_cost));
            memo.set(key, value);
            subproblemsSolved++;
            return value;
        };
        return { bestBoost: best(perks.length, W), subproblemsSolved };
    }

    /**
     * Fractional knapsack (greedy by boost per Stone, O(n log n)). Perks cannot really be split,
     * so this is not a purchase plan: it is the relaxation that bounds the 0/1 optimum from above
     * (greedy 0/1 <= DP optimum <= fractional), the same bound branch-and-bound knapsack uses.
     */
    static solveFractionalKnapsack(perks: PerkCandidate[], walletStones: number) {
        let remaining = Math.max(0, Math.min(Math.floor(walletStones), MAX_STONES_BUDGET));
        let upperBound = 0;
        const takes: Array<{ id: string; fraction: number }> = [];
        const sorted = [...perks].sort((a, b) => {
            const da = valueDensity(a);
            const db = valueDensity(b);
            return da === db ? 0 : db > da ? 1 : -1;
        });
        for (const p of sorted) {
            if (p.stone_cost <= 0) {
                upperBound += Math.max(0, p.engagement_boost);
                takes.push({ id: p.id, fraction: 1 });
                continue;
            }
            if (remaining <= 0) break;
            const fraction = Math.min(1, remaining / p.stone_cost);
            upperBound += p.engagement_boost * fraction;
            remaining -= p.stone_cost * fraction;
            takes.push({ id: p.id, fraction: Number(fraction.toFixed(4)) });
        }
        return { upperBound: Number(upperBound.toFixed(2)), takes };
    }

    static solveCoinChangeMilestones(
        targetStones: number,
        denominations: number[] = [1, 2, 3, 5, 7, 10]
    ) {
        const S = Math.max(0, Math.min(Math.floor(targetStones), MAX_STONES_BUDGET));
        const coins = [...denominations].sort((a, b) => a - b);
        const INF = 999999;
        const dpMin = new Array<number>(S + 1).fill(INF);
        const parent = new Array<number>(S + 1).fill(-1);
        dpMin[0] = 0;

        for (let x = 1; x <= S; x++) {
            for (const c of coins) {
                if (c <= x && dpMin[x - c] + 1 < dpMin[x]) {
                    dpMin[x] = dpMin[x - c] + 1;
                    parent[x] = c;
                }
            }
        }

        const dpChosen: number[] = [];
        let cur = S;
        while (cur > 0 && parent[cur] !== -1) {
            dpChosen.push(parent[cur]);
            cur -= parent[cur];
        }

        // 2D Coin Change Ways DP
        const ways = new Array<number>(S + 1).fill(0);
        ways[0] = 1;
        for (const c of coins) {
            for (let x = c; x <= S; x++) {
                ways[x] += ways[x - c];
            }
        }

        // Greedy Largest-First
        const desc = [...coins].reverse();
        const greedyChosen: number[] = [];
        let rem = S;
        for (const c of desc) {
            while (rem >= c) {
                greedyChosen.push(c);
                rem -= c;
            }
        }

        const milestoneLabels: Record<number, string> = {
            1: 'Quick Campus Adda (+1 💎)',
            2: 'Daily Login Bonus (+2 💎)',
            3: '3-Day Streak Milestone (+3 💎)',
            4: 'Cross-Department Match (+4 💎)',
            5: 'Mutual Handshake Bonus (+5 💎)',
            7: '5-Person Cafeteria Lounge (+7 💎)',
            10: 'Verified EWU Referral (+10 💎)'
        };

        return {
            targetStones: S,
            denominations: coins,
            dpMinCount: dpChosen.length,
            dpChosenCoins: dpChosen,
            dpMilestonePlan: dpChosen.map(c => milestoneLabels[c] || `Campus Milestone (+${c} 💎)`),
            greedyCount: greedyChosen.length,
            greedyChosenCoins: greedyChosen,
            totalDistinctWays: ways[S],
            greedySuboptimal: greedyChosen.length > dpChosen.length
        };
    }

    /**
     * CSE246 Lecture 21 / Lab 11: Subset-Sum Backtracking with Suffix-Sum Pruning.
     * Finds the highest-boost perk bundle that spends the student's EXACT Stones wallet
     * (zero wasted Stones), pruning dead branches whenever remainingSum < remainingBudget.
     */
    static solveExactBudgetBacktracking(perks: PerkCandidate[], exactBudget: number) {
        const target = Math.max(0, Math.min(Math.floor(exactBudget), MAX_STONES_BUDGET));
        const sorted = [...perks].sort((a, b) => b.stone_cost - a.stone_cost);
        const n = sorted.length;

        // Suffix sum of remaining costs for Branch-and-Bound pruning
        const suffixCost = new Array<number>(n + 1).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            suffixCost[i] = suffixCost[i + 1] + sorted[i].stone_cost;
        }

        let bestBoost = -1;
        let bestBundle: PerkCandidate[] = [];
        let exactSolutionsFound = 0;
        let nodesExplored = 0;
        let prunedBranches = 0;
        const chosen: PerkCandidate[] = [];

        const backtrack = (idx: number, remBudget: number, curBoost: number): void => {
            nodesExplored++;
            if (remBudget === 0) {
                exactSolutionsFound++;
                if (curBoost > bestBoost) {
                    bestBoost = curBoost;
                    bestBundle = [...chosen];
                }
                return;
            }
            if (idx >= n) return;
            // Pruning: even taking all remaining perks cannot reach remBudget
            if (suffixCost[idx] < remBudget) {
                prunedBranches++;
                return;
            }

            const p = sorted[idx];
            if (p.stone_cost <= remBudget) {
                chosen.push(p);
                backtrack(idx + 1, remBudget - p.stone_cost, curBoost + p.engagement_boost);
                chosen.pop();
            }
            backtrack(idx + 1, remBudget, curBoost);
        };

        backtrack(0, target, 0);
        return {
            exactBudget: target,
            foundExactBundle: exactSolutionsFound > 0,
            exactSolutionsFound,
            bestExactBoost: Math.max(0, bestBoost),
            bestExactBundle: bestBundle,
            nodesExplored,
            prunedBranches
        };
    }
}
