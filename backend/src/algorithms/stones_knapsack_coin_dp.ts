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

export class StonesKnapsackCoinEngine {
    static solve01KnapsackPerks(perks: PerkCandidate[], walletStones: number) {
        const n = perks.length;
        const W = Math.max(0, Math.min(walletStones, 100));
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
        const sortedByDensity = [...perks].sort(
            (a, b) => b.engagement_boost / b.stone_cost - a.engagement_boost / a.stone_cost
        );
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

        return {
            walletStones: W,
            dpOptimalBoost: dp[n][W],
            dpStonesUsed: W - remW,
            dpSelectedPerks: selectedPerks.reverse(),
            greedy01Boost: greedyValue,
            greedy01StonesUsed: greedyWeight,
            greedySelectedPerks: greedySelected
        };
    }

    static solveCoinChangeMilestones(
        targetStones: number,
        denominations: number[] = [1, 2, 3, 5, 7, 10]
    ) {
        const S = Math.max(1, Math.min(targetStones, 100));
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
        const target = Math.max(0, Math.min(exactBudget, 100));
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
