import React from 'react';
import { formatDuration } from '../../utils/format';

interface UserProfileCardProps {
  profile: any;
  onClose: () => void;
  onInspectRoom: (roomId: string) => void;
}

export function UserProfileCard({ profile, onClose, onInspectRoom }: UserProfileCardProps) {
  if (!profile) return null;
  return (
    <div className="card" style={{ borderColor: '#1e1b18' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>
            User Telemetry Profile — {profile.user?.generated_alias}{' '}
            <span className="badge sky" style={{ marginLeft: 8 }}>{profile.summary?.behaviorTag}</span>
          </h3>
          <div className="mono" style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
            {profile.user?.email} • Dept: {profile.user?.dept_code || '-'} • Sem: {profile.user?.semester_intake || '-'} • Last Login:{' '}
            {profile.user?.last_login ? new Date(profile.user.last_login).toLocaleString() : 'Never'}
          </div>
        </div>
        <button className="btn" onClick={onClose}>Close Profile</button>
      </div>

      <div className="grid-4">
        <div className="card" style={{ background: '#fff4e4' }}>
          <div className="stat-label">Total Time Stayed</div>
          <div className="stat-val" style={{ color: '#047857', fontSize: 22 }}>{formatDuration(profile.summary?.totalDurationSeconds ?? 0)}</div>
        </div>
        <div className="card" style={{ background: '#fff4e4' }}>
          <div className="stat-label">Chats / Avg Duration</div>
          <div className="stat-val" style={{ fontSize: 22 }}>
            {profile.summary?.totalChats ?? 0} • {formatDuration(profile.summary?.avgSessionSeconds ?? 0)}
          </div>
        </div>
        <div className="card" style={{ background: '#fff4e4' }}>
          <div className="stat-label">Messages (Sent / Recv)</div>
          <div className="stat-val" style={{ color: '#2563eb', fontSize: 22 }}>
            {profile.summary?.messagesSent ?? 0} / {profile.summary?.messagesReceived ?? 0}
          </div>
        </div>
        <div className="card" style={{ background: '#fff4e4' }}>
          <div className="stat-label">Unique Partners / Peak Hr</div>
          <div className="stat-val" style={{ color: '#d97706', fontSize: 22 }}>
            {profile.summary?.uniquePartners ?? 0} •{' '}
            {profile.summary?.peakHour !== null && profile.summary?.peakHour !== undefined ? `${profile.summary.peakHour}:00` : '-'}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ background: '#fffdf8' }}>
          <h3>Recent Chat Sessions ({profile.recentSessions?.length ?? 0})</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Stayed</th>
                  <th>Msgs (S/R)</th>
                  <th>When</th>
                  <th>Tree</th>
                </tr>
              </thead>
              <tbody>
                {(profile.recentSessions || []).map((s: any, idx: number) => (
                  <tr key={`${s.room_id}_${idx}`}>
                    <td className="mono">{String(s.room_id || '').slice(0, 8)}...</td>
                    <td className="mono" style={{ color: '#047857' }}>{formatDuration(s.duration_seconds)}</td>
                    <td className="mono">{s.messages_sent} / {s.messages_received}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{s.created_at ? new Date(s.created_at).toLocaleString() : '-'}</td>
                    <td>
                      <button className="btn" onClick={() => onInspectRoom(s.room_id)}>Inspect</button>
                    </td>
                  </tr>
                ))}
                {(profile.recentSessions || []).length === 0 && (
                  <tr><td colSpan={5} style={{ color: '#575049' }}>No completed chat sessions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ background: '#fffdf8' }}>
          <h3>Stones Ledger &amp; Alias History</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr><th>Activity</th><th>Delta / Change</th><th>Date</th></tr>
              </thead>
              <tbody>
                {(profile.stoneTransactions || []).map((tx: any, i: number) => (
                  <tr key={`tx_${i}`}>
                    <td>{tx.description}</td>
                    <td className="mono" style={{ color: tx.amount >= 0 ? '#10b981' : '#f43f5e' }}>
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount} 💎
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{tx.created_at ? new Date(tx.created_at).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
                {(profile.aliasHistory || []).map((al: any, i: number) => (
                  <tr key={`al_${i}`}>
                    <td>Alias Rotation ({al.change_type})</td>
                    <td className="mono" style={{ fontSize: 11 }}>{al.old_alias} → {al.new_alias}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{al.changed_at ? new Date(al.changed_at).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
                {(profile.stoneTransactions || []).length === 0 && (profile.aliasHistory || []).length === 0 && (
                  <tr><td colSpan={3} style={{ color: '#575049' }}>No ledger or alias history yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
