/**
 * CSE246 L14–L19 / Labs 7 & 9 + L22 / Lab 11: Batch 1v1 Matchmaker.
 *
 * Students who press "Find a bench" within the same batch window (~1.5 s) are matched together
 * instead of one-by-one on arrival. Matching one-by-one is greedy: the first arrival grabs the best
 * partner even if that leaves someone else with nobody. Batching lets us solve the whole pool:
 *
 *   1. Build the compatibility graph G = (V, E): an edge (u, v) exists only when each student's
 *      preference accepts the other; its weight is the symmetric compatibility score.
 *   2. Disjoint-Set Union (union by size + path compression) splits G into connected components.
 *      Components never share an edge, so each is solved independently (and most are tiny).
 *   3. Per component:
 *        size ≤ EXACT_LIMIT  -> Branch-and-Bound maximum matching (exact). Objective is
 *                               lexicographic: first the most students matched, then the highest
 *                               total compatibility (a per-pair bonus larger than any weight sum).
 *        bipartite           -> Edmonds-Karp max-flow (BFS augmenting paths, O(V·E²)) gives a
 *                               maximum-cardinality matching. Bipartiteness is tested by BFS 2-colouring.
 *        otherwise           -> Greedy heaviest-edge-first, then length-3 augmenting-path swaps
 *                               (each swap matches one more pair; result ≥ 2/3 of maximum size).
 *   4. A pure greedy baseline over the whole pool is computed too, so every tick records how much
 *      the exact/flow solution gained over greedy.
 */

import { BenchlyBacktrackingEngine } from './backtracking_solver';

export type Gender = 'male' | 'female' | string;
export type Seeking = 'male' | 'female' | 'any';

export interface BatchCandidate {
    id: string;
    gender: Gender;
    seeking: Seeking;
}

export interface MatchEdge {
    u: number;
    v: number;
    w: number;
}

export type ComponentStrategy = 'single' | 'branch-and-bound' | 'edmonds-karp' | 'greedy+augment';

export interface BatchMatchResult {
    pairs: MatchEdge[];
    matchedStudents: number;
    totalWeight: number;
    greedyMatchedStudents: number;
    greedyTotalWeight: number;
    components: Array<{ size: number; edges: number; strategy: ComponentStrategy; bipartite: boolean }>;
}

/** Largest component solved exactly. Partial matchings of K12 ≈ 1.4e5 leaves before pruning. */
export const EXACT_LIMIT = 12;

/** A student accepts a partner when their preference is "any" or matches the partner's gender. */
export function acceptsPartner(a: BatchCandidate, b: BatchCandidate): boolean {
    return a.seeking === 'any' || a.seeking === b.gender;
}

export function mutuallyCompatible(a: BatchCandidate, b: BatchCandidate): boolean {
    return a.id !== b.id && acceptsPartner(a, b) && acceptsPartner(b, a);
}

/* ------------------------------------------------------------------ */
/* Disjoint-Set Union                                                  */
/* ------------------------------------------------------------------ */

export class DisjointSetUnion {
    private parent: number[];
    private size: number[];

    constructor(n: number) {
        this.parent = Array.from({ length: n }, (_, i) => i);
        this.size = new Array<number>(n).fill(1);
    }

    find(x: number): number {
        let root = x;
        while (this.parent[root] !== root) root = this.parent[root];
        // Path compression
        while (this.parent[x] !== root) {
            const next = this.parent[x];
            this.parent[x] = root;
            x = next;
        }
        return root;
    }

    union(a: number, b: number): boolean {
        let ra = this.find(a);
        let rb = this.find(b);
        if (ra === rb) return false;
        // Union by size
        if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
        this.parent[rb] = ra;
        this.size[ra] += this.size[rb];
        return true;
    }
}

/* ------------------------------------------------------------------ */
/* Bipartite test (BFS 2-colouring)                                    */
/* ------------------------------------------------------------------ */

/** Returns side[] (0/1 per vertex) when the graph is bipartite, otherwise null. O(V + E). */
export function bipartition(n: number, adj: number[][]): number[] | null {
    const side = new Array<number>(n).fill(-1);
    for (let s = 0; s < n; s++) {
        if (side[s] !== -1) continue;
        side[s] = 0;
        const queue = [s];
        for (let head = 0; head < queue.length; head++) {
            const u = queue[head];
            for (const v of adj[u]) {
                if (side[v] === -1) {
                    side[v] = 1 - side[u];
                    queue.push(v);
                } else if (side[v] === side[u]) {
                    return null; // odd cycle
                }
            }
        }
    }
    return side;
}

/* ------------------------------------------------------------------ */
/* Edmonds-Karp maximum bipartite matching                             */
/* ------------------------------------------------------------------ */

interface FlowEdge {
    to: number;
    cap: number;
    rev: number; // index of reverse edge in graph[to]
}

/**
 * Maximum-cardinality matching on a bipartite graph via Edmonds-Karp (BFS shortest augmenting
 * paths on the residual network s -> left -> right -> t, all capacities 1). O(V · E²).
 * Neighbours are explored heaviest-edge-first, so among equally short augmenting paths the BFS
 * prefers higher compatibility; the guarantee is maximum cardinality, not maximum weight.
 */
export function edmondsKarpBipartiteMatching(
    n: number,
    edges: MatchEdge[],
    side: number[]
): { pairs: MatchEdge[]; augmentingPaths: number } {
    const source = n;
    const sink = n + 1;
    const graph: FlowEdge[][] = Array.from({ length: n + 2 }, () => []);
    const addEdge = (from: number, to: number, cap: number) => {
        graph[from].push({ to, cap, rev: graph[to].length });
        graph[to].push({ to: from, cap: 0, rev: graph[from].length - 1 });
    };

    const weightOf = new Map<string, number>();
    const sorted = [...edges].sort((a, b) => b.w - a.w);
    for (let i = 0; i < n; i++) {
        if (side[i] === 0) addEdge(source, i, 1);
        else addEdge(i, sink, 1);
    }
    for (const e of sorted) {
        const [l, r] = side[e.u] === 0 ? [e.u, e.v] : [e.v, e.u];
        addEdge(l, r, 1);
        weightOf.set(`${l}:${r}`, e.w);
    }

    let augmentingPaths = 0;
    while (true) {
        const prevNode = new Array<number>(n + 2).fill(-1);
        const prevEdge = new Array<number>(n + 2).fill(-1);
        prevNode[source] = source;
        const queue = [source];
        for (let head = 0; head < queue.length && prevNode[sink] === -1; head++) {
            const u = queue[head];
            graph[u].forEach((e, idx) => {
                if (e.cap > 0 && prevNode[e.to] === -1) {
                    prevNode[e.to] = u;
                    prevEdge[e.to] = idx;
                    queue.push(e.to);
                }
            });
        }
        if (prevNode[sink] === -1) break;

        // Unit capacities: bottleneck is always 1
        for (let v = sink; v !== source; v = prevNode[v]) {
            const e = graph[prevNode[v]][prevEdge[v]];
            e.cap -= 1;
            graph[v][e.rev].cap += 1;
        }
        augmentingPaths++;
    }

    const pairs: MatchEdge[] = [];
    for (let l = 0; l < n; l++) {
        if (side[l] !== 0) continue;
        for (const e of graph[l]) {
            // A saturated left->right edge carries flow
            if (e.to < n && side[e.to] === 1 && e.cap === 0) {
                const w = weightOf.get(`${l}:${e.to}`);
                if (w !== undefined) pairs.push({ u: l, v: e.to, w });
            }
        }
    }
    return { pairs, augmentingPaths };
}

/* ------------------------------------------------------------------ */
/* Greedy baseline                                                     */
/* ------------------------------------------------------------------ */

export function greedyMatching(n: number, edges: MatchEdge[]): MatchEdge[] {
    const used = new Array<boolean>(n).fill(false);
    const pairs: MatchEdge[] = [];
    for (const e of [...edges].sort((a, b) => b.w - a.w)) {
        if (!used[e.u] && !used[e.v]) {
            used[e.u] = used[e.v] = true;
            pairs.push(e);
        }
    }
    return pairs;
}

/**
 * Greedy, then repeatedly apply length-3 augmenting paths x–a=b–y (x, y unmatched; a=b matched):
 * replace pair (a, b) with (x, a) and (b, y), gaining one pair each time. Once no such path is
 * left, the matching is at least 2/3 of the maximum size (Hopcroft–Karp's short-path lemma).
 * Used for large components that are not bipartite, where Edmonds-Karp does not apply.
 */
export function greedyWithAugmentation(n: number, edges: MatchEdge[]): MatchEdge[] {
    const mate = new Array<number>(n).fill(-1);
    const weight = new Map<string, number>();
    const key = (u: number, v: number) => (u < v ? `${u}:${v}` : `${v}:${u}`);
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const e of edges) {
        weight.set(key(e.u, e.v), e.w);
        adj[e.u].push(e.v);
        adj[e.v].push(e.u);
    }
    // Heavier neighbours first, so augmentations keep compatibility high where they can
    adj.forEach((list, u) => list.sort((x, y) => (weight.get(key(u, y)) || 0) - (weight.get(key(u, x)) || 0)));

    for (const e of greedyMatching(n, edges)) {
        mate[e.u] = e.v;
        mate[e.v] = e.u;
    }

    let improved = true;
    while (improved) {
        improved = false;
        for (let a = 0; a < n && !improved; a++) {
            const b = mate[a];
            if (b === -1) continue;
            // x: unmatched neighbour of a; y: unmatched neighbour of b, y != x
            for (const x of adj[a]) {
                if (mate[x] !== -1 || x === b) continue;
                const y = adj[b].find(c => mate[c] === -1 && c !== x && c !== a);
                if (y === undefined) continue;
                mate[x] = a;
                mate[a] = x;
                mate[b] = y;
                mate[y] = b;
                improved = true;
                break;
            }
        }
    }

    const pairs: MatchEdge[] = [];
    for (let u = 0; u < n; u++) {
        if (mate[u] > u) pairs.push({ u, v: mate[u], w: weight.get(key(u, mate[u]))! });
    }
    return pairs;
}

/* ------------------------------------------------------------------ */
/* Exact Branch-and-Bound (lexicographic: cardinality, then weight)    */
/* ------------------------------------------------------------------ */

export function exactMaxMatching(n: number, edges: MatchEdge[]): MatchEdge[] {
    if (n > EXACT_LIMIT) throw new Error(`exactMaxMatching supports at most ${EXACT_LIMIT} vertices`);
    // Bonus > any achievable weight sum, so one extra pair always beats any weight gain.
    const bonus = edges.reduce((s, e) => s + e.w, 0) + 1;
    const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const original = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const e of edges) {
        matrix[e.u][e.v] = matrix[e.v][e.u] = e.w + bonus;
        original[e.u][e.v] = original[e.v][e.u] = e.w;
    }
    const res = BenchlyBacktrackingEngine.solveMaxMatchBatchBacktrack(n, matrix);
    return res.pairs.map(([u, v]) => ({ u, v, w: original[u][v] }));
}

/* ------------------------------------------------------------------ */
/* Full batch solver                                                   */
/* ------------------------------------------------------------------ */

export function solveBatchMatching(n: number, edges: MatchEdge[]): BatchMatchResult {
    const dsu = new DisjointSetUnion(n);
    for (const e of edges) dsu.union(e.u, e.v);

    const compVertices = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const r = dsu.find(i);
        if (!compVertices.has(r)) compVertices.set(r, []);
        compVertices.get(r)!.push(i);
    }
    const compEdges = new Map<number, MatchEdge[]>();
    for (const e of edges) {
        const r = dsu.find(e.u);
        if (!compEdges.has(r)) compEdges.set(r, []);
        compEdges.get(r)!.push(e);
    }

    const pairs: MatchEdge[] = [];
    const components: BatchMatchResult['components'] = [];

    for (const [root, verts] of compVertices) {
        const cEdges = compEdges.get(root) || [];
        if (verts.length === 1) {
            components.push({ size: 1, edges: 0, strategy: 'single', bipartite: true });
            continue;
        }
        // Re-index to 0..k-1 for the component solvers
        const local = new Map<number, number>();
        verts.forEach((v, i) => local.set(v, i));
        const k = verts.length;
        const lEdges = cEdges.map(e => ({ u: local.get(e.u)!, v: local.get(e.v)!, w: e.w }));
        const adj: number[][] = Array.from({ length: k }, () => []);
        for (const e of lEdges) {
            adj[e.u].push(e.v);
            adj[e.v].push(e.u);
        }
        const side = bipartition(k, adj);

        let strategy: ComponentStrategy;
        let localPairs: MatchEdge[];
        if (k <= EXACT_LIMIT) {
            strategy = 'branch-and-bound';
            localPairs = exactMaxMatching(k, lEdges);
        } else if (side) {
            strategy = 'edmonds-karp';
            localPairs = edmondsKarpBipartiteMatching(k, lEdges, side).pairs;
        } else {
            strategy = 'greedy+augment';
            localPairs = greedyWithAugmentation(k, lEdges);
        }
        components.push({ size: k, edges: lEdges.length, strategy, bipartite: side !== null });
        for (const p of localPairs) pairs.push({ u: verts[p.u], v: verts[p.v], w: p.w });
    }

    const greedy = greedyMatching(n, edges);
    return {
        pairs,
        matchedStudents: pairs.length * 2,
        totalWeight: pairs.reduce((s, p) => s + p.w, 0),
        greedyMatchedStudents: greedy.length * 2,
        greedyTotalWeight: greedy.reduce((s, p) => s + p.w, 0),
        components
    };
}
