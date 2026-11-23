/**
 * Empirical running-time benchmark for the CSE246 algorithms in Benchly.
 * Run: npm run bench   (writes ../docs/CSE246_BENCHMARKS.md next to the project report)
 *
 * Each row doubles the input size; the "ratio" column is time(n) / time(n/2). For O(n) expect ~2,
 * for O(n log n) slightly above 2, for O(n^2) ~4, for O(n·W) with both doubled ~4.
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { CanonicalHuffmanCodec } from '../algorithms/huffman_codec';
import { StonesKnapsackCoinEngine, PerkCandidate } from '../algorithms/stones_knapsack_coin_dp';
import { BenchlyPiiShield } from '../algorithms/pii_shield_engine';
import { lisPatience, lisQuadratic } from '../algorithms/sequence_dp';
import { MatchEdge, bipartition, edmondsKarpBipartiteMatching, exactMaxMatching } from '../algorithms/batch_matcher';

let seed = 42;
const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
};
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const text = (n: number, alpha = 'abcdefghij klmnop') => {
    let s = '';
    for (let i = 0; i < n; i++) s += alpha[randInt(0, alpha.length - 1)];
    return s;
};

/** Median of `reps` runs, in milliseconds. */
function time(fn: () => void, reps = 7): number {
    const samples: number[] = [];
    for (let r = 0; r < reps; r++) {
        const t0 = process.hrtime.bigint();
        fn();
        samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
}

interface Row {
    n: string;
    ms: number;
}
const sections: string[] = [];
function section(title: string, complexity: string, rows: Row[]) {
    const lines = [`### ${title}`, '', `Expected: ${complexity}`, '', '| Input size | Median time (ms) | Ratio vs previous |', '|---|---:|---:|'];
    rows.forEach((r, i) => {
        const ratio = i === 0 || rows[i - 1].ms === 0 ? '—' : (r.ms / rows[i - 1].ms).toFixed(2);
        lines.push(`| ${r.n} | ${r.ms.toFixed(3)} | ${ratio} |`);
    });
    sections.push(lines.join('\n'));
    console.log(`\n${title} (${complexity})`);
    rows.forEach(r => console.log(`  ${r.n.padEnd(28)} ${r.ms.toFixed(3)} ms`));
}

// Huffman: O(N + K log K)
section(
    'Canonical Huffman compress + decompress',
    'O(N + K log K), N characters, K distinct symbols',
    [5000, 10000, 20000, 40000, 80000].map(n => {
        const s = JSON.stringify([{ text: text(n) }]);
        return {
            n: `N = ${n}`,
            ms: time(() => {
                const c = CanonicalHuffmanCodec.compressTranscriptJson(s);
                CanonicalHuffmanCodec.decompressTranscriptJson(c.packedBase64, c.codeLengths, c.originalLength);
            })
        };
    })
);

// Knapsack: O(n·W)
const perks = (n: number): PerkCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        name: '',
        category: '',
        stone_cost: randInt(1, 20),
        engagement_boost: randInt(1, 100),
        icon_emoji: ''
    }));
section(
    '0/1 knapsack (tabulation)',
    'O(n·W); here n and W double together, so ~4x per row',
    [
        [25, 25],
        [50, 50],
        [100, 100],
        [200, 200]
    ].map(([n, W]) => {
        const p = perks(n);
        return { n: `n = ${n}, W = ${W}`, ms: time(() => StonesKnapsackCoinEngine.solve01KnapsackPerks(p, W)) };
    })
);

// KMP / Rabin-Karp: O(N + M)
for (const [title, fn] of [
    ['KMP search', (t: string, p: string) => BenchlyPiiShield.kmpSearch(t, p)],
    ['Rabin-Karp search', (t: string, p: string) => BenchlyPiiShield.rabinKarpSearch(t, p)]
] as const) {
    section(
        title,
        'O(N + M) (Rabin-Karp: expected)',
        [50000, 100000, 200000, 400000].map(n => {
            const t = text(n, 'ab');
            return { n: `N = ${n}, M = 12`, ms: time(() => fn(t, 'abababababab')) };
        })
    );
}

// LCS: O(N·M)
section(
    'LCS (space-optimised tabulation)',
    'O(N·M); both doubled -> ~4x',
    [250, 500, 1000, 2000].map(n => {
        const a = text(n);
        const b = text(n);
        return { n: `N = M = ${n}`, ms: time(() => BenchlyPiiShield.computeLcsRatio(a, b), 3) };
    })
);

// LIS: O(n log n) vs O(n²)
const arr = (n: number) => Array.from({ length: n }, () => randInt(0, 1e6));
section(
    'LIS patience sorting',
    'O(n log n)',
    [20000, 40000, 80000, 160000].map(n => {
        const a = arr(n);
        return { n: `n = ${n}`, ms: time(() => lisPatience(a)) };
    })
);
section(
    'LIS quadratic DP',
    'O(n²) -> ~4x',
    [1000, 2000, 4000, 8000].map(n => {
        const a = arr(n);
        return { n: `n = ${n}`, ms: time(() => lisQuadratic(a), 3) };
    })
);

// Edmonds-Karp: O(V·E²) bound, much faster on unit-capacity matching graphs
section(
    'Edmonds-Karp bipartite matching',
    'O(V·E²) worst case (unit capacities behave far better in practice)',
    [50, 100, 200, 400].map(n => {
        const edges: MatchEdge[] = [];
        for (let u = 0; u < n; u += 2) for (let v = 1; v < n; v += 2) if (rand() < 0.1) edges.push({ u, v, w: randInt(1, 100) });
        const adj: number[][] = Array.from({ length: n }, () => []);
        edges.forEach(e => {
            adj[e.u].push(e.v);
            adj[e.v].push(e.u);
        });
        const side = bipartition(n, adj)!;
        return { n: `V = ${n}, E = ${edges.length}`, ms: time(() => edmondsKarpBipartiteMatching(n, edges, side), 3) };
    })
);

// Branch-and-bound: exponential, which is why the live matcher caps components at 12
section(
    'Branch-and-bound exact matching (complete graph, worst case)',
    'exponential; capped at 12 students per component in production',
    [4, 6, 8, 10, 12].map(n => {
        const edges: MatchEdge[] = [];
        for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) edges.push({ u, v, w: randInt(1, 100) });
        return { n: `n = ${n}`, ms: time(() => exactMaxMatching(n, edges), 3) };
    })
);

const out = [
    '# Benchly CSE246 — Empirical Running Times',
    '',
    `Generated by \`npm run bench\` (backend) on Node ${process.version}, ${new Date().toISOString().slice(0, 10)}.`,
    'Median of several runs; absolute times depend on the machine, the ratios are what matter.',
    '',
    sections.join('\n\n'),
    ''
].join('\n');
const docsDir = path.resolve(__dirname, '../../../../docs');
mkdirSync(docsDir, { recursive: true });
writeFileSync(path.join(docsDir, 'CSE246_BENCHMARKS.md'), out);
console.log(`\nWrote ${path.join(docsDir, 'CSE246_BENCHMARKS.md')}`);
