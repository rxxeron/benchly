import React, { useEffect, useState } from 'react';
import {
  Activity,
  Binary,
  Cpu,
  Download,
  Gift,
  Lock,
  LogOut,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users
} from 'lucide-react';
import { AdminApi, AdminAuth, supabase } from './api';
import { HuffmanTreeView } from './components/HuffmanTreeView';

type TabKey = 'overview' | 'growth' | 'rooms' | 'content' | 'algorithms' | 'moderation' | 'system';

export default function App() {
  const [auth, setAuth] = useState<AdminAuth | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Login form state (empty by default, no prefilled email/password)
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Post-login "Set Password" prompt state (for Google / Magic Link logins with no password yet)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSetupMsg, setPasswordSetupMsg] = useState('');

  // Data state
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [growth, setGrowth] = useState<any>(null);
  const [growthDays, setGrowthDays] = useState<number>(14);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [roomFilter, setRoomFilter] = useState<'all' | 'human' | 'ai' | 'encrypted'>('all');
  const [roomSearch, setRoomSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [selectedUserProfile, setSelectedUserProfile] = useState<any>(null);
  const [earlyBirdAvatars, setEarlyBirdAvatars] = useState<any[]>([]);
  const [totalStonesInCirculation, setTotalStonesInCirculation] = useState<number>(0);

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

  async function loadCurrentTab(currentAuth: AdminAuth, targetTab: TabKey, overrideDays?: number) {
    setLoading(true);
    setError('');
    try {
      if (targetTab === 'overview') {
        setOverview(await AdminApi.getOverview(currentAuth));
      } else if (targetTab === 'growth') {
        setGrowth(await AdminApi.getGrowth(currentAuth, overrideDays ?? growthDays));
      } else if (targetTab === 'rooms') {
        const res = await AdminApi.getRooms(currentAuth, 50);
        setRooms(res.rooms || []);
      } else if (targetTab === 'content') {
        const res = await AdminApi.getContent(currentAuth);
        setTopicDraft(res.todaysBenchTopic || '');
        setCampaigns(res.campaigns || []);
        setEarlyBirdAvatars(res.earlyBirdAvatars || []);
        setTotalStonesInCirculation(Number(res.totalStonesInCirculation || 0));
      } else if (targetTab === 'algorithms') {
        setWorkflows(
          await AdminApi.getAlgorithmWorkflows(currentAuth, walletStones, targetStones, sampleMsg)
        );
      } else if (targetTab === 'moderation') {
        const [repRes, usrRes, audRes] = await Promise.all([
          AdminApi.getReports(currentAuth),
          AdminApi.getUsers(currentAuth),
          AdminApi.getAuditLogs(currentAuth, 50)
        ]);
        setReports(repRes.reports || []);
        setUsers(usrRes.users || []);
        setAuditLogs(audRes.logs || []);
      } else if (targetTab === 'system') {
        setSystemHealth(await AdminApi.getSystemHealth(currentAuth));
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

  useEffect(() => {
    if (!auth || !autoRefresh) return;
    const id = window.setInterval(() => {
      loadCurrentTab(auth, tab);
    }, 15000);
    return () => window.clearInterval(id);
  }, [auth, autoRefresh, tab, growthDays]);

  async function handleExportJson() {
    if (!auth) return;
    setLoading(true);
    setError('');
    try {
      const [ov, gr, sh] = await Promise.all([
        overview ? Promise.resolve(overview) : AdminApi.getOverview(auth),
        growth ? Promise.resolve(growth) : AdminApi.getGrowth(auth, growthDays),
        systemHealth ? Promise.resolve(systemHealth) : AdminApi.getSystemHealth(auth)
      ]);
      const snapshot = {
        exportedAt: new Date().toISOString(),
        overview: ov,
        growth: gr,
        systemHealth: sh
      };
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `benchly-metrics-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Failed to export metrics');
    } finally {
      setLoading(false);
    }
  }

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
    if (!supabase) {
      setError('Supabase environment variables are not configured.');
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
    if (!supabase) {
      setError('Supabase environment variables are not configured.');
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
          <p style={{ color: '#575049', fontSize: 13, marginTop: 0, marginBottom: 18 }}>
            Authorized Benchly administrators only.
          </p>

          {error && <div className="badge rose" style={{ marginBottom: 14, width: '100%' }}>{error}</div>}

          {!showPasswordLogin ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <button
                className="btn primary"
                type="button"
                onClick={handleGoogleLogin}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: 15,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                Sign in with Google
              </button>

              <button
                className="btn"
                type="button"
                onClick={() => {
                  setError('');
                  setShowPasswordLogin(true);
                }}
                style={{ width: '100%', padding: '10px 14px' }}
              >
                Login with Email &amp; Password
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleSupabasePasswordLogin}
              autoComplete="off"
              style={{ display: 'grid', gap: 10 }}
            >
              <input
                className="input"
                type="email"
                name="admin_email"
                autoComplete="off"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Admin email"
              />
              <input
                className="input"
                type="password"
                name="admin_password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              <button className="btn primary" type="submit" style={{ width: '100%', padding: '11px 14px' }}>
                Sign In
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setError('');
                  setShowPasswordLogin(false);
                }}
                style={{ width: '100%' }}
              >
                ← Back to Google Sign-In
              </button>
            </form>
          )}
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
        <button className={`nav-btn ${tab === 'growth' ? 'active' : ''}`} onClick={() => setTab('growth')}>
          <TrendingUp size={16} /> Growth & Traffic
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
        <button className={`nav-btn ${tab === 'system' ? 'active' : ''}`} onClick={() => setTab('system')}>
          <Server size={16} /> System Health
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {tab === 'overview' && 'Live Campus Overview'}
            {tab === 'growth' && 'Website Traffic, Funnel & Retention'}
            {tab === 'rooms' && 'Encrypted Chat Archives & Canonical Huffman Trees'}
            {tab === 'content' && 'Dynamic Bench Topic, Economy & Reward Campaigns'}
            {tab === 'algorithms' && 'CSE246 Live Algorithm Workflows'}
            {tab === 'moderation' && 'Abuse Reports, Moderation & Audit Log'}
            {tab === 'system' && 'System Health, AI Cluster & Free-Tier Guardrails'}
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className={`btn ${autoRefresh ? 'primary' : ''}`}
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              title="Automatically refresh current tab every 15 seconds"
            >
              {autoRefresh ? '● Live 15s ON' : 'Live 15s: OFF'}
            </button>
            <button className="btn" type="button" onClick={handleExportJson} disabled={loading}>
              <Download size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Export JSON
            </button>
            <button className="btn" onClick={() => loadCurrentTab(auth, tab)} disabled={loading}>
              <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
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
                <div className="stat-label">Web & App Visits Today</div>
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
                  AI Fallback: {overview.chatQuality?.aiFallbackPct ?? 0}% ({overview.chatQuality?.humanRooms ?? 0}H / {overview.chatQuality?.aiRooms ?? 0}AI)
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
                    <tr><td>Uptime</td><td className="mono">{formatDuration(overview.liveStats?.systemHealth?.uptimeSeconds ?? 0)}</td></tr>
                    <tr><td>Node Version</td><td className="mono">{overview.liveStats?.systemHealth?.nodeVersion ?? '-'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 1.5: GROWTH & TRAFFIC */}
        {tab === 'growth' && growth && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#575049' }}>Window:</span>
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  className={`btn ${growthDays === d ? 'primary' : ''}`}
                  onClick={() => {
                    setGrowthDays(d);
                    loadCurrentTab(auth, 'growth', d);
                  }}
                >
                  Last {d} Days
                </button>
              ))}
            </div>

            <div className="grid-4" style={{ marginBottom: 0 }}>
              <div className="card">
                <div className="stat-label">Unique Visitors (24h / 7d / 30d)</div>
                <div className="stat-val" style={{ color: '#047857', fontSize: 22 }}>
                  {growth.visitors?.unique24h ?? 0} / {growth.visitors?.unique7d ?? 0} / {growth.visitors?.unique30d ?? 0}
                </div>
                <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
                  Pageviews (7d / 30d): {growth.visitors?.pageviews7d ?? 0} / {growth.visitors?.pageviews30d ?? 0}
                </div>
              </div>
              <div className="card">
                <div className="stat-label">DAU / WAU / MAU</div>
                <div className="stat-val" style={{ fontSize: 22 }}>
                  {growth.retention?.dau ?? 0} / {growth.retention?.wau ?? 0} / {growth.retention?.mau ?? 0}
                </div>
                <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
                  Stickiness (DAU/MAU): {growth.retention?.stickinessPct ?? 0}%
                </div>
              </div>
              <div className="card">
                <div className="stat-label">Cohort Retention</div>
                <div className="stat-val" style={{ color: '#2563eb', fontSize: 22 }}>
                  D1 {growth.retention?.d1RetentionPct ?? 0}% • D7 {growth.retention?.d7RetentionPct ?? 0}%
                </div>
                <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
                  Human Match: {growth.chatQuality?.humanMatchPct ?? 0}% • AI: {growth.chatQuality?.aiFallbackPct ?? 0}%
                </div>
              </div>
              <div className="card">
                <div className="stat-label">Platform Split</div>
                <div className="stat-val" style={{ color: '#d97706', fontSize: 22 }}>
                  Web {growth.platforms?.web ?? 0} • App {growth.platforms?.android ?? 0}
                </div>
                <div style={{ fontSize: 12, color: '#575049', marginTop: 4 }}>
                  Mobile Web: {growth.platforms?.mobileWeb ?? 0} • Desktop: {growth.platforms?.desktopWeb ?? 0}
                </div>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <h3>Acquisition &amp; Activation Funnel</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    { label: '1. Landing Page Visits (benchly.live)', value: growth.funnel?.landingViews ?? 0, color: '#0fb881' },
                    { label: '2. "Open App" CTA Clicks', value: growth.funnel?.ctaClicks ?? 0, color: '#2563eb' },
                    { label: '3. App Opens (app.benchly.live / APK)', value: growth.funnel?.appOpens ?? 0, color: '#d97706' },
                    { label: '4. Verified @std.ewubd.edu Students', value: growth.funnel?.verifiedStudents ?? 0, color: '#ff6b4a' },
                    { label: '5. Students Matched into Chats', value: growth.funnel?.matchedStudents ?? 0, color: '#047857' },
                    { label: '6. Completed Archived Chats', value: growth.funnel?.completedChats ?? 0, color: '#7c3aed' }
                  ].map((step) => {
                    const maxFunnel = Math.max(
                      1,
                      growth.funnel?.landingViews || 0,
                      growth.funnel?.verifiedStudents || 0,
                      growth.funnel?.completedChats || 0
                    );
                    const pct = Math.min(100, Math.round((step.value / maxFunnel) * 100));
                    return (
                      <div key={step.label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                          <span>{step.label}</span>
                          <strong className="mono">{step.value}</strong>
                        </div>
                        <div style={{ height: 10, background: '#fff4e4', borderRadius: 999, border: '1px solid #1e1b18', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: step.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card">
                <h3>Campus Peak Hours (BDT UTC+6)</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 170, paddingTop: 12 }}>
                  {(growth.hourlyBdt || []).map((b: any) => {
                    const maxHr = Math.max(1, ...(growth.hourlyBdt || []).map((x: any) => Number(x.count || 0)));
                    const hPct = Math.round((Number(b.count || 0) / maxHr) * 100);
                    return (
                      <div
                        key={b.hour}
                        title={`${b.label} BDT: ${b.count} events`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: `${Math.max(4, hPct)}%`,
                            background: hPct > 65 ? '#ff6b4a' : '#0fb881',
                            border: '1px solid #1e1b18',
                            borderRadius: '4px 4px 0 0'
                          }}
                        />
                        <div className="mono" style={{ fontSize: 9, color: '#575049', marginTop: 4 }}>
                          {b.hour % 3 === 0 ? String(b.hour).padStart(2, '0') : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <h3>Department Breakdown</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {(growth.departments || []).map((d: any) => {
                    const maxD = Math.max(1, ...(growth.departments || []).map((x: any) => Number(x.count || 0)));
                    const pct = Math.round((Number(d.count || 0) / maxD) * 100);
                    return (
                      <div key={d.dept}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                          <span>{d.dept}</span>
                          <span className="mono">{d.count} students</span>
                        </div>
                        <div style={{ height: 8, background: '#fff4e4', borderRadius: 999, border: '1px solid rgba(30,27,24,0.35)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: '#2563eb' }} />
                        </div>
                      </div>
                    );
                  })}
                  {(growth.departments || []).length === 0 && (
                    <div style={{ color: '#575049', fontSize: 13 }}>No department data yet.</div>
                  )}
                </div>
              </div>

              <div className="card">
                <h3>Top Referrers &amp; Invite Links (/b/:code)</h3>
                <table>
                  <thead>
                    <tr><th>Source / Invite</th><th>Clicks / Visits</th></tr>
                  </thead>
                  <tbody>
                    {(growth.topReferrers || []).map((r: any) => (
                      <tr key={`ref_${r.source}`}>
                        <td>{r.source}</td>
                        <td className="mono">{r.count}</td>
                      </tr>
                    ))}
                    {(growth.topInvites || []).map((inv: any) => (
                      <tr key={`inv_${inv.code}`}>
                        <td className="mono">/b/{inv.code}</td>
                        <td className="mono" style={{ color: '#047857' }}>{inv.clicks}</td>
                      </tr>
                    ))}
                    {(growth.topReferrers || []).length === 0 && (growth.topInvites || []).length === 0 && (
                      <tr><td colSpan={2} style={{ color: '#575049' }}>Traffic beacons will populate here as visitors arrive.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CHATS & HUFFMAN TREES */}
        {tab === 'rooms' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Archived Rooms ({rooms.length})</h3>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {([
                    { key: 'all', label: 'All' },
                    { key: 'human', label: 'Human' },
                    { key: 'ai', label: 'AI Companion' },
                    { key: 'encrypted', label: 'Encrypted' }
                  ] as const).map((f) => (
                    <button
                      key={f.key}
                      className={`btn ${roomFilter === f.key ? 'primary' : ''}`}
                      onClick={() => setRoomFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                  <input
                    className="input"
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    placeholder="Search room ID or alias..."
                    style={{ width: 200 }}
                  />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Participants</th>
                      <th>Match</th>
                      <th>Msgs</th>
                      <th>Savings</th>
                      <th>H(X) / L̄</th>
                      <th>Encryption</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms
                      .filter((r) => {
                        if (roomFilter === 'human' && r.isAiRoom) return false;
                        if (roomFilter === 'ai' && !r.isAiRoom) return false;
                        if (roomFilter === 'encrypted' && !r.encrypted) return false;
                        if (roomSearch.trim()) {
                          const q = roomSearch.toLowerCase();
                          const matchText = `${r.roomId} ${r.user1Alias} ${r.user2Alias}`.toLowerCase();
                          if (!matchText.includes(q)) return false;
                        }
                        return true;
                      })
                      .map((r) => (
                        <tr key={r.roomId}>
                          <td className="mono">{String(r.roomId).slice(0, 8)}...</td>
                          <td>{r.user1Alias} × {r.user2Alias}</td>
                          <td>
                            <span className={`badge ${r.isAiRoom ? 'sky' : 'emerald'}`}>
                              {r.isAiRoom ? 'AI' : 'Human'}
                            </span>
                          </td>
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
                              Decrypt &amp; Tree
                            </button>
                          </td>
                        </tr>
                      ))}
                    {rooms.length === 0 && (
                      <tr><td colSpan={8} style={{ color: '#575049' }}>No archived rooms yet.</td></tr>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Campus Stones Economy &amp; Early-Bird EWU Avatars</h3>
                <span className="badge amber">
                  Total Stones in Circulation: {totalStonesInCirculation} 💎
                </span>
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
                        <span className={`badge ${isFree ? 'emerald' : 'sky'}`}>
                          {isFree ? 'FREE (<20)' : `${av.stone_cost} 💎`}
                        </span>
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
                {earlyBirdAvatars.length === 0 && (
                  <div style={{ color: '#575049', fontSize: 13 }}>No early-bird avatars loaded yet.</div>
                )}
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
                        {rep.overdue24h && (
                          <span className="badge rose" style={{ marginLeft: 4 }}>
                            &gt;24h SLA
                          </span>
                        )}
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
                          {u.is_muted && <span className="badge amber" style={{ marginLeft: 4 }}>Muted</span>}
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
                            <>
                              {u.is_muted ? (
                                <button
                                  className="btn"
                                  onClick={async () => {
                                    await AdminApi.muteUser(auth, u.id, 0);
                                    loadCurrentTab(auth, 'moderation');
                                  }}
                                >
                                  Unmute
                                </button>
                              ) : (
                                <>
                                  <button
                                    className="btn"
                                    onClick={async () => {
                                      await AdminApi.muteUser(auth, u.id, 24);
                                      loadCurrentTab(auth, 'moderation');
                                    }}
                                  >
                                    Mute 24h
                                  </button>
                                  <button
                                    className="btn"
                                    onClick={async () => {
                                      await AdminApi.muteUser(auth, u.id, 168);
                                      loadCurrentTab(auth, 'moderation');
                                    }}
                                  >
                                    Mute 7d
                                  </button>
                                </>
                              )}
                              <button
                                className={`btn ${u.is_banned ? '' : 'danger'}`}
                                onClick={async () => {
                                  await AdminApi.setUserBan(auth, u.id, !u.is_banned);
                                  loadCurrentTab(auth, 'moderation');
                                }}
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
        )}

        {/* TAB 5: SYSTEM HEALTH & CLUSTER GUARDRAILS */}
        {tab === 'system' && systemHealth && (
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
                      <span className={`badge ${n.online ? 'emerald' : 'rose'}`}>
                        {n.online ? 'Online' : 'Offline'}
                      </span>
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
                    <tr><td>Redis Status</td><td><span className={`badge ${systemHealth.redis?.ok ? 'emerald' : 'rose'}`}>{systemHealth.redis?.ok ? 'Connected' : 'Down'}</span></td></tr>
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
                    <tr><td>Huffman Original → Compressed</td><td className="mono">{((systemHealth.supabase?.huffmanStorage?.totalOriginalBytes ?? 0) / 1024).toFixed(1)} KB → {((systemHealth.supabase?.huffmanStorage?.totalCompressedBytes ?? 0) / 1024).toFixed(1)} KB</td></tr>
                    <tr><td>Total Bytes Saved</td><td className="mono" style={{ color: '#047857' }}>{((systemHealth.supabase?.huffmanStorage?.totalBytesSaved ?? 0) / 1024).toFixed(1)} KB ({systemHealth.supabase?.huffmanStorage?.avgSavingsPct ?? 0}% avg)</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
