import React, { useEffect, useRef, useState } from 'react';

interface AlgorithmsTabProps {
  walletStones: number;
  setWalletStones: (v: number) => void;
  targetStones: number;
  setTargetStones: (v: number) => void;
  sampleMsg: string;
  setSampleMsg: (v: string) => void;
  workflows: any;
  onRun: () => Promise<void> | void;
}

const MESSAGE_PRESETS: Array<{ label: string; text: string }> = [
  { label: 'Spelled-out phone', text: 'call me at zero one seven 8 9 1 2 3 4 5 6 later' },
  { label: 'Disguised Instagram', text: 'find me on i n s t a g r a m dot c o m' },
  { label: 'Spaced digits', text: 'my num 0 1 9 - 1 2 3 . 4 5 6 7 8' },
  { label: 'Clean message', text: 'anyone up for tea at the cafeteria after class?' }
];

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function AlgoCard({
  title,
  syllabus,
  complexity,
  where,
  wide,
  children
}: {
  title: string;
  syllabus: string;
  complexity: string;
  where: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`card algo-card ${wide ? 'span-2' : ''}`}>
      <header className="algo-head">
        <h3>{title}</h3>
        <div className="algo-tags">
          <span className="chip syllabus">{syllabus}</span>
          <span className="chip complexity">{complexity}</span>
        </div>
      </header>
      <p className="algo-where">{where}</p>
      {children}
    </section>
  );
}

function CompareBars({ rows, max }: { rows: Array<{ label: string; value: number; tone: string; note?: string }>; max: number }) {
  const scale = max > 0 ? max : 1;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div className="bar-label">{r.label}</div>
          <div className="bar-track">
            <div className={`bar-fill ${r.tone}`} style={{ width: `${Math.max(2, (r.value / scale) * 100)}%` }} />
          </div>
          <div className="bar-value mono">
            {Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}
            {r.note ? <span className="bar-note"> {r.note}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="metric" title={hint}>
      <div className="stat-label">{label}</div>
      <div className="metric-val">{value}</div>
    </div>
  );
}

/** Four students on a line; solver pairs drawn solid green, greedy pairs dashed amber. */
function MatchingDiagram({ demo }: { demo: any }) {
  const names: string[] = demo?.students || [];
  const x = (i: number) => 60 + i * 150;
  const idx = (n: string) => names.indexOf(n);
  const isPair = (pairs: any[], a: string, b: string) =>
    pairs.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  return (
    <svg viewBox="0 0 570 130" className="match-svg" role="img" aria-label="Batch matching example">
      {(demo?.edges || []).map((e: any) => {
        const solver = isPair(demo.solverPairs, e.a, e.b);
        const greedy = isPair(demo.greedyPairs, e.a, e.b);
        const x1 = x(idx(e.a));
        const x2 = x(idx(e.b));
        return (
          <g key={`${e.a}-${e.b}`}>
            <line x1={x1} y1={60} x2={x2} y2={60} className={`edge ${solver ? 'solver' : ''} ${greedy ? 'greedy' : ''}`} />
            <text x={(x1 + x2) / 2} y={greedy && !solver ? 44 : 48} textAnchor="middle" className="edge-w">
              w={e.w}
              {greedy && !solver ? ' (greedy)' : ''}
            </text>
          </g>
        );
      })}
      {names.map((n, i) => (
        <g key={n}>
          <circle cx={x(i)} cy={60} r={16} className="node" />
          <text x={x(i)} y={64} textAnchor="middle" className="node-letter">
            {n[0]}
          </text>
          <text x={x(i)} y={100} textAnchor="middle" className="node-name">
            {n}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export function AlgorithmsTab({
  walletStones,
  setWalletStones,
  targetStones,
  setTargetStones,
  sampleMsg,
  setSampleMsg,
  workflows,
  onRun
}: AlgorithmsTabProps) {
  const [running, setRunning] = useState(false);
  const firstRender = useRef(true);

  const run = async () => {
    setRunning(true);
    try {
      await onRun();
    } finally {
      setRunning(false);
    }
  };

  // Sliders re-run automatically (debounced) so the comparison updates as you drag.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(run, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletStones, targetStones]);

  const k = workflows?.knapsack;
  const c = workflows?.coinChange;
  const ss = workflows?.subsetSumBacktrack;
  const col = workflows?.loungeColoringBacktrack;
  const bm = workflows?.batchMatching;
  const pii = workflows?.piiShield;

  const lounges: Record<number, string[]> = {};
  Object.entries(col?.assignment || {}).forEach(([id, l]) => {
    (lounges[l as number] ||= []).push(String(id).replace('Student_', ''));
  });

  return (
    <div className="algo-page">
      <div className="card controls">
        <div className="controls-head">
          <div>
            <h3 style={{ marginBottom: 4 }}>Try the algorithms on live inputs</h3>
            <p className="algo-where" style={{ margin: 0 }}>
              Every panel below runs the same backend code students hit in production. Sliders re-run automatically.
            </p>
          </div>
          <span className={`run-state ${running ? 'busy' : ''}`} aria-live="polite">
            {running ? 'Running…' : workflows ? 'Up to date' : 'Not run yet'}
          </span>
        </div>

        <div className="controls-grid">
          <label className="control">
            <span className="stat-label">Stones wallet W</span>
            <div className="slider-row">
              <input type="range" min={0} max={200} value={walletStones} onChange={(e) => setWalletStones(Number(e.target.value))} />
              <span className="mono slider-val">{walletStones} 💎</span>
            </div>
          </label>
          <label className="control">
            <span className="stat-label">Coin-change target S</span>
            <div className="slider-row">
              <input type="range" min={0} max={200} value={targetStones} onChange={(e) => setTargetStones(Number(e.target.value))} />
              <span className="mono slider-val">{targetStones} 💎</span>
            </div>
            <div className="preset-row">
              {[6, 9, 12].map((v) => (
                <button key={v} type="button" className={`chip-btn ${targetStones === v ? 'on' : ''}`} onClick={() => setTargetStones(v)}>
                  S={v}
                  {v !== 6 ? ' · greedy fails' : ' · greedy ok'}
                </button>
              ))}
            </div>
          </label>
          <div className="control span-2">
            <span className="stat-label">PII shield test message</span>
            <form
              className="msg-row"
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
            >
              <input className="input" value={sampleMsg} onChange={(e) => setSampleMsg(e.target.value)} aria-label="Test message" />
              <button className="btn primary" type="submit" disabled={running}>
                {running ? 'Running…' : 'Run'}
              </button>
            </form>
            <div className="preset-row">
              {MESSAGE_PRESETS.map((p) => (
                <button key={p.label} type="button" className={`chip-btn ${sampleMsg === p.text ? 'on' : ''}`} onClick={() => setSampleMsg(p.text)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!workflows ? (
        <div className="card empty-state">Run the workflows to see results.</div>
      ) : (
        <div className={`algo-grid ${running ? 'is-stale' : ''}`}>
          {/* ---------------- Batch matcher ---------------- */}
          <AlgoCard
            wide
            title="Batch 1v1 matchmaker"
            syllabus="L14–L19 · L22 · Labs 7, 9, 11"
            complexity="DSU α(n) · B&B exp (≤12) · Edmonds-Karp O(V·E²)"
            where={`Students who search within the same ${(bm?.windowMs ?? 1500) / 1000}s window are matched together. DSU splits the compatibility graph into components; small ones are solved exactly by branch-and-bound (most students matched, then highest compatibility), large two-sided ones by Edmonds-Karp, the rest greedily.`}
          >
            <div className="batch-layout">
              <div>
                <div className="stat-label" style={{ marginBottom: 6 }}>Why not greedy? (worked example)</div>
                <MatchingDiagram demo={bm?.demo} />
                <div className="legend">
                  <span><i className="sw solver" /> Solver: {bm?.demo?.solverPairs?.length * 2} students matched</span>
                  <span><i className="sw greedy" /> Greedy: {bm?.demo?.greedyPairs?.length * 2} matched (grabs w=100 first)</span>
                </div>
              </div>
              <div>
                <div className="stat-label" style={{ marginBottom: 6 }}>Live production ticks (last {bm?.live?.tickCount ?? 0} with ≥2 waiting)</div>
                {bm?.live?.tickCount ? (
                  <>
                    <div className="metrics">
                      <Metric label="Students in pool" value={bm.live.studentsSeen} />
                      <Metric label="Matched by solver" value={bm.live.solverMatched} />
                      <Metric label="Greedy would match" value={bm.live.greedyMatched} />
                      <Metric
                        label="Extra matched"
                        value={<span className={bm.live.solverMatched > bm.live.greedyMatched ? 'good' : ''}>+{bm.live.solverMatched - bm.live.greedyMatched}</span>}
                      />
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Pool</th>
                            <th>Matched</th>
                            <th>Greedy</th>
                            <th>Strategies</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bm.live.ticks.map((t: any) => (
                            <tr key={t.at}>
                              <td className="mono">{new Date(t.at).toLocaleTimeString()}</td>
                              <td>{t.poolSize}</td>
                              <td>{t.solverMatchedStudents}</td>
                              <td>{t.greedyMatchedStudents}</td>
                              <td>
                                {Array.from(new Set((t.components || []).filter((x: any) => x.size > 1).map((x: any) => x.strategy))).join(', ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="empty-inline">No batch has had two or more students waiting yet. Stats appear here once the queue gets busy.</div>
                )}
              </div>
            </div>
          </AlgoCard>

          {/* ---------------- Knapsack ---------------- */}
          <AlgoCard
            title="Stones loadout: 0/1 knapsack"
            syllabus="L8 · L10 · Lab 5"
            complexity="DP O(n·W) · fractional O(n log n)"
            where="Recommends the perk bundle with the most engagement boost a student can afford with their real Stones balance."
          >
            <CompareBars
              max={Math.max(k?.fractionalUpperBound || 0, k?.dpOptimalBoost || 0)}
              rows={[
                { label: 'Greedy 0/1', value: k?.greedy01Boost || 0, tone: 'amber' },
                { label: 'DP optimum', value: k?.dpOptimalBoost || 0, tone: 'emerald' },
                { label: 'Fractional bound', value: k?.fractionalUpperBound || 0, tone: 'sky', note: 'upper bound' }
              ]}
            />
            <div className="metrics">
              <Metric label="Table cells" value={k?.tableCellsComputed} hint="Bottom-up fills every (item, capacity) cell" />
              <Metric label="Memo subproblems" value={k?.memoSubproblemsSolved} hint="Top-down only solves reachable states" />
              <Metric label="Memo = table?" value={k?.memoOptimalBoost === k?.dpOptimalBoost ? '✓ same' : '✗ differ'} />
            </div>
            <div className="chips-line">
              <span className="stat-label">DP bundle</span>
              {(k?.dpSelectedPerks || []).length ? (
                k.dpSelectedPerks.map((p: any) => (
                  <span key={p.id} className="chip">
                    {p.icon_emoji} {p.name} · {p.stone_cost}💎
                  </span>
                ))
              ) : (
                <span className="muted">Nothing affordable</span>
              )}
            </div>
          </AlgoCard>

          {/* ---------------- Coin change ---------------- */}
          <AlgoCard
            title="Milestone plan: coin change"
            syllabus="L8 · L11 · Lab 5"
            complexity="DP O(|C|·S)"
            where="Fewest milestones (worth 1, 3, 4, 5, 7, 10 Stones) to reach a Stones goal. These denominations are non-canonical, so greedy can lose."
          >
            <CompareBars
              max={Math.max(c?.greedyCount || 0, c?.dpMinCount || 0)}
              rows={[
                { label: 'Greedy (largest first)', value: c?.greedyCount || 0, tone: c?.greedySuboptimal ? 'rose' : 'amber', note: c?.greedyChosenCoins?.join('+') },
                { label: 'DP minimum', value: c?.dpMinCount || 0, tone: 'emerald', note: c?.dpChosenCoins?.join('+') }
              ]}
            />
            <div className={`callout ${c?.greedySuboptimal ? 'warn' : 'ok'}`}>
              {c?.greedySuboptimal
                ? `Greedy needs ${c.greedyCount} milestones; DP needs only ${c.dpMinCount}.`
                : `Greedy happens to be optimal for S=${c?.targetStones}. Try S=9 or S=12.`}{' '}
              {c?.totalDistinctWays?.toLocaleString()} distinct ways to reach the target.
            </div>
          </AlgoCard>

          {/* ---------------- Backtracking ---------------- */}
          <AlgoCard
            title="Backtracking & branch-and-bound"
            syllabus="L21–L22 · Lab 11"
            complexity="exponential, pruned"
            where="Exact-budget perk bundles (subset sum) and conflict-free group lounges (graph colouring, used when a student joins a lounge)."
          >
            <div className="metrics">
              <Metric label="Exact bundles" value={ss?.exactSolutionsFound} />
              <Metric label="Nodes explored" value={ss?.nodesExplored} />
              <Metric label="Branches pruned" value={ss?.prunedBranches} />
            </div>
            <div className="chips-line">
              <span className="stat-label">Spend exactly {ss?.exactBudget}💎</span>
              {(ss?.bestExactBundle || []).length ? (
                ss.bestExactBundle.map((p: any) => (
                  <span key={p.id} className="chip">
                    {p.icon_emoji} {p.name} · {p.stone_cost}💎
                  </span>
                ))
              ) : (
                <span className="muted">No exact combination</span>
              )}
            </div>
            <div className="stat-label" style={{ marginTop: 12 }}>Lounge colouring (A, B, C all clash)</div>
            <div className="lounges">
              {Object.entries(lounges).map(([l, members]) => (
                <div key={l} className="lounge">
                  <div className="lounge-name">Lounge {Number(l) + 1}</div>
                  <div>{members.join(' · ')}</div>
                </div>
              ))}
            </div>
          </AlgoCard>

          {/* ---------------- PII shield ---------------- */}
          <AlgoCard
            title="PII shield: string matching"
            syllabus="L11 · L23 · Labs 6, 10"
            complexity="KMP O(N+M) · RK O(N+M) avg · LCS O(N·M)"
            where="Runs on every message before both students agree to reveal contacts. Catches spelled-out phone numbers and disguised social handles."
          >
            <div className={`verdict ${pii?.verdict?.wasModified ? 'blocked' : 'clean'}`}>
              <strong>{pii?.verdict?.wasModified ? 'Blocked' : 'Clean'}</strong>
              <span className="mono">{pii?.verdict?.safeContent}</span>
            </div>
            {(pii?.verdict?.blockedTypes || []).length > 0 && (
              <div className="chips-line">
                <span className="stat-label">Caught by</span>
                {pii.verdict.blockedTypes.map((b: string) => (
                  <span key={b} className="chip rose">{b}</span>
                ))}
              </div>
            )}
            <div className="stat-label" style={{ marginTop: 12 }}>KMP failure function for “{pii?.kmpLpsSample?.pattern}”</div>
            <div className="lps">
              {Array.from(pii?.kmpLpsSample?.pattern || '').map((ch: any, i: number) => (
                <div key={i} className="lps-cell">
                  <div className="lps-ch">{ch}</div>
                  <div className="lps-v">{pii.kmpLpsSample.lpsTable[i]}</div>
                </div>
              ))}
            </div>
            <div className="metrics" style={{ marginTop: 12 }}>
              <Metric label={`LCS vs “${pii?.lcs?.target}”`} value={`${pii?.lcs?.length}/${pii?.lcs?.target?.length}`} />
              <Metric label="Memo subproblems" value={pii?.lcs?.memoSubproblems} />
              <Metric label="Table cells" value={pii?.lcs?.tableCells} />
            </div>
            <details className="rk">
              <summary>Rabin-Karp rolling hashes (window = {pii?.rabinKarp?.window})</summary>
              <p className="algo-where">
                In chat, each message's {pii?.rabinKarp?.window}-character windows are compared with the same sender's last messages; a hash hit is verified
                character by character. Three repeats within 45s blocks the message as a flood. (The demo here never blocks, since it has no sender.)
              </p>
              <div className="mono small">
                {(pii?.rabinKarp?.windowHashes || []).map((h: number, i: number) => (
                  <div key={i}>
                    “{pii.rabinKarp.normalized.substr(i, pii.rabinKarp.window)}” → {h}
                  </div>
                ))}
                {!(pii?.rabinKarp?.windowHashes || []).length && <div>Message too short for a window.</div>}
              </div>
            </details>
          </AlgoCard>
        </div>
      )}
    </div>
  );
}
