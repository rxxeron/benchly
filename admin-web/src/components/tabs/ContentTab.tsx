import React, { useState } from 'react';
import { AdminApi, AdminAuth } from '../../api';

interface ContentTabProps {
  auth: AdminAuth;
  topicDraft: string;
  setTopicDraft: (v: string) => void;
  campaigns: any[];
  earlyBirdAvatars: any[];
  totalStonesInCirculation: number;
  onReload: () => void;
  onError: (msg: string) => void;
}

export function ContentTab({
  auth,
  topicDraft,
  setTopicDraft,
  campaigns,
  earlyBirdAvatars,
  totalStonesInCirculation,
  onReload,
  onError
}: ContentTabProps) {
  const [topicSavedMsg, setTopicSavedMsg] = useState('');
  const [campTitle, setCampTitle] = useState('');
  const [campDesc, setCampDesc] = useState('');
  const [campMetric, setCampMetric] = useState<'streak_days' | 'total_chats' | 'referrals'>('streak_days');
  const [campTarget, setCampTarget] = useState(7);
  const [campReward, setCampReward] = useState(15);
  const [campEmoji, setCampEmoji] = useState('⭐');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Campus Stones Economy &amp; Early-Bird EWU Avatars</h3>
          <span className="badge amber">Total Stones in Circulation: {totalStonesInCirculation} 💎</span>
        </div>
        <div className="grid-4" style={{ marginBottom: 0 }}>
          {earlyBirdAvatars.map((av) => {
            const limit = Number(av.free_claim_limit || 20);
            const claimed = Number(av.claimed_count || 0);
            const pct = Math.min(100, Math.round((claimed / Math.max(1, limit)) * 100));
            const isFree = limit > 0 && claimed < limit;
            return (
              <div key={av.id} style={{ background: '#fffdf8', padding: 12, borderRadius: 12, border: '1.5px solid #1e1b18' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{av.icon_emoji || '🎭'}</span>
                  <span className={`badge ${isFree ? 'emerald' : 'sky'}`}>{isFree ? 'FREE (<20)' : `${av.stone_cost} 💎`}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{av.name}</div>
                <div className="mono" style={{ fontSize: 11, color: '#575049', margin: '4px 0 6px' }}>
                  Claimed: {claimed} / {limit}
                </div>
                <div style={{ height: 7, background: '#fff4e4', borderRadius: 999, border: '1px solid #1e1b18', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: isFree ? '#0fb881' : '#2563eb' }} />
                </div>
              </div>
            );
          })}
          {earlyBirdAvatars.length === 0 && <div style={{ color: '#575049', fontSize: 13 }}>No early-bird avatars loaded yet.</div>}
        </div>
      </div>

      <div className="card">
        <h3>Today's Bench Topic (Live in Flutter App)</h3>
        <p style={{ color: '#575049', fontSize: 13, marginTop: 0 }}>
          Updates immediately in the database and broadcasts live to connected students.
        </p>
        {topicSavedMsg && <div className="badge emerald" style={{ marginBottom: 10 }}>{topicSavedMsg}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            placeholder="Enter today's campus adda topic..."
            style={{ flex: 1, minWidth: 260 }}
          />
          <button
            className="btn primary"
            onClick={async () => {
              setTopicSavedMsg('');
              onError('');
              try {
                await AdminApi.updateTopic(auth, topicDraft);
                setTopicSavedMsg('Published live to all Benchly users!');
              } catch (e: any) {
                onError(e.message);
              }
            }}
          >
            Publish Live
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Create Custom Reward Campaign</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            onError('');
            try {
              await AdminApi.createCampaign(auth, {
                title: campTitle,
                description: campDesc,
                metric_type: campMetric,
                target_value: campTarget,
                reward_stones: campReward,
                icon_emoji: campEmoji
              });
              setCampTitle('');
              setCampDesc('');
              onReload();
            } catch (err: any) {
              onError(err.message);
            }
          }}
          style={{ display: 'grid', gap: 10 }}
        >
          <div className="grid-2">
            <input className="input" required value={campTitle} onChange={(e) => setCampTitle(e.target.value)} placeholder="Campaign Title" />
            <input className="input" required value={campDesc} onChange={(e) => setCampDesc(e.target.value)} placeholder="Description" />
          </div>
          <div className="grid-4" style={{ marginBottom: 0 }}>
            <div>
              <div className="stat-label">Condition Metric</div>
              <select className="input" value={campMetric} onChange={(e) => setCampMetric(e.target.value as any)} style={{ marginTop: 6 }}>
                <option value="streak_days">Chat Streak (Days)</option>
                <option value="total_chats">Total Chats Completed</option>
                <option value="referrals">Friends Referred</option>
              </select>
            </div>
            <div>
              <div className="stat-label">Target Value</div>
              <input className="input" type="number" min={1} value={campTarget} onChange={(e) => setCampTarget(Number(e.target.value))} style={{ marginTop: 6 }} />
            </div>
            <div>
              <div className="stat-label">Reward Stones (💎)</div>
              <input className="input" type="number" min={1} value={campReward} onChange={(e) => setCampReward(Number(e.target.value))} style={{ marginTop: 6 }} />
            </div>
            <div>
              <div className="stat-label">Emoji Icon</div>
              <input className="input" value={campEmoji} onChange={(e) => setCampEmoji(e.target.value)} style={{ marginTop: 6 }} />
            </div>
          </div>
          <div>
            <button className="btn primary" type="submit">+ Launch Campaign</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>All Reward Campaigns ({campaigns.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Rule</th>
                <th>Reward</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.icon_emoji} {c.title}</strong>
                    <div style={{ fontSize: 12, color: '#575049' }}>{c.description}</div>
                  </td>
                  <td className="mono">{c.metric_type} ≥ {c.target_value}</td>
                  <td className="mono" style={{ color: '#047857' }}>+{c.reward_stones} 💎</td>
                  <td>
                    <span className={`badge ${c.is_active ? 'emerald' : 'amber'}`}>{c.is_active ? 'Active' : 'Paused'}</span>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn"
                      onClick={async () => {
                        await AdminApi.toggleCampaign(auth, c.id, !c.is_active);
                        onReload();
                      }}
                    >
                      {c.is_active ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      className="btn danger"
                      onClick={async () => {
                        await AdminApi.deleteCampaign(auth, c.id);
                        onReload();
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: '#575049' }}>No campaigns yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
