import React from 'react';

interface GrowthTabProps {
  growth: any;
  growthDays: number;
  onChangeDays: (days: number) => void;
}

export function GrowthTab({ growth, growthDays, onChangeDays }: GrowthTabProps) {
  if (!growth) return null;
  const maxFunnel = Math.max(
    1,
    growth.funnel?.landingViews || 0,
    growth.funnel?.verifiedStudents || 0,
    growth.funnel?.completedChats || 0
  );
  const maxHr = Math.max(1, ...(growth.hourlyBdt || []).map((x: any) => Number(x.count || 0)));
  const maxDept = Math.max(1, ...(growth.departments || []).map((x: any) => Number(x.count || 0)));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#575049' }}>Window:</span>
        {[7, 14, 30].map((d) => (
          <button key={d} className={`btn ${growthDays === d ? 'primary' : ''}`} onClick={() => onChangeDays(d)}>
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
              const pct = Math.round((Number(d.count || 0) / maxDept) * 100);
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
              <tr>
                <th>Source / Invite</th>
                <th>Clicks / Visits</th>
              </tr>
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
                <tr>
                  <td colSpan={2} style={{ color: '#575049' }}>Traffic beacons will populate here as visitors arrive.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
