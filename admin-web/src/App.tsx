import React, { useEffect, useState } from 'react';
import {
  Activity,
  Binary,
  Cpu,
  Gift,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users
} from 'lucide-react';
import { AdminApi, AdminAuth, supabase } from './api';
import { HuffmanTreeView } from './components/HuffmanTreeView';

type TabKey = 'overview' | 'rooms' | 'content' | 'algorithms' | 'moderation';

export default function App() {
  const [auth, setAuth] = useState<AdminAuth | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Login form state (empty by default, no prefilled email/password)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [loginMsg, setLoginMsg] = useState('');

  // Post-login "Set Password" prompt state (for Google / Magic Link logins with no password yet)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSetupMsg, setPasswordSetupMsg] = useState('');

  // Data state
  const [overview, setOverview] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserProfile, setSelectedUserProfile] = useState<any>(null);

  function formatDuration(totalSec: number): string {
    const s = Math.max(0, Math.round(totalSec || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const remSec = s % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${remSec}s`;
    return `${remSec}s`;
  }

  // Algorithm workflow controls
  const [walletStones, setWalletStones] = useState(13);
  const [targetStones, setTargetStones] = useState(12);
  const [sampleMsg, setSampleMsg] = useState('call me at zero one seven 8 9 1 2 3 4 5 6 later');
  const [workflows, setWorkflows] = useState<any>(null);

  // Dynamic Topic & Campaigns state
  const [topicDraft, setTopicDraft] = useState('');
  const [topicSavedMsg, setTopicSavedMsg] = useState('');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campTitle, setCampTitle] = useState('');
  const [campDesc, setCampDesc] = useState('');
  const [campMetric, setCampMetric] = useState<'streak_days' | 'total_chats' | 'referrals'>('streak_days');
  const [campTarget, setCampTarget] = useState(7);
  const [campReward, setCampReward] = useState(15);
  const [campEmoji, setCampEmoji] = useState('⭐');

  // Restore Supabase session if present
  useEffect(() => {
    if (!supabase) return;
    const applySession = (session: any) => {
      if (session?.access_token) {
        setAuth({
          bearerToken: session.access_token,
          email: session.user.email
        });
        const hasPwd = Boolean(session.user.user_metadata?.has_admin_password);
        if (!hasPwd) {
          setNeedsPasswordSetup(true);
        }
      }
    };
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadCurrentTab(currentAuth: AdminAuth, targetTab: TabKey) {
    setLoading(true);
    setError('');
    try {
      if (targetTab === 'overview') {
        setOverview(await AdminApi.getOverview(currentAuth));
      } else if (targetTab === 'rooms') {
        const res = await AdminApi.getRooms(currentAuth, 50);
        setRooms(res.rooms || []);
      } else if (targetTab === 'content') {
        const res = await AdminApi.getContent(currentAuth);
        setTopicDraft(res.todaysBenchTopic || '');
        setCampaigns(res.campaigns || []);
      } else if (targetTab === 'algorithms') {
        setWorkflows(
          await AdminApi.getAlgorithmWorkflows(currentAuth, walletStones, targetStones, sampleMsg)
        );
      } else if (targetTab === 'moderation') {
        const [repRes, usrRes] = await Promise.all([
          AdminApi.getReports(currentAuth),
          AdminApi.getUsers(currentAuth)
        ]);
        setReports(repRes.reports || []);
        setUsers(usrRes.users || []);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth) {
      loadCurrentTab(auth, tab);
    }
  }, [auth, tab]);

  async function handleInspectRoom(roomId: string) {
    if (!auth) return;
    setLoading(true);
    setError('');
    try {
      const data = await AdminApi.inspectRoom(auth, roomId);
      setSelectedRoom(data);
    } catch (e: any) {
      setError(e.message || 'Failed to inspect room');
    } finally {
      setLoading(false);
    }
  }

  async function handleSupabasePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoginMsg('');
    if (!supabase) {
      setError('Supabase env vars not configured. Use Admin Secret login below or set VITE_SUPABASE_URL.');
      return;
    }
    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setError(authErr.message);
      return;
    }
    if (data.session?.access_token) {
      setAuth({ bearerToken: data.session.access_token, email: data.session.user.email });
      setNeedsPasswordSetup(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setLoginMsg('');
    if (!supabase) {
      setError('Configure VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY in admin-web/.env first.');
      return;
    }
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (oauthErr) setError(oauthErr.message);
  }

  async function handleSetAdminPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSetupMsg('');
    if (!supabase) return;
    if (newPassword.length < 8) {
      setPasswordSetupMsg('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordSetupMsg('Passwords do not match.');
      return;
    }
    const { error: updErr } = await supabase.auth.updateUser({
      password: newPassword,
      data: { has_admin_password: true }
    });
    if (updErr) {
      setPasswordSetupMsg(updErr.message);
    } else {
      setNewPassword('');
      setConfirmPassword('');
      setNeedsPasswordSetup(false);
    }
  }

  async function handleMagicLink() {
    setError('');
    setLoginMsg('');
    if (!supabase) {
      setError('Configure VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY in admin-web/.env first.');
      return;
    }
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (otpErr) setError(otpErr.message);
    else setLoginMsg(`Magic login link sent to ${email}`);
  }

  function handleSecretLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!adminSecret.trim()) {
      setError('Enter your ADMIN_SECRET from backend/.env');
      return;
    }
    setAuth({ adminSecret: adminSecret.trim(), email: 'rhrakibulhasan279@gmail.com' });
  }

  async function handleSignOut() {
    if (supabase) await supabase.auth.signOut();
    setAuth(null);
    setSelectedRoom(null);
  }

  if (!auth) {
    return (
      <div className="login-shell">
        <div className="card login-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div className="brand-dot" />
            <h2 style={{ margin: 0, fontSize: 20 }}>Benchly Admin Console</h2>
          </div>
          <p style={{ color: '#575049', fontSize: 13, marginTop: 0 }}>
            Authorized Benchly administrators only.
          </p>

          {error && <div className="badge rose" style={{ marginBottom: 12, width: '100%' }}>{error}</div>}
          {loginMsg && <div className="badge emerald" style={{ marginBottom: 12, width: '100%' }}>{loginMsg}</div>}

          <button
            className="btn"
            type="button"
            onClick={handleGoogleLogin}
            style={{
              width: '100%',
              marginBottom: 14,
              padding: '10px 14px',
              background: '#ffffff',
              color: '#111827',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            Continue with Google
          </button>

          <form
            onSubmit={handleSupabasePasswordLogin}
            autoComplete="off"
            style={{ display: 'grid', gap: 10, marginBottom: 16 }}
          >
            <input
              className="input"
              type="email"
              name="admin_email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Admin email"
            />
            <input
              className="input"
              type="password"
              name="admin_password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (leave blank for Magic Link)"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" type="submit" style={{ flex: 1 }}>
                Sign In
              </button>
              <button className="btn" type="button" onClick={handleMagicLink}>
                Magic Link
              </button>
            </div>
          </form>

          <div style={{ borderTop: '1px solid rgba(30,27,24,0.12)', paddingTop: 14 }}>
            <div className="stat-label" style={{ marginBottom: 8 }}>Or Connect via Backend ADMIN_SECRET</div>
            <form onSubmit={handleSecretLogin} autoComplete="off" style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type="password"
                name="admin_secret"
                autoComplete="new-password"
                value={adminSecret}
                onChange={(e) => setAdminSecret(e.target.value)}
                placeholder="x-admin-secret"
              />
              <button className="btn" type="submit">Enter</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Benchly Admin</div>
            <div style={{ fontSize: 11, color: '#575049' }}>CSE246 & Moderation</div>
          </div>
        </div>

        <button className={`nav-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          <Activity size={16} /> Overview
        </button>
        <button className={`nav-btn ${tab === 'rooms' ? 'active' : ''}`} onClick={() => setTab('rooms')}>
          <Binary size={16} /> Chats & Huffman Trees
        </button>
        <button className={`nav-btn ${tab === 'content' ? 'active' : ''}`} onClick={() => setTab('content')}>
          <Sparkles size={16} /> Topics & Campaigns
        </button>
        <button className={`nav-btn ${tab === 'algorithms' ? 'active' : ''}`} onClick={() => setTab('algorithms')}>
          <Cpu size={16} /> Algorithm Workflows
        </button>
        <button className={`nav-btn ${tab === 'moderation' ? 'active' : ''}`} onClick={() => setTab('moderation')}>
          <ShieldAlert size={16} /> Reports & Users
        </button>

        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(30,27,24,0.12)' }}>
          <div className="mono" style={{ fontSize: 11, color: '#575049', marginBottom: 8, wordBreak: 'break-all' }}>
            {auth.email}
          </div>
          <button className="nav-btn" onClick={handleSignOut}>
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {tab === 'overview' && 'Live Campus Overview'}
            {tab === 'rooms' && 'Encrypted Chat Archives & Canonical Huffman Trees'}
            {tab === 'content' && 'Dynamic Bench Topic & Custom Reward Campaigns'}
            {tab === 'algorithms' && 'CSE246 Live Algorithm Workflows'}
            {tab === 'moderation' && 'Abuse Reports & User Moderation'}
          </h2>
          <button className="btn" onClick={() => loadCurrentTab(auth, tab)} disabled={loading}>
            <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && <div className="badge rose" style={{ marginBottom: 16 }}>{error}</div>}

        {needsPasswordSetup && auth.bearerToken && (
          <div className="card" style={{ marginBottom: 18, borderColor: '#1e1b18' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Set an Admin Password for Quick Sign-In</h3>
              <button className="btn" type="button" onClick={() => setNeedsPasswordSetup(false)}>
                Skip for now
              </button>
            </div>
            <p style={{ color: '#575049', fontSize: 13, marginTop: 0 }}>
              You signed in without a password. Set a password now so you can log in directly next time.
            </p>
            {passwordSetupMsg && <div className="badge rose" style={{ marginBottom: 10 }}>{passwordSetupMsg}</div>}
            <form onSubmit={handleSetAdminPassword} autoComplete="off" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 chars)"
                style={{ flex: 1, minWidth: 200 }}
              />
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                style={{ flex: 1, minWidth: 200 }}
              />
              <button className="btn primary" type="submit">
                Save Password
              </button>
            </form>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {tab === 'overview' && overview && (
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
                <div className="stat-label">Avg Huffman Savings</div>
                <div className="stat-val" style={{ color: '#2563eb' }}>
                  {overview.totals?.avgHuffmanSavingsPct ?? 0}%
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
                    <tr><td>Matches Created</td><td className="mono">{overview.liveStats?.todayStats?.matchesCreated ?? 0}</td></tr>
                    <tr><td>Messages Exchanged</td><td className="mono">{overview.liveStats?.todayStats?.messagesExchanged ?? 0}</td></tr>
                    <tr><td>Mutual Extensions</td><td className="mono">{overview.liveStats?.todayStats?.mutualExtensions ?? 0}</td></tr>
                    <tr><td>Reports Submitted</td><td className="mono">{overview.totals?.reports ?? 0}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h3>Azure VM System Health</h3>
                <table>
                  <tbody>
                    <tr><td>RSS Memory</td><td className="mono">{overview.liveStats?.systemHealth?.rssMemoryMb ?? 0} MB</td></tr>
                    <tr><td>Heap Used</td><td className="mono">{overview.liveStats?.systemHealth?.heapUsedMb ?? 0} MB</td></tr>
                    <tr><td>Uptime</td><td className="mono">{overview.liveStats?.systemHealth?.uptimeSeconds ?? 0} s</td></tr>
                    <tr><td>Node Version</td><td className="mono">{overview.liveStats?.systemHealth?.nodeVersion ?? '-'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: CHATS & HUFFMAN TREES */}
        {tab === 'rooms' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="card">
              <h3>Archived Rooms ({rooms.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Participants</th>
                      <th>Msgs</th>
                      <th>Savings</th>
                      <th>H(X) / L̄</th>
                      <th>Encryption</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.roomId}>
                        <td className="mono">{String(r.roomId).slice(0, 8)}...</td>
                        <td>{r.user1Alias} × {r.user2Alias}</td>
                        <td className="mono">{r.messagesCount}</td>
                        <td className="mono" style={{ color: '#047857' }}>{r.compressionSavingsPct}%</td>
                        <td className="mono">
                          {r.shannonEntropy ?? '-'} / {r.averageCodeLength ?? '-'}
                        </td>
                        <td>
                          <span className={`badge ${r.encrypted ? 'emerald' : 'amber'}`}>
                            <Lock size={11} /> {r.encrypted ? 'AES-256-GCM' : 'Legacy'}
                          </span>
                        </td>
                        <td>
                          <button className="btn primary" onClick={() => handleInspectRoom(r.roomId)}>
                            Decrypt & Tree
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rooms.length === 0 && (
                      <tr><td colSpan={7} style={{ color: '#575049' }}>No archived rooms yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRoom && (
              <>
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>
                      Canonical Huffman Binary Tree — Room <span className="mono">{selectedRoom.roomId}</span>
                    </h3>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge emerald">Saved {selectedRoom.stats?.savingsPercent}%</span>
                      <span className="badge sky">
                        {selectedRoom.stats?.originalBytes}B → {selectedRoom.stats?.compressedBytes}B
                      </span>
                      <span className="badge emerald">
                        H(X)={selectedRoom.stats?.shannonEntropy} ≤ L̄={selectedRoom.stats?.averageCodeLength}
                      </span>
                    </div>
                  </div>
                  <HuffmanTreeView tree={selectedRoom.huffmanTree} />
                </div>

                <div className="grid-2">
                  <div className="card">
                    <h3>Decrypted Transcript ({selectedRoom.messages?.length ?? 0} messages)</h3>
                    <div style={{ maxHeight: 340, overflowY: 'auto', display: 'grid', gap: 8 }}>
                      {(selectedRoom.messages || []).map((m: any, idx: number) => (
                        <div
                          key={m.id || idx}
                          style={{
                            background: '#fff4e4',
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(30,27,24,0.12)'
                          }}
                        >
                          <div style={{ fontSize: 11, color: '#047857', fontWeight: 600 }}>
                            {m.author_alias || m.authorAlias || 'Student'}
                          </div>
                          <div style={{ fontSize: 13, marginTop: 2 }}>{m.content}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <h3>Canonical Prefix Codebook ({Object.keys(selectedRoom.canonicalCodes || {}).length} symbols)</h3>
                    <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                      <table>
                        <thead>
                          <tr><th>Symbol</th><th>Freq</th><th>Bits</th><th>Canonical Code</th></tr>
                        </thead>
                        <tbody>
                          {Object.entries(selectedRoom.canonicalCodes || {}).map(([sym, code]) => (
                            <tr key={sym}>
                              <td className="mono">{sym === ' ' ? '[SPACE]' : sym}</td>
                              <td className="mono">{selectedRoom.symbolFrequencies?.[sym] ?? '-'}</td>
                              <td className="mono">{selectedRoom.codeLengths?.[sym]}</td>
                              <td className="mono" style={{ color: '#047857' }}>{String(code)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 2.5: DYNAMIC TOPICS & CAMPAIGNS */}
        {tab === 'content' && (
          <div style={{ display: 'grid', gap: 16 }}>
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
                    setError('');
                    try {
                      await AdminApi.updateTopic(auth, topicDraft);
                      setTopicSavedMsg('Published live to all Benchly users!');
                    } catch (e: any) {
                      setError(e.message);
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
                  setError('');
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
                    loadCurrentTab(auth, 'content');
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
                style={{ display: 'grid', gap: 10 }}
              >
                <div className="grid-2">
                  <input
                    className="input"
                    required
                    value={campTitle}
                    onChange={(e) => setCampTitle(e.target.value)}
                    placeholder="Campaign Title (e.g., 7-Day Adda Streak Challenge)"
                  />
                  <input
                    className="input"
                    required
                    value={campDesc}
                    onChange={(e) => setCampDesc(e.target.value)}
                    placeholder="Description (e.g., Chat for 7 days and earn +15 Stars/Stones)"
                  />
                </div>
                <div className="grid-4" style={{ marginBottom: 0 }}>
                  <div>
                    <div className="stat-label">Condition Metric</div>
                    <select
                      className="input"
                      value={campMetric}
                      onChange={(e) => setCampMetric(e.target.value as any)}
                      style={{ marginTop: 6 }}
                    >
                      <option value="streak_days">Chat Streak (Days)</option>
                      <option value="total_chats">Total Chats Completed</option>
                      <option value="referrals">Friends Referred</option>
                    </select>
                  </div>
                  <div>
                    <div className="stat-label">Target Value</div>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={campTarget}
                      onChange={(e) => setCampTarget(Number(e.target.value))}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                  <div>
                    <div className="stat-label">Reward Stones (💎)</div>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={campReward}
                      onChange={(e) => setCampReward(Number(e.target.value))}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                  <div>
                    <div className="stat-label">Emoji Icon</div>
                    <input
                      className="input"
                      value={campEmoji}
                      onChange={(e) => setCampEmoji(e.target.value)}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                </div>
                <div>
                  <button className="btn primary" type="submit">
                    + Launch Campaign
                  </button>
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
                          <span className={`badge ${c.is_active ? 'emerald' : 'amber'}`}>
                            {c.is_active ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn"
                            onClick={async () => {
                              await AdminApi.toggleCampaign(auth, c.id, !c.is_active);
                              loadCurrentTab(auth, 'content');
                            }}
                          >
                            {c.is_active ? 'Pause' : 'Activate'}
                          </button>
                          <button
                            className="btn danger"
                            onClick={async () => {
                              await AdminApi.deleteCampaign(auth, c.id);
                              loadCurrentTab(auth, 'content');
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {campaigns.length === 0 && (
                      <tr><td colSpan={5} style={{ color: '#575049' }}>No campaigns yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CSE246 ALGORITHM WORKFLOWS */}
        {tab === 'algorithms' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="card">
              <h3>Live Workflow Controls</h3>
              <div className="grid-4" style={{ marginBottom: 12 }}>
                <div>
                  <div className="stat-label">Knapsack / Subset-Sum Wallet (W={walletStones})</div>
                  <input
                    type="range"
                    min={2}
                    max={30}
                    value={walletStones}
                    onChange={(e) => setWalletStones(Number(e.target.value))}
                    style={{ width: '100%', marginTop: 8 }}
                  />
                </div>
                <div>
                  <div className="stat-label">Coin Change Target (S={targetStones})</div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={targetStones}
                    onChange={(e) => setTargetStones(Number(e.target.value))}
                    style={{ width: '100%', marginTop: 8 }}
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <div className="stat-label">PII Shield Test Message (KMP + LCS + Rabin-Karp)</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <input
                      className="input"
                      value={sampleMsg}
                      onChange={(e) => setSampleMsg(e.target.value)}
                    />
                    <button className="btn primary" onClick={() => loadCurrentTab(auth, 'algorithms')}>
                      Run Live
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {workflows && (
              <div className="grid-2">
                {/* 0/1 Knapsack DP vs Greedy */}
                <div className="card">
                  <h3>0/1 Knapsack DP vs. Greedy (Wallet = {workflows.knapsack?.walletStones} 💎)</h3>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <span className="badge emerald">DP Boost: {workflows.knapsack?.dpOptimalBoost}</span>
                    <span className="badge amber">Greedy Boost: {workflows.knapsack?.greedy01Boost}</span>
                    {workflows.knapsack?.dpOptimalBoost > workflows.knapsack?.greedy01Boost && (
                      <span className="badge sky">
                        DP Wins +{workflows.knapsack.dpOptimalBoost - workflows.knapsack.greedy01Boost}
                      </span>
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

                {/* Coin Change DP vs Greedy */}
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

                {/* Backtracking & Branch-and-Bound */}
                <div className="card">
                  <h3>Backtracking & Branch-and-Bound Workflows</h3>
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

                {/* PII Shield */}
                <div className="card">
                  <h3>PII Shield (KMP π-LPS + LCS DP + Rabin-Karp)</h3>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span className={`badge ${workflows.piiShield?.verdict?.wasModified ? 'rose' : 'emerald'}`}>
                      {workflows.piiShield?.verdict?.wasModified ? 'BLOCKED' : 'CLEAN'}
                    </span>
                    <span className="badge sky">
                      LCS Similarity: {workflows.piiShield?.verdict?.lcsMaxSimilarity}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    <strong>Sanitized Output:</strong>{' '}
                    <span className="mono">{workflows.piiShield?.verdict?.safeContent}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: '#575049' }}>
                    KMP Matches: {JSON.stringify(workflows.piiShield?.verdict?.kmpMatches)}
                    <br />
                    KMP π-LPS ("{workflows.piiShield?.kmpLpsSample?.pattern}"):{' '}
                    {JSON.stringify(workflows.piiShield?.kmpLpsSample?.lpsTable)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: REPORTS & USERS */}
        {tab === 'moderation' && (
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
                        <span className={`badge ${rep.resolved ? 'emerald' : 'rose'}`}>
                          {rep.resolved ? 'Resolved' : 'Open'}
                        </span>
                      </td>
                      <td className="mono">{new Date(rep.created_at).toLocaleString()}</td>
                      <td>
                        <button
                          className="btn"
                          onClick={async () => {
                            await AdminApi.resolveReport(auth, rep.id, !rep.resolved);
                            loadCurrentTab(auth, 'moderation');
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
                Registered Users & Live Telemetry ({users.length})
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
                          <div className="mono" style={{ fontSize: 11, color: '#575049' }}>
                            {u.email} • {u.dept_code || '-'}
                          </div>
                        </td>
                        <td>
                          {u.is_online ? (
                            <span className="badge emerald">Online</span>
                          ) : (
                            <span className="badge amber">Offline</span>
                          )}
                          {u.is_admin && <span className="badge sky" style={{ marginLeft: 4 }}>Admin</span>}
                          {u.is_banned && <span className="badge rose" style={{ marginLeft: 4 }}>Banned</span>}
                        </td>
                        <td>
                          <span className="badge sky">{u.telemetry?.behaviorTag || 'Newcomer'}</span>
                        </td>
                        <td className="mono">{u.telemetry?.totalChats ?? 0}</td>
                        <td className="mono" style={{ color: '#047857' }}>
                          {formatDuration(u.telemetry?.totalDurationSeconds ?? 0)}
                        </td>
                        <td className="mono">
                          {formatDuration(u.telemetry?.avgSessionSeconds ?? 0)}
                        </td>
                        <td className="mono">
                          {u.telemetry?.messagesSent ?? 0} / {u.telemetry?.messagesReceived ?? 0}
                        </td>
                        <td className="mono">
                          {u.stones_balance ?? 0} 💎 • {u.streak_count ?? 0}d
                        </td>
                        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn primary"
                            onClick={async () => {
                              setLoading(true);
                              setError('');
                              try {
                                const prof = await AdminApi.getUserProfile(auth, u.id);
                                setSelectedUserProfile(prof);
                              } catch (e: any) {
                                setError(e.message);
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
                              loadCurrentTab(auth, 'moderation');
                            }}
                          >
                            <Gift size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            Reward
                          </button>
                          {!u.is_admin && (
                            <button
                              className={`btn ${u.is_banned ? '' : 'danger'}`}
                              onClick={async () => {
                                await AdminApi.setUserBan(auth, u.id, !u.is_banned);
                                loadCurrentTab(auth, 'moderation');
                              }}
                            >
                              {u.is_banned ? 'Unban' : 'Ban'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedUserProfile && (
              <div className="card" style={{ borderColor: '#1e1b18' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>
                      User Telemetry Profile — {selectedUserProfile.user?.generated_alias}{' '}
                      <span className="badge sky" style={{ marginLeft: 8 }}>
                        {selectedUserProfile.summary?.behaviorTag}
                      </span>
                    </h3>
                    <div className="mono" style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
                      {selectedUserProfile.user?.email} • Dept: {selectedUserProfile.user?.dept_code || '-'} • Sem:{' '}
                      {selectedUserProfile.user?.semester_intake || '-'} • Last Login:{' '}
                      {selectedUserProfile.user?.last_login
                        ? new Date(selectedUserProfile.user.last_login).toLocaleString()
                        : 'Never'}
                    </div>
                  </div>
                  <button className="btn" onClick={() => setSelectedUserProfile(null)}>
                    Close Profile
                  </button>
                </div>

                <div className="grid-4">
                  <div className="card" style={{ background: '#fff4e4' }}>
                    <div className="stat-label">Total Time Stayed</div>
                    <div className="stat-val" style={{ color: '#047857', fontSize: 22 }}>
                      {formatDuration(selectedUserProfile.summary?.totalDurationSeconds ?? 0)}
                    </div>
                  </div>
                  <div className="card" style={{ background: '#fff4e4' }}>
                    <div className="stat-label">Chats / Avg Duration</div>
                    <div className="stat-val" style={{ fontSize: 22 }}>
                      {selectedUserProfile.summary?.totalChats ?? 0} •{' '}
                      {formatDuration(selectedUserProfile.summary?.avgSessionSeconds ?? 0)}
                    </div>
                  </div>
                  <div className="card" style={{ background: '#fff4e4' }}>
                    <div className="stat-label">Messages (Sent / Recv)</div>
                    <div className="stat-val" style={{ color: '#2563eb', fontSize: 22 }}>
                      {selectedUserProfile.summary?.messagesSent ?? 0} / {selectedUserProfile.summary?.messagesReceived ?? 0}
                    </div>
                  </div>
                  <div className="card" style={{ background: '#fff4e4' }}>
                    <div className="stat-label">Unique Partners / Peak Hr</div>
                    <div className="stat-val" style={{ color: '#d97706', fontSize: 22 }}>
                      {selectedUserProfile.summary?.uniquePartners ?? 0} •{' '}
                      {selectedUserProfile.summary?.peakHour !== null && selectedUserProfile.summary?.peakHour !== undefined
                        ? `${selectedUserProfile.summary.peakHour}:00`
                        : '-'}
                    </div>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="card" style={{ background: '#fffdf8' }}>
                    <h3>Recent Chat Sessions ({selectedUserProfile.recentSessions?.length ?? 0})</h3>
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      <table>
                        <thead>
                          <tr><th>Room</th><th>Stayed</th><th>Msgs (S/R)</th><th>When</th><th>Tree</th></tr>
                        </thead>
                        <tbody>
                          {(selectedUserProfile.recentSessions || []).map((s: any, idx: number) => (
                            <tr key={`${s.room_id}_${idx}`}>
                              <td className="mono">{String(s.room_id || '').slice(0, 8)}...</td>
                              <td className="mono" style={{ color: '#047857' }}>{formatDuration(s.duration_seconds)}</td>
                              <td className="mono">{s.messages_sent} / {s.messages_received}</td>
                              <td className="mono" style={{ fontSize: 11 }}>
                                {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  onClick={() => {
                                    setTab('rooms');
                                    handleInspectRoom(s.room_id);
                                  }}
                                >
                                  Inspect
                                </button>
                              </td>
                            </tr>
                          ))}
                          {(selectedUserProfile.recentSessions || []).length === 0 && (
                            <tr><td colSpan={5} style={{ color: '#575049' }}>No completed chat sessions yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="card" style={{ background: '#fffdf8' }}>
                    <h3>Stones Ledger & Alias History</h3>
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      <table>
                        <thead>
                          <tr><th>Activity</th><th>Delta / Change</th><th>Date</th></tr>
                        </thead>
                        <tbody>
                          {(selectedUserProfile.stoneTransactions || []).map((tx: any, i: number) => (
                            <tr key={`tx_${i}`}>
                              <td>{tx.description}</td>
                              <td className="mono" style={{ color: tx.amount >= 0 ? '#10b981' : '#f43f5e' }}>
                                {tx.amount >= 0 ? `+${tx.amount}` : tx.amount} 💎
                              </td>
                              <td className="mono" style={{ fontSize: 11 }}>
                                {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : '-'}
                              </td>
                            </tr>
                          ))}
                          {(selectedUserProfile.aliasHistory || []).map((al: any, i: number) => (
                            <tr key={`al_${i}`}>
                              <td>Alias Rotation ({al.change_type})</td>
                              <td className="mono" style={{ fontSize: 11 }}>{al.old_alias} → {al.new_alias}</td>
                              <td className="mono" style={{ fontSize: 11 }}>
                                {al.changed_at ? new Date(al.changed_at).toLocaleDateString() : '-'}
                              </td>
                            </tr>
                          ))}
                          {(selectedUserProfile.stoneTransactions || []).length === 0 &&
                            (selectedUserProfile.aliasHistory || []).length === 0 && (
                              <tr><td colSpan={3} style={{ color: '#575049' }}>No ledger or alias history yet.</td></tr>
                            )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
