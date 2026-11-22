import React from 'react';
import { formatDuration } from '../../utils/format';

export function OverviewTab({ overview }: { overview: any }) {
  if (!overview) return null;
  return (
    <>
      <div className="grid-4">
        <div className="card">
          <div className="stat-label">Online Students</div>
          <div className="stat-val" style={{ color: '#047857' }}>
            {overview.liveStats?.onlineUsers ?? 0}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Total Registered Users</div>
          <div className="stat-val">{overview.totals?.users ?? 0}</div>
        </div>
        <div className="card">
          <div className="stat-label">Web &amp; App Visits Today</div>
          <div className="stat-val" style={{ color: '#ff6b4a' }}>
            {overview.visitsToday ?? 0}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Avg Huffman Savings</div>
          <div className="stat-val" style={{ color: '#2563eb' }}>
            {overview.totals?.avgHuffmanSavingsPct ?? 0}%
          </div>
        </div>
      </div>

      <div className="grid-4">
        <div className="card">
          <div className="stat-label">Human Match Ratio</div>
          <div className="stat-val" style={{ color: '#047857' }}>
            {overview.chatQuality?.humanMatchPct ?? 0}%
          </div>
          <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
            AI Fallback: {overview.chatQuality?.aiFallbackPct ?? 0}% ({overview.chatQuality?.humanRooms ?? 0}H /{' '}
            {overview.chatQuality?.aiRooms ?? 0}AI)
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Early-Drop Rate (&lt;30s)</div>
          <div className="stat-val" style={{ color: '#e11d48' }}>
            {overview.chatQuality?.earlyDropRatePct ?? 0}%
          </div>
          <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
            Median length: {formatDuration(overview.chatQuality?.medianDurationSec ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Mutual Extension Rate</div>
          <div className="stat-val" style={{ color: '#2563eb' }}>
            {overview.chatQuality?.mutualExtensionRatePct ?? 0}%
          </div>
          <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
            Avg {overview.chatQuality?.avgMessagesPerRoom ?? 0} msgs / room
          </div>
        </div>
        <div className="card">
          <div className="stat-label">PII Shield Blocks Today</div>
          <div className="stat-val" style={{ color: '#d97706' }}>
            {overview.liveStats?.todayStats?.piiShieldBlocks ?? 0}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Today's Activity</h3>
          <table>
            <tbody>
              <tr>
                <td>Matches Created</td>
                <td className="mono">{overview.liveStats?.todayStats?.matchesCreated ?? 0}</td>
              </tr>
              <tr>
                <td>Messages Exchanged</td>
                <td className="mono">{overview.liveStats?.todayStats?.messagesExchanged ?? 0}</td>
              </tr>
              <tr>
                <td>Mutual Extensions</td>
                <td className="mono">{overview.liveStats?.todayStats?.mutualExtensions ?? 0}</td>
              </tr>
              <tr>
                <td>Reports Submitted</td>
                <td className="mono">{overview.totals?.reports ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Azure VM System Health</h3>
          <table>
            <tbody>
              <tr>
                <td>RSS Memory</td>
                <td className="mono">{overview.liveStats?.systemHealth?.rssMemoryMb ?? 0} MB</td>
              </tr>
              <tr>
                <td>Heap Used</td>
                <td className="mono">{overview.liveStats?.systemHealth?.heapUsedMb ?? 0} MB</td>
              </tr>
              <tr>
                <td>Uptime</td>
                <td className="mono">{formatDuration(overview.liveStats?.systemHealth?.uptimeSeconds ?? 0)}</td>
              </tr>
              <tr>
                <td>Node Version</td>
                <td className="mono">{overview.liveStats?.systemHealth?.nodeVersion ?? '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
