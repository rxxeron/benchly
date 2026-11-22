import React from 'react';
import { formatDuration } from '../../utils/format';

export function SystemHealthTab({ systemHealth }: { systemHealth: any }) {
  if (!systemHealth) return null;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>4-Node EWU Ollama Cluster ({systemHealth.ollamaCluster?.modelName || 'gemma4:12b'})</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge sky">Calls: {systemHealth.ollamaCluster?.stats?.totalCalls ?? 0}</span>
            <span className="badge emerald">Avg Latency: {systemHealth.ollamaCluster?.stats?.avgLatencyMs ?? 0} ms</span>
            <span className="badge amber">Last: {systemHealth.ollamaCluster?.stats?.lastLatencyMs ?? 0} ms</span>
            <span className="badge rose">Errors: {systemHealth.ollamaCluster?.stats?.totalErrors ?? 0}</span>
          </div>
        </div>
        <div className="grid-4" style={{ marginBottom: 0 }}>
          {(systemHealth.ollamaCluster?.nodes || []).map((n: any) => (
            <div key={n.host} style={{ background: '#fffdf8', padding: 14, borderRadius: 14, border: '1.5px solid #1e1b18' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>{n.label}</strong>
                <span className={`badge ${n.online ? 'emerald' : 'rose'}`}>{n.online ? 'Online' : 'Offline'}</span>
              </div>
              <div className="mono" style={{ fontSize: 11, color: '#575049', marginBottom: 8 }}>{n.host}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="badge amber">{n.latencyMs} ms</span>
                {n.hasModel && <span className="badge emerald">gemma4 ready</span>}
                {n.isWarmHost && <span className="badge sky">★ Warm VRAM</span>}
                {n.error && <span className="badge rose">{n.error}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Azure F1 Runtime &amp; Redis Cache</h3>
          <table>
            <tbody>
              <tr>
                <td>Redis Status</td>
                <td>
                  <span className={`badge ${systemHealth.redis?.ok ? 'emerald' : 'rose'}`}>
                    {systemHealth.redis?.ok ? 'Connected' : 'Down'}
                  </span>
                </td>
              </tr>
              <tr><td>Redis Ping Latency</td><td className="mono">{systemHealth.redis?.pingMs ?? -1} ms</td></tr>
              <tr><td>Process Uptime</td><td className="mono">{formatDuration(systemHealth.server?.uptimeSeconds ?? 0)}</td></tr>
              <tr><td>RSS / Heap RAM</td><td className="mono">{systemHealth.server?.rssMemoryMb ?? 0} MB / {systemHealth.server?.heapUsedMb ?? 0} MB</td></tr>
              <tr><td>Node Version / Platform</td><td className="mono">{systemHealth.server?.nodeVersion} ({systemHealth.server?.platform})</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Supabase Free-Tier &amp; Huffman Storage Savings</h3>
          <table>
            <tbody>
              <tr><td>Registered Users Rows</td><td className="mono">{systemHealth.supabase?.counts?.users ?? 0}</td></tr>
              <tr><td>Archived Room Rows</td><td className="mono">{systemHealth.supabase?.counts?.room_conversations ?? 0}</td></tr>
              <tr><td>Chat Sessions Rows</td><td className="mono">{systemHealth.supabase?.counts?.chat_sessions ?? 0}</td></tr>
              <tr><td>Site Visitor Event Rows</td><td className="mono">{systemHealth.supabase?.counts?.site_events ?? 0}</td></tr>
              <tr>
                <td>Huffman Original → Compressed</td>
                <td className="mono">
                  {((systemHealth.supabase?.huffmanStorage?.totalOriginalBytes ?? 0) / 1024).toFixed(1)} KB →{' '}
                  {((systemHealth.supabase?.huffmanStorage?.totalCompressedBytes ?? 0) / 1024).toFixed(1)} KB
                </td>
              </tr>
              <tr>
                <td>Total Bytes Saved</td>
                <td className="mono" style={{ color: '#047857' }}>
                  {((systemHealth.supabase?.huffmanStorage?.totalBytesSaved ?? 0) / 1024).toFixed(1)} KB (
                  {systemHealth.supabase?.huffmanStorage?.avgSavingsPct ?? 0}% avg)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
