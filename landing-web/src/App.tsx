import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Coffee,
  Dices,
  Flame,
  Gem,
  GraduationCap,
  Lock,
  MessageCircleHeart,
  ShieldCheck,
  Sparkles,
  Users
} from 'lucide-react';

const APP_URL =
  import.meta.env.VITE_APP_URL ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8080'
    : 'https://app.benchly.live');

const API_URL = (
  import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://api.benchly.live')
).replace(/\/$/, '');

const PLAYFUL_ALIASES = [
  'Monsoon Firefly 42',
  'Golden Fuchka 19',
  'Velvet Panther 77',
  'Breezy Otter 64',
  'Caffeinated Fox 28',
  'Sunlit Sparrow 51',
  'Saffron Chai 83',
  'Starlit Heron 36',
  'Mango Nomad 95'
];

export default function App() {
  const [aliasIdx, setAliasIdx] = useState(0);
  const [todaysTopic, setTodaysTopic] = useState(
    'Aftabnagar street food vs Campus Cafeteria: which spot has the best adda vibes?'
  );
  const [campaigns, setCampaigns] = useState<any[]>([]);

  function sendTelemetry(eventType: string, extra?: Record<string, any>) {
    try {
      const params = new URLSearchParams(window.location.search);
      fetch(`${API_URL}/api/telemetry/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          domain: window.location.hostname || 'benchly.live',
          event_type: eventType,
          path: window.location.pathname || '/',
          referrer: document.referrer || null,
          utm_source: params.get('utm_source'),
          invite_code: params.get('invite'),
          platform: 'web',
          ...(extra || {})
        })
      }).catch(() => {});
    } catch {}
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/^\/b\/([a-zA-Z0-9_-]+)/);
    const inviteCode = (pathMatch && pathMatch[1]) || params.get('invite');
    if (inviteCode) {
      sendTelemetry('invite_link_clicked', { invite_code: inviteCode });
      window.location.replace(`${APP_URL}/?invite=${encodeURIComponent(inviteCode)}`);
      return;
    }
    sendTelemetry('landing_view');
    fetch(`${API_URL}/api/campus/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.todaysBenchTopic) setTodaysTopic(data.todaysBenchTopic);
        if (Array.isArray(data.activeCampaigns)) setCampaigns(data.activeCampaigns);
      })
      .catch(() => {});
  }, []);

  function rollAlias() {
    setAliasIdx((prev) => (prev + 1) % PLAYFUL_ALIASES.length);
  }

  return (
    <div>
      {/* Sticky Pill Navbar */}
      <div className="nav-wrap">
        <nav className="nav" aria-label="Primary navigation">
          <a href="#" className="logo">
            <span className="logo-mark">
              <Coffee size={18} strokeWidth={2.5} />
            </span>
            <span>Benchly</span>
          </a>

          <div className="nav-links">
            <a href="#vibes">Adda Vibes</a>
            <a href="#how">How It Works</a>
            <a href="#safety">Campus Safety</a>
          </div>

          <a href={APP_URL} onClick={() => sendTelemetry('cta_open_app', { metadata: { source: 'navbar' } })} className="btn btn-primary btn-sm">
            Open App <ArrowRight size={15} />
          </a>
        </nav>
      </div>

      {/* Hero Section */}
      <main className="container">
        <section className="hero">
          <div>
            <span className="pill">
              <span className="pulse-dot" />
              Exclusively for East West University (@std.ewubd.edu)
            </span>

            <h1>
              Pull up a seat.{' '}
              <span className="highlight-mint">No profiles,</span> just real{' '}
              <span className="highlight-coral">campus adda.</span>
            </h1>

            <p className="hero-sub">
              Meet verified EWU classmates over spontaneous 15-minute chats or 5-person
              Cafeteria Lounges. Keep your alias playful, earn Campus Stones, and only reveal
              who you are when both of you click handshake.
            </p>

            <div className="hero-actions">
              <a href={APP_URL} onClick={() => sendTelemetry('cta_open_app', { metadata: { source: 'hero' } })} className="btn btn-coral">
                Take a Seat on Benchly <ArrowRight size={17} />
              </a>
              <a href="#vibes" className="btn btn-white">
                Explore Vibes
              </a>
            </div>

            {/* Interactive Alias Roller */}
            <div className="alias-toy">
              <span style={{ fontSize: 13, fontWeight: 700, color: '#575049' }}>
                Your mystery alias could be:
              </span>
              <span className="alias-badge">
                <Sparkles size={14} color="#7c3aed" />
                {PLAYFUL_ALIASES[aliasIdx]}
              </span>
              <button
                type="button"
                onClick={rollAlias}
                className="btn btn-white btn-sm"
                style={{ padding: '6px 12px' }}
              >
                <Dices size={14} /> Roll
              </button>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-frame">
              <img
                src="/hero-campus-bench.jpg"
                alt="Two cheerful anonymous East West University students sharing cha on a sunlit campus bench"
              />
            </div>
            <div className="float-chip top-left">
              <Users size={15} color="#0fb881" /> 5-Person Cafeteria Lounges
            </div>
            <div className="float-chip bottom-right">
              <Gem size={15} color="#d97706" /> Daily Streaks & Stones
            </div>
          </div>
        </section>

        {/* Live Dynamic Today's Bench Topic */}
        <section className="topic-banner" aria-label="Today's Bench Topic">
          <div style={{ flex: 1, minWidth: 260 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: '#ff6b4a',
                marginBottom: 4
              }}
            >
              <Flame size={14} /> Today's Live Bench Topic
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontStyle: 'italic' }}>
              “{todaysTopic}”
            </div>
          </div>
          <a href={APP_URL} onClick={() => sendTelemetry('cta_open_app', { metadata: { source: 'topic_banner' } })} className="btn btn-primary btn-sm">
            Join the Adda <ArrowRight size={15} />
          </a>
        </section>

        {/* Active Dynamic Campaigns (if any) */}
        {campaigns.length > 0 && (
          <section className="section" style={{ paddingTop: 0 }}>
            <h2 className="section-title">Live Campus Reward Campaigns</h2>
            <p className="section-sub">
              Active right now on <span style={{ fontWeight: 700 }}>app.benchly.live</span> — complete streaks and collect bonus Campus Stones.
            </p>
            <div className="bento">
              {campaigns.map((c) => (
                <div key={c.id} className="card marigold">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 24 }}>{c.icon_emoji || '⭐'}</span>
                    <span className="pill" style={{ background: '#ffffff' }}>
                      +{c.reward_stones} 💎
                    </span>
                  </div>
                  <h3 style={{ fontSize: 18, marginBottom: 6 }}>{c.title}</h3>
                  <p style={{ margin: '0 0 14px', fontSize: 14, color: '#575049' }}>{c.description}</p>
                  <a href={APP_URL} onClick={() => sendTelemetry('cta_open_app', { metadata: { source: 'campaign_card', campaignId: c.id } })} className="btn btn-white btn-sm">
                    Start Challenge <ArrowRight size={14} />
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Adda Vibes Bento Grid */}
        <section id="vibes" className="section">
          <h2 className="section-title">Pick your vibe. Find your table.</h2>
          <p className="section-sub">
            Whether you need a quick laugh between classes or a midnight Algorithms study partner,
            Benchly matches you smartly—never random chaos.
          </p>

          <div className="bento">
            <div className="card mint">
              <div className="icon-box">
                <Coffee size={21} color="#0fb881" />
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>Campus Adda</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#374151' }}>
                Meet classmates from CSE, BBA, EEE, Pharmacy, Law & more. Fresh perspectives, zero
                awkward social-media pressure.
              </p>
            </div>

            <div className="card marigold">
              <div className="icon-box">
                <GraduationCap size={21} color="#d97706" />
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>Study Buddy</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#374151' }}>
                Match with someone from your own department before midterms, lab finals, or late-night
                assignment sprints.
              </p>
            </div>

            <div className="card sky">
              <div className="icon-box">
                <Users size={21} color="#2563eb" />
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>Cafeteria Group Lounges</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#374151' }}>
                Jump into live 5-student topic tables—from Aftabnagar food debates to CSE lab vents—with
                conflict-free smart seating.
              </p>
            </div>

            <div className="card coral">
              <div className="icon-box">
                <MessageCircleHeart size={21} color="#e11d48" />
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>Mutual Handshake</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#374151' }}>
                Vibing well? Extend your 15-minute bench or tap Handshake together to unlock profiles
                only when both say yes.
              </p>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how" className="section">
          <h2 className="section-title">From bored to chatting in 10 seconds</h2>
          <p className="section-sub">Three tiny steps. Zero profile setup fatigue.</p>

          <div className="steps">
            <div className="card">
              <div className="step-num">1</div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Verify EWU Email</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#575049' }}>
                Sign in with your <span style={{ fontWeight: 700 }}>@std.ewubd.edu</span> account so
                every single seat belongs to a real East West University student.
              </p>
            </div>

            <div className="card">
              <div className="step-num">2</div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Pick a Vibe & Alias</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#575049' }}>
                Roll a charming anonymous nickname, choose 1v1 Bench or a 5-Person Lounge, and earn
                Campus Stones every day you check in.
              </p>
            </div>

            <div className="card">
              <div className="step-num">3</div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Chat, Extend, or Next</h3>
              <p style={{ margin: 0, fontSize: 14.5, color: '#575049' }}>
                Every chat starts with a campus icebreaker. Extend time if the conversation clicks, or
                hop onto a fresh bench anytime.
              </p>
            </div>
          </div>
        </section>

        {/* Safety & Privacy */}
        <section id="safety" className="section">
          <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 22 }}>
            <div>
              <div className="icon-box" style={{ background: '#dcfce7' }}>
                <ShieldCheck size={22} color="#0fb881" />
              </div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Real-Time PII Shield</h3>
              <p style={{ margin: 0, fontSize: 14, color: '#575049' }}>
                Disguised phone numbers, social handles, and spam floods are automatically blocked in
                under a millisecond before mutual handshake.
              </p>
            </div>

            <div>
              <div className="icon-box" style={{ background: '#fef3c7' }}>
                <Lock size={22} color="#d97706" />
              </div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Encrypted Archives</h3>
              <p style={{ margin: 0, fontSize: 14, color: '#575049' }}>
                Concluded sessions are Canonical Huffman compressed and sealed with AES-256-GCM at
                rest—opened only if an abuse report is filed.
              </p>
            </div>

            <div>
              <div className="icon-box" style={{ background: '#ffe4dc' }}>
                <Sparkles size={22} color="#ff6b4a" />
              </div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Girls-Only Safe Queue</h3>
              <p style={{ margin: 0, fontSize: 14, color: '#575049' }}>
                Verified female students can opt into a dedicated Girls-Only queue with locked gender
                verification for extra comfort.
              </p>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="cta-box">
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, marginBottom: 12 }}>
            Ready for a warmer campus adda?
          </h2>
          <p style={{ fontSize: 16.5, color: '#44403c', maxWidth: 520, margin: '0 auto 24px' }}>
            Your bench is waiting at <strong>app.benchly.live</strong>. Grab a virtual cup of cha and
            say hi to someone new today.
          </p>
          <a href={APP_URL} onClick={() => sendTelemetry('cta_open_app', { metadata: { source: 'footer_cta' } })} className="btn btn-primary" style={{ fontSize: 16, padding: '14px 28px' }}>
            Launch app.benchly.live <ArrowRight size={18} />
          </a>
        </section>

        <footer className="footer">
          <div>
            <strong>Benchly</strong> — Built with care for East West University students.
          </div>
          <div style={{ display: 'flex', gap: 18 }}>
            <a href={APP_URL}>app.benchly.live</a>
            <span>•</span>
            <span>benchly.live</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
