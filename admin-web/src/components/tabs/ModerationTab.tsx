import React from 'react';
import { Gift, Users } from 'lucide-react';
import { AdminApi, AdminAuth } from '../../api';
import { formatDuration } from '../../utils/format';
import { UserProfileCard } from './UserProfileCard';

interface ModerationTabProps {
  auth: AdminAuth;
  reports: any[];
  users: any[];
  auditLogs: any[];
  selectedUserProfile: any;
  setSelectedUserProfile: (p: any) => void;
  onReload: () => void;
  onInspectRoom: (roomId: string) => void;
  onError: (msg: string) => void;
  setLoading: (b: boolean) => void;
}

export function ModerationTab({
  auth,
  reports,
  users,
  auditLogs,
  selectedUserProfile,
  setSelectedUserProfile,
  onReload,
  onInspectRoom,
  onError,
  setLoading
}: ModerationTabProps) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <h3>Abuse Reports ({reports.length})</h3>
        <table>
          <thead>
            <tr><th>ID</th><th>Reason</th><th>Status</th><th>Created</th><th>Action</th></tr>
          </thead>
          <tbody>
            {reports.map((rep) => (
              <tr key={rep.id}>
                <td className="mono">{String(rep.id).slice(0, 8)}...</td>
                <td>{rep.reason}</td>
                <td>
                  <span className={`badge ${rep.resolved ? 'emerald' : 'rose'}`}>{rep.resolved ? 'Resolved' : 'Open'}</span>
                  {rep.overdue24h && <span className="badge rose" style={{ marginLeft: 4 }}>&gt;24h SLA</span>}
                </td>
                <td className="mono">{new Date(rep.created_at).toLocaleString()}</td>
                <td>
                  <button
                    className="btn"
                    onClick={async () => {
                      await AdminApi.resolveReport(auth, rep.id, !rep.resolved);
                      onReload();
                    }}
                  >
                    {rep.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </td>
              </tr>
            ))}
            {reports.length === 0 && (
              <tr><td colSpan={5} style={{ color: '#575049' }}>No reports submitted.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>
          <Users size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Registered Users &amp; Live Telemetry ({users.length})
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Behavior</th>
                <th>Chats</th>
                <th>Time Stayed</th>
                <th>Avg / Chat</th>
                <th>Msgs (S/R)</th>
                <th>Stones / Streak</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.generated_alias}</div>
                    <div className="mono" style={{ fontSize: 11, color: '#575049' }}>{u.email} • {u.dept_code || '-'}</div>
                  </td>
                  <td>
                    {u.is_online ? <span className="badge emerald">Online</span> : <span className="badge amber">Offline</span>}
                    {u.is_admin && <span className="badge sky" style={{ marginLeft: 4 }}>Admin</span>}
                    {u.is_muted && <span className="badge amber" style={{ marginLeft: 4 }}>Muted</span>}
                    {u.is_banned && <span className="badge rose" style={{ marginLeft: 4 }}>Banned</span>}
                  </td>
                  <td><span className="badge sky">{u.telemetry?.behaviorTag || 'Newcomer'}</span></td>
                  <td className="mono">{u.telemetry?.totalChats ?? 0}</td>
                  <td className="mono" style={{ color: '#047857' }}>{formatDuration(u.telemetry?.totalDurationSeconds ?? 0)}</td>
                  <td className="mono">{formatDuration(u.telemetry?.avgSessionSeconds ?? 0)}</td>
                  <td className="mono">{u.telemetry?.messagesSent ?? 0} / {u.telemetry?.messagesReceived ?? 0}</td>
                  <td className="mono">{u.stones_balance ?? 0} 💎 • {u.streak_count ?? 0}d</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn primary"
                      onClick={async () => {
                        setLoading(true);
                        onError('');
                        try {
                          setSelectedUserProfile(await AdminApi.getUserProfile(auth, u.id));
                        } catch (e: any) {
                          onError(e.message);
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Profile
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        const raw = window.prompt(`Award how many Stones to ${u.generated_alias}?`, '10');
                        if (!raw) return;
                        const amt = parseInt(raw, 10);
                        if (Number.isNaN(amt) || amt === 0) return;
                        const reason = window.prompt('Reason for reward:', 'Admin Campaign Bonus') || 'Admin Bonus';
                        await AdminApi.rewardUser(auth, u.id, amt, reason);
                        onReload();
                      }}
                    >
                      <Gift size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      Reward
                    </button>
                    {!u.is_admin && (
                      <>
                        {u.is_muted ? (
                          <button className="btn" onClick={async () => { await AdminApi.muteUser(auth, u.id, 0); onReload(); }}>
                            Unmute
                          </button>
                        ) : (
                          <>
                            <button className="btn" onClick={async () => { await AdminApi.muteUser(auth, u.id, 24); onReload(); }}>
                              Mute 24h
                            </button>
                            <button className="btn" onClick={async () => { await AdminApi.muteUser(auth, u.id, 168); onReload(); }}>
                              Mute 7d
                            </button>
                          </>
                        )}
                        <button
                          className={`btn ${u.is_banned ? '' : 'danger'}`}
                          onClick={async () => { await AdminApi.setUserBan(auth, u.id, !u.is_banned); onReload(); }}
                        >
                          {u.is_banned ? 'Unban' : 'Ban'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <UserProfileCard profile={selectedUserProfile} onClose={() => setSelectedUserProfile(null)} onInspectRoom={onInspectRoom} />

      <div className="card">
        <h3>Admin Audit Log ({auditLogs.length})</h3>
        <div style={{ overflowX: 'auto', maxHeight: 280 }}>
          <table>
            <thead>
              <tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{new Date(log.created_at).toLocaleString()}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{log.admin_email}</td>
                  <td><span className="badge sky">{log.action}</span></td>
                  <td className="mono" style={{ fontSize: 11 }}>{log.target_type}:{String(log.target_id || '').slice(0, 8)}</td>
                  <td className="mono" style={{ fontSize: 11, color: '#575049' }}>{JSON.stringify(log.details || {})}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr><td colSpan={5} style={{ color: '#575049' }}>No admin actions recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
