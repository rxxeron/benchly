/**
 * CSE246 algorithm verification suite (backend).
 * Every algorithm is checked against a brute-force or naive reference on random inputs.
 * Run: npm test
 */
// Force the in-memory Redis adapter for the matchmaker integration test (dotenv never overrides).
process.env.REDIS_URL = '';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { CanonicalHuffmanCodec, EncryptedHuffmanArchive } from '../algorithms/huffman_codec';
import { StonesKnapsackCoinEngine, PerkCandidate } from '../algorithms/stones_knapsack_coin_dp';
import { BenchlyPiiShield } from '../algorithms/pii_shield_engine';
import { BenchlyBacktrackingEngine } from '../algorithms/backtracking_solver';
import { lisPatience, lisQuadratic, lcsMemo, weeklyGrowthStreak } from '../algorithms/sequence_dp';
import {
    DisjointSetUnion,
    MatchEdge,
    bipartition,
    edmondsKarpBipartiteMatching,
    exactMaxMatching,
    greedyMatching,
    greedyWithAugmentation,
    solveBatchMatching
} from '../algorithms/batch_matcher';

/* ---------- helpers ---------- */
let seed = 246;
const rand = () => {
    // Deterministic LCG so failures are reproducible
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
};
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const randText = (n: number, alphabet: string) => {
    const a = Array.from(alphabet);
    let s = '';
    for (let i = 0; i < n; i++) s += a[randInt(0, a.length - 1)];
    return s;
};
const perk = (id: string, cost: number, boost: number): PerkCandidate => ({
    id,
    name: id,
    category: 'test',
    stone_cost: cost,
    engagement_boost: boost,
    icon_emoji: ''
});
/** Mimics Postgres JSONB object key order: shorter keys first, then bytewise. */
const jsonbKeyOrder = (o: Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(o).sort((a, b) => {
        const la = Buffer.byteLength(a);
        const lb = Buffer.byteLength(b);
        return la !== lb ? la - lb : Buffer.compare(Buffer.from(a), Buffer.from(b));
    })) {
        out[k] = o[k];
    }
    return out;
};
const TRICKY = 'abcXYZ019 ,."{}:\\\u0001\u0002­‍️😀👨‍👩‍👧❤️আমি';

/* ---------- Huffman (L9 / Lab 4) ---------- */
test('Huffman: lossless round trip survives JSONB key reordering', () => {
    for (let t = 0; t < 400; t++) {
        const raw = JSON.stringify([{ text: randText(randInt(1, 400), TRICKY) }]);
        const archive = CanonicalHuffmanCodec.sealEncryptedHuffmanArchive(raw, 'test-key');
        const stored = JSON.parse(JSON.stringify({ ...archive, codeLengths: jsonbKeyOrder(archive.codeLengths) }));
        assert.equal(CanonicalHuffmanCodec.openEncryptedHuffmanArchive(stored, 'test-key'), raw);
    }
});

test('Huffman: Shannon bound H <= L < H + 1 and net savings include the codebook', () => {
    const raw = JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ text: `message ${i} kemon acho bondhu` })));
    const c = CanonicalHuffmanCodec.compressTranscriptJson(raw);
    assert.ok(c.shannonVerified);
    assert.ok(c.averageCodeLength >= c.shannonEntropy - 1e-9 && c.averageCodeLength < c.shannonEntropy + 1);
    const expectedNet = ((c.originalBytes - c.compressedBytes - c.codebookBytes) / c.originalBytes) * 100;
    assert.ok(Math.abs(c.savingsPercent - expectedNet) < 0.01);
    assert.ok(c.payloadSavingsPercent > c.savingsPercent);
});

test('Huffman: short transcripts are stored raw instead of growing', () => {
    const raw = JSON.stringify([{ text: 'hi' }]);
    const archive = CanonicalHuffmanCodec.sealEncryptedHuffmanArchive(raw, 'k');
    assert.equal(archive.encoding, 'raw');
    assert.equal(archive.savingsPercent, 0);
    assert.equal(CanonicalHuffmanCodec.openEncryptedHuffmanArchive(archive, 'k'), raw);
});

test('Huffman: archives written before symbolOrder existed still decode (legacy locale order)', () => {
    for (let t = 0; t < 200; t++) {
        const raw = JSON.stringify([{ text: randText(randInt(20, 200), 'abcABC xyz019😀') }]);
        const meta = CanonicalHuffmanCodec.compressTranscriptJson(raw);
        // Re-encode exactly like the old code did: canonical codes ordered with localeCompare
        const codes = CanonicalHuffmanCodec.buildCanonicalCodes(meta.codeLengths, 'legacy-locale');
        const bits = Array.from(raw).map(ch => codes[ch]).join('');
        const packed = Buffer.alloc(Math.ceil(bits.length / 8));
        for (let i = 0; i < bits.length; i++) if (bits[i] === '1') packed[i >> 3] |= 1 << (7 - (i & 7));
        const key = createHash('sha256').update('k', 'utf8').digest();
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(packed), cipher.final()]);
        const legacy: EncryptedHuffmanArchive = {
            algorithm: 'canonical-huffman+aes-256-gcm',
            originalLength: meta.originalLength,
            originalBytes: meta.originalBytes,
            compressedBytes: meta.compressedBytes,
            savingsPercent: meta.payloadSavingsPercent,
            shannonEntropy: meta.shannonEntropy,
            averageCodeLength: meta.averageCodeLength,
            shannonVerified: meta.shannonVerified,
            distinctSymbols: meta.distinctSymbols,
            codeLengths: meta.codeLengths,
            ivBase64: iv.toString('base64'),
            authTagBase64: cipher.getAuthTag().toString('base64'),
            ciphertextBase64: ct.toString('base64')
        };
        assert.equal(CanonicalHuffmanCodec.openEncryptedHuffmanArchive(legacy, 'k'), raw);
    }
});

test('Huffman: visual tree counts emoji as whole symbols', () => {
    const text = '😀😀😀ab';
    const v = CanonicalHuffmanCodec.buildVisualHuffmanTree(
        CanonicalHuffmanCodec.compressTranscriptJson(text).codeLengths,
        text
    );
    assert.deepEqual(v.symbolFrequencies, { '😀': 3, a: 1, b: 1 });
    assert.equal(v.tree.frequency, 5);
});

test('Huffman: live wire message round-trips emojis, Bangla & single-char strings and rejects malformed packets', () => {
    for (const msg of ['💡 Hey bondhu কেমন আছো? 😀🪑', 'aaaaa', 'A', '0101010101']) {
        const packet = CanonicalHuffmanCodec.encodeLiveMessage(msg);
        assert.equal(packet.algorithm, 'canonical-huffman');
        assert.ok(packet.bitLength > 0);
        assert.equal(CanonicalHuffmanCodec.decodeLiveMessage(packet), msg);
    }
    assert.equal(CanonicalHuffmanCodec.decodeLiveMessage(CanonicalHuffmanCodec.encodeLiveMessage('')), '');
    assert.throws(() => CanonicalHuffmanCodec.decodeLiveMessage({ packedBase64: 'AA==', codeLengths: { a: 1 }, originalLength: 9999 }));
    assert.throws(() => CanonicalHuffmanCodec.decodeLiveMessage({ packedBase64: 'AA==', codeLengths: { a: 1 }, originalLength: 20 }));
});

/* ---------- Knapsack / coin change / subset sum (L8, L10, L11, L21) ---------- */
const bruteKnapsack = (perks: PerkCandidate[], W: number) => {
    let best = 0;
    for (let mask = 0; mask < 1 << perks.length; mask++) {
        let c = 0;
        let v = 0;
        perks.forEach((p, i) => {
            if (mask & (1 << i)) {
                c += p.stone_cost;
                v += p.engagement_boost;
            }
        });
        if (c <= W && v > best) best = v;
    }
    return best;
};

test('0/1 knapsack: tabulation == memoization == brute force; greedy <= DP <= fractional', () => {
    for (let t = 0; t < 300; t++) {
        const perks = Array.from({ length: randInt(0, 10) }, (_, i) => perk(`p${i}`, randInt(0, 15), randInt(0, 60)));
        const W = randInt(0, 60);
        const r = StonesKnapsackCoinEngine.solve01KnapsackPerks(perks, W);
        const brute = bruteKnapsack(perks, W);
        assert.equal(r.dpOptimalBoost, brute);
        assert.equal(r.memoOptimalBoost, brute);
        assert.ok(r.memoSubproblemsSolved <= r.tableCellsComputed);
        assert.ok(r.greedy01Boost <= r.dpOptimalBoost);
        assert.ok(r.fractionalUpperBound + 1e-6 >= r.dpOptimalBoost);
        const used = r.dpSelectedPerks.reduce((s, p) => s + p.stone_cost, 0);
        const gained = r.dpSelectedPerks.reduce((s, p) => s + p.engagement_boost, 0);
        assert.ok(used <= W);
        assert.equal(gained, brute);
    }
});

test('knapsack: wallets up to 200 Stones are honoured (no silent cap at 100)', () => {
    const r = StonesKnapsackCoinEngine.solve01KnapsackPerks([perk('big', 150, 100), perk('s', 10, 1)], 250);
    assert.equal(r.walletStones, 200);
    assert.equal(r.dpOptimalBoost, 101);
});

test('coin change: DP is minimal; greedy fails on {1,3,4,5,7,10} at 9 and 12', () => {
    const coins = [1, 3, 4, 5, 7, 10];
    // BFS reference for the minimum number of coins
    const bfsMin = (S: number) => {
        const dist = new Array<number>(S + 1).fill(-1);
        dist[0] = 0;
        const q = [0];
        for (let h = 0; h < q.length; h++) {
            for (const c of coins) {
                const nx = q[h] + c;
                if (nx <= S && dist[nx] === -1) {
                    dist[nx] = dist[q[h]] + 1;
                    q.push(nx);
                }
            }
        }
        return dist[S];
    };
    for (let S = 0; S <= 120; S++) {
        const r = StonesKnapsackCoinEngine.solveCoinChangeMilestones(S, coins);
        assert.equal(r.dpMinCount, bfsMin(S), `S=${S}`);
        assert.equal(r.dpChosenCoins.reduce((a, b) => a + b, 0), S);
    }
    assert.ok(StonesKnapsackCoinEngine.solveCoinChangeMilestones(9, coins).greedySuboptimal);
    assert.ok(StonesKnapsackCoinEngine.solveCoinChangeMilestones(12, coins).greedySuboptimal);
    assert.ok(!StonesKnapsackCoinEngine.solveCoinChangeMilestones(6, coins).greedySuboptimal);
});

test('subset-sum backtracking finds the best exact-budget bundle', () => {
    for (let t = 0; t < 200; t++) {
        const perks = Array.from({ length: randInt(1, 10) }, (_, i) => perk(`p${i}`, randInt(1, 12), randInt(0, 50)));
        const B = randInt(0, 40);
        let best = -1;
        for (let mask = 0; mask < 1 << perks.length; mask++) {
            let c = 0;
            let v = 0;
            perks.forEach((p, i) => {
                if (mask & (1 << i)) {
                    c += p.stone_cost;
                    v += p.engagement_boost;
                }
            });
            if (c === B && v > best) best = v;
        }
        const r = StonesKnapsackCoinEngine.solveExactBudgetBacktracking(perks, B);
        assert.equal(r.foundExactBundle, best >= 0);
        if (best >= 0) assert.equal(r.bestExactBoost, best);
    }
});

/* ---------- String matching (L23 / Lab 10) and sequence DP (L11 / Lab 6) ---------- */
const naiveSearch = (text: string, pattern: string) => {
    const out: number[] = [];
    if (!pattern || pattern.length > text.length) return out;
    for (let i = 0; i + pattern.length <= text.length; i++) if (text.startsWith(pattern, i)) out.push(i);
    return out;
};

test('KMP and Rabin-Karp agree with naive search', () => {
    for (let t = 0; t < 500; t++) {
        const text = randText(randInt(0, 200), 'ab');
        const pattern = randText(randInt(1, 6), 'ab');
        const expected = naiveSearch(text, pattern);
        assert.deepEqual(BenchlyPiiShield.kmpSearch(text, pattern), expected);
        assert.deepEqual(BenchlyPiiShield.rabinKarpSearch(text, pattern).matches, expected);
    }
});

test('Rabin-Karp rolling hash equals hashing each window from scratch', () => {
    const s = randText(300, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const k = 12;
    const rolling = BenchlyPiiShield.rollingWindowHashes(s, k);
    for (let i = 0; i + k <= s.length; i++) {
        assert.equal(rolling[i], BenchlyPiiShield.rollingWindowHashes(s.substr(i, k), k)[0]);
    }
});

test('Rabin-Karp flood filter is per sender and needs repeated windows', () => {
    const spam = 'join my group join my group now please';
    const v1 = [1, 2, 3].map(() => BenchlyPiiShield.sanitizeLiveMessage(spam, 'alice'));
    assert.ok(v1.every(v => !v.rabinKarpSpamDetected));
    assert.ok(BenchlyPiiShield.sanitizeLiveMessage(`hey ${spam}`, 'alice').rabinKarpSpamDetected);
    // Other students saying the same thing are not flagged for Alice's flood
    assert.ok(!BenchlyPiiShield.sanitizeLiveMessage(spam, 'bob').rabinKarpSpamDetected);
    // Without a sender (admin demo) no state is kept and nothing is flagged
    assert.ok(!BenchlyPiiShield.sanitizeLiveMessage(spam).rabinKarpSpamDetected);
});

test('LCS: tabulation == memoization == brute force', () => {
    const bruteLcs = (a: string, b: string): number => {
        if (!a || !b) return 0;
        if (a[0] === b[0]) return 1 + bruteLcs(a.slice(1), b.slice(1));
        return Math.max(bruteLcs(a.slice(1), b), bruteLcs(a, b.slice(1)));
    };
    for (let t = 0; t < 200; t++) {
        const a = randText(randInt(1, 9), 'abc');
        const b = randText(randInt(1, 9), 'abc');
        const expected = bruteLcs(a, b);
        assert.equal(lcsMemo(a, b).length, expected);
        assert.ok(Math.abs(BenchlyPiiShield.computeLcsRatio(a, b) - expected / b.length) < 1e-12);
    }
});

test('LIS: patience O(n log n) == O(n^2) DP and returns a valid subsequence', () => {
    for (let t = 0; t < 300; t++) {
        const a = Array.from({ length: randInt(0, 40) }, () => randInt(0, 20));
        const p = lisPatience(a);
        const q = lisQuadratic(a);
        assert.equal(p.length, q.length);
        for (let i = 1; i < p.indices.length; i++) {
            assert.ok(p.indices[i] > p.indices[i - 1]);
            assert.ok(a[p.indices[i]] > a[p.indices[i - 1]]);
        }
    }
    const now = Date.UTC(2026, 10, 23);
    const WEEK = 7 * 864e5;
    const ts: number[] = [];
    [1, 0, 2, 1, 3, 0, 5, 4, 0, 6, 0, 0].forEach((c, i) => {
        for (let k = 0; k < c; k++) ts.push(now - 12 * WEEK + i * WEEK + 1000);
    });
    const g = weeklyGrowthStreak(ts, 12, now);
    assert.deepEqual(g.weeklyChats, [1, 0, 2, 1, 3, 0, 5, 4, 0, 6, 0, 0]);
    assert.equal(g.streakLength, 5); // 1 < 2 < 3 < 5 < 6 (or 1 < 2 < 3 < 4 < 6)
});

/* ---------- Graph matching (L14–L19, L22) ---------- */
const bruteBestMatching = (n: number, edges: MatchEdge[]) => {
    // Lexicographic optimum: max pairs, then max weight
    let best = { pairs: 0, weight: 0 };
    const used = new Array<boolean>(n).fill(false);
    const go = (idx: number, pairs: number, weight: number) => {
        if (pairs > best.pairs || (pairs === best.pairs && weight > best.weight)) best = { pairs, weight };
        for (let e = idx; e < edges.length; e++) {
            const { u, v, w } = edges[e];
            if (used[u] || used[v]) continue;
            used[u] = used[v] = true;
            go(e + 1, pairs + 1, weight + w);
            used[u] = used[v] = false;
        }
    };
    go(0, 0, 0);
    return best;
};
const randomGraph = (n: number, p: number, bip = false) => {
    const edges: MatchEdge[] = [];
    for (let u = 0; u < n; u++) {
        for (let v = u + 1; v < n; v++) {
            if (bip && u % 2 === v % 2) continue;
            if (rand() < p) edges.push({ u, v, w: randInt(1, 100) });
        }
    }
    return edges;
};

test('branch-and-bound matching is exact (max students matched, then max compatibility)', () => {
    for (let t = 0; t < 200; t++) {
        const n = randInt(2, 9);
        const edges = randomGraph(n, rand());
        const pairs = exactMaxMatching(n, edges);
        const best = bruteBestMatching(n, edges);
        assert.equal(pairs.length, best.pairs);
        assert.equal(pairs.reduce((s, e) => s + e.w, 0), best.weight);
    }
});

test('branch-and-bound handles fractional weights (no floor in the bound)', () => {
    for (let t = 0; t < 200; t++) {
        const n = randInt(2, 8);
        const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) m[i][j] = m[j][i] = rand() * 3;
        const edges: MatchEdge[] = [];
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push({ u: i, v: j, w: m[i][j] });
        // Pure max-weight reference
        let best = 0;
        const used = new Array<boolean>(n).fill(false);
        const go = (idx: number, w: number) => {
            best = Math.max(best, w);
            for (let e = idx; e < edges.length; e++) {
                if (used[edges[e].u] || used[edges[e].v]) continue;
                used[edges[e].u] = used[edges[e].v] = true;
                go(e + 1, w + edges[e].w);
                used[edges[e].u] = used[edges[e].v] = false;
            }
        };
        go(0, 0);
        assert.ok(Math.abs(BenchlyBacktrackingEngine.solveMaxMatchBatchBacktrack(n, m).totalWeight - best) < 1e-9);
    }
});

test('Edmonds-Karp finds a maximum-cardinality bipartite matching', () => {
    for (let t = 0; t < 200; t++) {
        const n = randInt(2, 10);
        const edges = randomGraph(n, rand(), true);
        const adj: number[][] = Array.from({ length: n }, () => []);
        edges.forEach(e => {
            adj[e.u].push(e.v);
            adj[e.v].push(e.u);
        });
        const side = bipartition(n, adj);
        assert.ok(side, 'even/odd split graph must be bipartite');
        const { pairs } = edmondsKarpBipartiteMatching(n, edges, side!);
        const seen = new Set<number>();
        for (const p of pairs) {
            assert.ok(!seen.has(p.u) && !seen.has(p.v), 'matching must be disjoint');
            seen.add(p.u);
            seen.add(p.v);
        }
        assert.equal(pairs.length, bruteBestMatching(n, edges).pairs);
    }
});

test('bipartite test rejects odd cycles; DSU groups components', () => {
    assert.equal(bipartition(3, [[1, 2], [0, 2], [0, 1]]), null);
    const dsu = new DisjointSetUnion(6);
    dsu.union(0, 1);
    dsu.union(1, 2);
    dsu.union(4, 5);
    assert.equal(dsu.find(0), dsu.find(2));
    assert.notEqual(dsu.find(0), dsu.find(4));
    assert.equal(dsu.find(3), 3);
});

test('greedy + length-3 augmentation is disjoint, >= greedy, and >= 2/3 of maximum', () => {
    for (let t = 0; t < 300; t++) {
        const n = randInt(2, 10);
        const edges = randomGraph(n, rand());
        const pairs = greedyWithAugmentation(n, edges);
        const seen = new Set<number>();
        for (const p of pairs) {
            assert.ok(!seen.has(p.u) && !seen.has(p.v));
            seen.add(p.u);
            seen.add(p.v);
        }
        assert.ok(pairs.length >= greedyMatching(n, edges).length);
        assert.ok(3 * pairs.length >= 2 * bruteBestMatching(n, edges).pairs);
    }
});

test('batch solver never matches fewer students than greedy', () => {
    for (let t = 0; t < 150; t++) {
        const n = randInt(2, 30);
        const edges = randomGraph(n, rand() * 0.4, rand() < 0.5);
        const r = solveBatchMatching(n, edges);
        assert.ok(r.matchedStudents >= greedyMatching(n, edges).length * 2);
        const seen = new Set<number>();
        for (const p of r.pairs) {
            assert.ok(!seen.has(p.u) && !seen.has(p.v));
            seen.add(p.u);
            seen.add(p.v);
        }
    }
    // Classic greedy trap: path a-b-c-d where the heavy middle edge blocks two matches
    const trap: MatchEdge[] = [
        { u: 0, v: 1, w: 60 },
        { u: 1, v: 2, w: 100 },
        { u: 2, v: 3, w: 60 }
    ];
    assert.equal(greedyMatching(4, trap).length, 1);
    assert.equal(solveBatchMatching(4, trap).matchedStudents, 4);
});

test('matchmaker batch tick pairs compatible waiting students via the in-memory queue', async () => {
    const mm = await import('../matchmaker');
    const mk = (id: string, gender: string) =>
        ({ id, alias: id, dept_code: 'CSE', batch_year: '2024', gender } as any);
    await mm.enqueue1v1(mk('m1', 'male'), 'any', 'campus_adda');
    await mm.enqueue1v1(mk('f1', 'female'), 'female', 'campus_adda'); // only accepts women
    await mm.enqueue1v1(mk('f2', 'female'), 'any', 'study_buddy');
    await mm.enqueue1v1(mk('m2', 'male'), 'any', 'campus_adda');
    const report = await mm.runBatchMatchTick();
    assert.equal(report.poolSize, 4);
    assert.equal(report.pairs.length, 2);
    const pairKeys = report.pairs.map(p => [p.a.id, p.b.id].sort().join('-')).sort();
    // f1 only accepts women, so she must be with f2; the two men pair up
    assert.deepEqual(pairKeys, ['f1-f2', 'm1-m2']);
    const again = await mm.runBatchMatchTick();
    assert.equal(again.poolSize, 0);
});
