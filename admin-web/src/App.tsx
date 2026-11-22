import React, { useEffect, useState } from 'react';
import {
  Activity,
  Binary,
  Cpu,
  Download,
  LogOut,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { AdminApi, AdminAuth, supabase } from './api';
import { OverviewTab } from './components/tabs/OverviewTab';
import { GrowthTab } from './components/tabs/GrowthTab';
import { RoomsTab } from './components/tabs/RoomsTab';
import { ContentTab } from './components/tabs/ContentTab';
import { AlgorithmsTab } from './components/tabs/AlgorithmsTab';
import { ModerationTab } from './components/tabs/ModerationTab';
import { SystemHealthTab } from './components/tabs/SystemHealthTab';

type TabKey = 'overview' | 'growth' | 'rooms' | 'content' | 'algorithms' | 'moderation' | 'system';

const TAB_TITLES: Record<TabKey, string> = {
  overview: 'Live Campus Overview',
  growth: 'Website Traffic, Funnel & Retention',
  rooms: 'Encrypted Chat Archives & Canonical Huffman Trees',
  content: 'Dynamic Bench Topic, Economy & Reward Campaigns',
  algorithms: 'CSE246 Live Algorithm Workflows',
  moderation: 'Abuse Reports, Moderation & Audit Log',
  system: 'System Health, AI Cluster & Free-Tier Guardrails'
};

export default function App() {
  const [auth, setAuth] = useState<AdminAuth | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSetupMsg, setPasswordSetupMsg] = useState('');

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [growth, setGrowth] = useState<any>(null);
  const [growthDays, setGrowthDays] = useState<number>(14);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [selectedUserProfile, setSelectedUserProfile] = useState<any>(null);
  const [earlyBirdAvatars, setEarlyBirdAvatars] = useState<any[]>([]);
  const [totalStonesInCirculation, setTotalStonesInCirculation] = useState<number>(0);
  const [pushSubscribersCount, setPushSubscribersCount] = useState<number>(0);

  const [walletStones, setWalletStones] = useState(13);
  const [targetStones, setTargetStones] = useState(12);
  const [sampleMsg, setSampleMsg] = useState('call me at zero one seven 8 9 1 2 3 4 5 6 later');
  const [workflows, setWorkflows] = useState<any>(null);
  const [topicDraft, setTopicDraft] = useState('');
  const [campaigns, setCampaigns] = useState<any[]>([]);

  useEffect(() => {
    if (!supabase) return;
    const applySession = (session: any) => {
      if (session?.access_token) {
        setAuth({ bearerToken: session.access_token, email: session.user.email });
        if (!session.user.user_metadata?.has_admin_password) setNeedsPasswordSetup(true);
      }
    };
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
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
        setRooms((await AdminApi.getRooms(currentAuth, 50)).rooms || []);
      } else if (targetTab === 'content') {
        const res = await AdminApi.getContent(currentAuth);
        setTopicDraft(res.todaysBenchTopic || '');
        setCampaigns(res.campaigns || []);
        setEarlyBirdAvatars(res.earlyBirdAvatars || []);
        setTotalStonesInCirculation(Number(res.totalStonesInCirculation || 0));
        setPushSubscribersCount(Number(res.pushSubscribersCount || 0));
      } else if (targetTab === 'algorithms') {
        setWorkflows(await AdminApi.getAlgorithmWorkflows(currentAuth, walletStones, targetStones, sampleMsg));
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
    if (auth) loadCurrentTab(auth, tab);
  }, [auth, tab]);

  useEffect(() => {
    if (!auth || !autoRefresh) return;
    const id = window.setInterval(() => loadCurrentTab(auth, tab), 15000);
    return () => window.clearInterval(id);
  }, [auth, autoRefresh, tab, growthDays]);

  async function handleInspectRoom(roomId: string) {
    if (!auth) return;
    setLoading(true);
    setError('');
    try {
      setSelectedRoom(await AdminApi.inspectRoom(auth, roomId));
    } catch (e: any) {
      setError(e.message || 'Failed to inspect room');
    } finally {
      setLoading(false);
    }
  }

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
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), overview: ov, growth: gr, systemHealth: sh }, null, 2)], {
        type: 'application/json'
      });
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

  async function handleSupabasePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!supabase) return setError('Supabase environment variables are not configured.');
    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) return setError(authErr.message);
    if (data.session?.access_token) {
      setAuth({ bearerToken: data.session.access_token, email: data.session.user.email });
      setNeedsPasswordSetup(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    if (!supabase) return setError('Supabase environment variables are not configured.');
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
    if (newPassword.length < 8) return setPasswordSetupMsg('Password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setPasswordSetupMsg('Passwords do not match.');
    const { error: updErr } = await supabase.auth.updateUser({ password: newPassword, data: { has_admin_password: true } });
    if (updErr) setPasswordSetupMsg(updErr.message);
    else {
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
              <button className="btn primary" type="button" onClick={handleGoogleLogin} style={{ width: '100%', padding: '12px 16px', fontSize: 15 }}>
                Sign in with Google
              </button>
              <button className="btn" type="button" onClick={() => { setError(''); setShowPasswordLogin(true); }} style={{ width: '100%', padding: '10px 14px' }}>
                Login with Email &amp; Password
              </button>
            </div>
          ) : (
            <form onSubmit={handleSupabasePasswordLogin} autoComplete="off" style={{ display: 'grid', gap: 10 }}>
              <input className="input" type="email" name="admin_email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Admin email" />
              <input className="input" type="password" name="admin_password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
              <button className="btn primary" type="submit" style={{ width: '100%', padding: '11px 14px' }}>Sign In</button>
              <button className="btn" type="button" onClick={() => { setError(''); setShowPasswordLogin(false); }} style={{ width: '100%' }}>← Back to Google Sign-In</button>
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
            <div style={{ fontSize: 11, color: '#575049' }}>CSE246 &amp; Moderation</div>
          </div>
        </div>
        <button className={`nav-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}><Activity size={16} /> Overview</button>
        <button className={`nav-btn ${tab === 'growth' ? 'active' : ''}`} onClick={() => setTab('growth')}><TrendingUp size={16} /> Growth &amp; Traffic</button>
        <button className={`nav-btn ${tab === 'rooms' ? 'active' : ''}`} onClick={() => setTab('rooms')}><Binary size={16} /> Chats &amp; Huffman Trees</button>
        <button className={`nav-btn ${tab === 'content' ? 'active' : ''}`} onClick={() => setTab('content')}><Sparkles size={16} /> Topics &amp; Campaigns</button>
        <button className={`nav-btn ${tab === 'algorithms' ? 'active' : ''}`} onClick={() => setTab('algorithms')}><Cpu size={16} /> Algorithm Workflows</button>
        <button className={`nav-btn ${tab === 'moderation' ? 'active' : ''}`} onClick={() => setTab('moderation')}><ShieldAlert size={16} /> Reports &amp; Users</button>
        <button className={`nav-btn ${tab === 'system' ? 'active' : ''}`} onClick={() => setTab('system')}><Server size={16} /> System Health</button>
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid rgba(30,27,24,0.12)' }}>
          <div className="mono" style={{ fontSize: 11, color: '#575049', marginBottom: 8, wordBreak: 'break-all' }}>{auth.email}</div>
          <button className="nav-btn" onClick={handleSignOut}><LogOut size={15} /> Sign Out</button>
        </div>
      </aside>

      <main className="main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{TAB_TITLES[tab]}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className={`btn ${autoRefresh ? 'primary' : ''}`} type="button" onClick={() => setAutoRefresh((v) => !v)}>
              {autoRefresh ? '● Live 15s ON' : 'Live 15s: OFF'}
            </button>
            <button className="btn" type="button" onClick={handleExportJson} disabled={loading}>
              <Download size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Export JSON
            </button>
            <button className="btn" onClick={() => loadCurrentTab(auth, tab)} disabled={loading}>
              <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} /> {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <div className="badge rose" style={{ marginBottom: 16 }}>{error}</div>}

        {needsPasswordSetup && auth.bearerToken && (
          <div className="card" style={{ marginBottom: 18, borderColor: '#1e1b18' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Set an Admin Password for Quick Sign-In</h3>
              <button className="btn" type="button" onClick={() => setNeedsPasswordSetup(false)}>Skip for now</button>
            </div>
            <p style={{ color: '#575049', fontSize: 13, marginTop: 0 }}>
              You signed in without a password. Set a password now so you can log in directly next time.
            </p>
            {passwordSetupMsg && <div className="badge rose" style={{ marginBottom: 10 }}>{passwordSetupMsg}</div>}
            <form onSubmit={handleSetAdminPassword} autoComplete="off" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 8 chars)" style={{ flex: 1, minWidth: 200 }} />
              <input className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" style={{ flex: 1, minWidth: 200 }} />
              <button className="btn primary" type="submit">Save Password</button>
            </form>
          </div>
        )}

        {tab === 'overview' && <OverviewTab overview={overview} />}
        {tab === 'growth' && <GrowthTab growth={growth} growthDays={growthDays} onChangeDays={(d) => { setGrowthDays(d); loadCurrentTab(auth, 'growth', d); }} />}
        {tab === 'rooms' && <RoomsTab rooms={rooms} selectedRoom={selectedRoom} onInspectRoom={handleInspectRoom} />}
        {tab === 'content' && (
          <ContentTab
            auth={auth}
            topicDraft={topicDraft}
            setTopicDraft={setTopicDraft}
            campaigns={campaigns}
            earlyBirdAvatars={earlyBirdAvatars}
            totalStonesInCirculation={totalStonesInCirculation}
            pushSubscribersCount={pushSubscribersCount}
            onReload={() => loadCurrentTab(auth, 'content')}
            onError={setError}
          />
        )}
        {tab === 'algorithms' && (
          <AlgorithmsTab
            walletStones={walletStones}
            setWalletStones={setWalletStones}
            targetStones={targetStones}
            setTargetStones={setTargetStones}
            sampleMsg={sampleMsg}
            setSampleMsg={setSampleMsg}
            workflows={workflows}
            onRun={() => loadCurrentTab(auth, 'algorithms')}
          />
        )}
        {tab === 'moderation' && (
          <ModerationTab
            auth={auth}
            reports={reports}
            users={users}
            auditLogs={auditLogs}
            selectedUserProfile={selectedUserProfile}
            setSelectedUserProfile={setSelectedUserProfile}
            onReload={() => loadCurrentTab(auth, 'moderation')}
            onInspectRoom={(roomId) => { setTab('rooms'); handleInspectRoom(roomId); }}
            onError={setError}
            setLoading={setLoading}
          />
        )}
        {tab === 'system' && <SystemHealthTab systemHealth={systemHealth} />}
      </main>
    </div>
  );
}
