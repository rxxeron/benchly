import React from 'react';

interface AlgorithmsTabProps {
  walletStones: number;
  setWalletStones: (v: number) => void;
  targetStones: number;
  setTargetStones: (v: number) => void;
  sampleMsg: string;
  setSampleMsg: (v: string) => void;
  workflows: any;
  onRun: () => void;
}

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
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <h3>Live Workflow Controls</h3>
        <div className="grid-4" style={{ marginBottom: 12 }}>
          <div>
            <div className="stat-label">Knapsack / Subset-Sum Wallet (W={walletStones})</div>
            <input type="range" min={2} max={30} value={walletStones} onChange={(e) => setWalletStones(Number(e.target.value))} style={{ width: '100%', marginTop: 8 }} />
          </div>
          <div>
            <div className="stat-label">Coin Change Target (S={targetStones})</div>
            <input type="range" min={1} max={30} value={targetStones} onChange={(e) => setTargetStones(Number(e.target.value))} style={{ width: '100%', marginTop: 8 }} />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="stat-label">PII Shield Test Message (KMP + LCS + Rabin-Karp)</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input className="input" value={sampleMsg} onChange={(e) => setSampleMsg(e.target.value)} />
              <button className="btn primary" onClick={onRun}>Run Live</button>
            </div>
          </div>
        </div>
      </div>

      {workflows && (
        <div className="grid-2">
          <div className="card">
            <h3>0/1 Knapsack DP vs. Greedy (Wallet = {workflows.knapsack?.walletStones} 💎)</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span className="badge emerald">DP Boost: {workflows.knapsack?.dpOptimalBoost}</span>
              <span className="badge amber">Greedy Boost: {workflows.knapsack?.greedy01Boost}</span>
              {workflows.knapsack?.dpOptimalBoost > workflows.knapsack?.greedy01Boost && (
                <span className="badge sky">DP Wins +{workflows.knapsack.dpOptimalBoost - workflows.knapsack.greedy01Boost}</span>
              )}
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>DP Optimal Bundle:</strong>{' '}
              {(workflows.knapsack?.dpSelectedPerks || []).map((p: any) => `${p.name} (${p.stone_cost})`).join(' + ') || 'None'}
            </div>
            <div style={{ fontSize: 13, color: '#575049' }}>
              <strong>Greedy Baseline:</strong>{' '}
              {(workflows.knapsack?.greedySelectedPerks || []).map((p: any) => `${p.name} (${p.stone_cost})`).join(' + ') || 'None'}
            </div>
          </div>

          <div className="card">
            <h3>Coin Change DP vs. Greedy (Target = {workflows.coinChange?.targetStones} 💎)</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="badge emerald">DP: {workflows.coinChange?.dpMinCount} milestones</span>
              <span className={`badge ${workflows.coinChange?.greedySuboptimal ? 'rose' : 'amber'}`}>
                Greedy: {workflows.coinChange?.greedyCount} {workflows.coinChange?.greedySuboptimal ? '(Suboptimal!)' : ''}
              </span>
              <span className="badge sky">Distinct Ways: {workflows.coinChange?.totalDistinctWays}</span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>Optimal Quest Plan:</strong>
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {(workflows.coinChange?.dpMilestonePlan || []).map((step: string, i: number) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card">
            <h3>Backtracking &amp; Branch-and-Bound Workflows</h3>
            <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
              <div>
                <span className="badge emerald">Subset-Sum Exact Budget ({walletStones} 💎)</span>
                <div style={{ marginTop: 4 }}>
                  Found <strong>{workflows.subsetSumBacktrack?.exactSolutionsFound}</strong> exact bundles (pruned{' '}
                  <span className="mono">{workflows.subsetSumBacktrack?.prunedBranches}</span> branches). Best:{' '}
                  {(workflows.subsetSumBacktrack?.bestExactBundle || []).map((p: any) => `${p.name} (${p.stone_cost})`).join(' + ') || 'None'}
                </div>
              </div>
              <div>
                <span className="badge sky">Graph Coloring (5-Person Conflict-Free Lounges)</span>
                <div className="mono" style={{ marginTop: 4, fontSize: 12, color: '#575049' }}>
                  Lounges Used: {workflows.loungeColoringBacktrack?.loungesUsed} | Assignment:{' '}
                  {JSON.stringify(workflows.loungeColoringBacktrack?.assignment)}
                </div>
              </div>
              <div>
                <span className="badge amber">Branch-and-Bound Anti-Deadlock 1v1 Matching</span>
                <div className="mono" style={{ marginTop: 4, fontSize: 12, color: '#575049' }}>
                  Total Weight: {workflows.batchMatchingBacktrack?.totalWeight} (vs Greedy 100) | Pruned:{' '}
                  {workflows.batchMatchingBacktrack?.prunedBranches}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>PII Shield (KMP π-LPS + LCS DP + Rabin-Karp)</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${workflows.piiShield?.verdict?.wasModified ? 'rose' : 'emerald'}`}>
                {workflows.piiShield?.verdict?.wasModified ? 'BLOCKED' : 'CLEAN'}
              </span>
              <span className="badge sky">LCS Similarity: {workflows.piiShield?.verdict?.lcsMaxSimilarity}</span>
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <strong>Sanitized Output:</strong> <span className="mono">{workflows.piiShield?.verdict?.safeContent}</span>
            </div>
            <div className="mono" style={{ fontSize: 12, color: '#575049' }}>
              KMP Matches: {JSON.stringify(workflows.piiShield?.verdict?.kmpMatches)}
              <br />
              KMP π-LPS ("{workflows.piiShield?.kmpLpsSample?.pattern}"): {JSON.stringify(workflows.piiShield?.kmpLpsSample?.lpsTable)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
