/**
 * CSE246 Lecture 21 & 22 / Lab 11: Backtracking & Branch-and-Bound Engine
 * Runs silently in the Benchly backend to solve two real production constraints:
 * 1. Graph Coloring Backtracking: Assigns waiting students into conflict-free
 *    5-person Cafeteria Group Lounges (no blocked/recent-clashed pairs share a lounge).
 * 2. Branch-and-Bound Batch 1v1 Matching: Prevents greedy pairing deadlocks when
 *    multiple compatible students wait simultaneously in Redis queues.
 */

export interface ConflictStudent {
    id: string;
    conflicts: Set<string>;
}

export interface LoungeColoringResult {
    solvable: boolean;
    loungesUsed: number;
    assignment: Record<string, number>; // studentId -> loungeIndex (0..m-1)
    nodesExplored: number;
    backtracks: number;
}

export interface BatchPairEdge {
    uIndex: number;
    vIndex: number;
    weight: number;
}

export interface BacktrackMatchingResult {
    pairs: Array<[number, number, number]>; // [uIdx, vIdx, weight]
    totalWeight: number;
    nodesExplored: number;
    prunedBranches: number;
}

export class BenchlyBacktrackingEngine {
    /**
     * Graph Coloring Backtracking (m-Coloring with capacity <= maxLoungeSize).
     * Finds a conflict-free lounge assignment where no two conflicting students
     * (blocked / reported / recent-partner) are placed in the same lounge.
     */
    static solveConflictFreeLoungeColoring(
        students: ConflictStudent[],
        maxLounges: number = 4,
        maxLoungeSize: number = 5
    ): LoungeColoringResult {
        const n = students.length;
        if (n === 0) {
            return { solvable: true, loungesUsed: 0, assignment: {}, nodesExplored: 0, backtracks: 0 };
        }

        // Most-Constrained-First (MRV) ordering: place highest-conflict students first
        const ordered = [...students].sort((a, b) => b.conflicts.size - a.conflicts.size);
        const color = new Array<number>(n).fill(-1);
        const loungeCounts = new Array<number>(maxLounges).fill(0);
        const idToIdx = new Map<string, number>();
        ordered.forEach((s, i) => idToIdx.set(s.id, i));

        let nodesExplored = 0;
        let backtracks = 0;

        const isSafe = (idx: number, loungeId: number): boolean => {
            if (loungeCounts[loungeId] >= maxLoungeSize) return false;
            const student = ordered[idx];
            for (const conflictId of student.conflicts) {
                const otherIdx = idToIdx.get(conflictId);
                if (otherIdx !== undefined && color[otherIdx] === loungeId) {
                    return false;
                }
            }
            return true;
        };

        const backtrack = (idx: number, maxUsedSoFar: number): boolean => {
            if (idx === n) return true;
            nodesExplored++;

            // Symmetry breaking: only try existing lounges or the next fresh lounge
            const limit = Math.min(maxLounges, maxUsedSoFar + 2);
            for (let c = 0; c < limit; c++) {
                if (isSafe(idx, c)) {
                    color[idx] = c;
                    loungeCounts[c]++;
                    if (backtrack(idx + 1, Math.max(maxUsedSoFar, c))) {
                        return true;
                    }
                    // Undo choice (Backtrack)
                    color[idx] = -1;
                    loungeCounts[c]--;
                    backtracks++;
                }
            }
            return false;
        };

        const solved = backtrack(0, -1);
        const assignment: Record<string, number> = {};
        let maxColor = -1;
        if (solved) {
            for (let i = 0; i < n; i++) {
                assignment[ordered[i].id] = color[i];
                if (color[i] > maxColor) maxColor = color[i];
            }
        }

        return {
            solvable: solved,
            loungesUsed: solved ? maxColor + 1 : 0,
            assignment,
            nodesExplored,
            backtracks
        };
    }

    /**
     * Backtracking + Branch-and-Bound Maximum-Weight Disjoint 1v1 Matching.
     * Prevents greedy deadlocks on small-to-medium live queue batches (n <= 14).
     */
    static solveMaxMatchBatchBacktrack(
        n: number,
        weightMatrix: number[][]
    ): BacktrackMatchingResult {
        const cappedN = Math.min(n, 14);
        const used = new Array<boolean>(cappedN).fill(false);

        // Precompute each vertex's maximum incident edge weight for Branch-and-Bound upper bound
        const maxIncident = new Array<number>(cappedN).fill(0);
        for (let i = 0; i < cappedN; i++) {
            let best = 0;
            for (let j = 0; j < cappedN; j++) {
                if (i !== j && weightMatrix[i][j] > best) {
                    best = weightMatrix[i][j];
                }
            }
            maxIncident[i] = best;
        }

        let bestWeight = 0;
        let bestPairs: Array<[number, number, number]> = [];
        let nodesExplored = 0;
        let prunedBranches = 0;
        const currentPairs: Array<[number, number, number]> = [];

        const upperBoundRemaining = (startIdx: number): number => {
            let sum = 0;
            for (let i = startIdx; i < cappedN; i++) {
                if (!used[i]) sum += maxIncident[i];
            }
            // Each matched pair (u, v) has w <= (maxIncident[u] + maxIncident[v]) / 2.
            // No floor: flooring under-estimates the bound for fractional weights and prunes optimal branches.
            return sum / 2;
        };

        const dfs = (u: number, currentWeight: number): void => {
            while (u < cappedN && used[u]) u++;
            if (u >= cappedN) {
                if (currentWeight > bestWeight) {
                    bestWeight = currentWeight;
                    bestPairs = currentPairs.map(p => [p[0], p[1], p[2]]);
                }
                return;
            }

            nodesExplored++;
            // Branch-and-Bound pruning: if optimistic upper bound cannot beat bestWeight, prune
            if (currentWeight + upperBoundRemaining(u) <= bestWeight) {
                prunedBranches++;
                return;
            }

            // Try pairing u with each valid partner v > u (highest weight first for tighter pruning)
            const candidates: Array<{ v: number; w: number }> = [];
            for (let v = u + 1; v < cappedN; v++) {
                if (!used[v] && weightMatrix[u][v] > 0) {
                    candidates.push({ v, w: weightMatrix[u][v] });
                }
            }
            candidates.sort((a, b) => b.w - a.w);

            used[u] = true;
            for (const { v, w } of candidates) {
                used[v] = true;
                currentPairs.push([u, v, w]);
                dfs(u + 1, currentWeight + w);
                currentPairs.pop();
                used[v] = false;
            }
            used[u] = false;

            // Option: leave u unmatched (necessary when odd count or to unlock better global pairs)
            dfs(u + 1, currentWeight);
        };

        dfs(0, 0);
        return {
            pairs: bestPairs,
            totalWeight: bestWeight,
            nodesExplored,
            prunedBranches
        };
    }
}
