'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface DataQualityStats {
  enrichmentCoverage: {
    totalTrials: number;
    enrichedTrials: number;
    coveragePct: number;
    trialsWithContacts: number;
    totalContacts: number;
    trialsWithVerifiedEmail: number;
  };
  verificationBreakdown: { status: string; count: number; pct: number }[];
  catchAllStats: {
    totalDomains: number;
    catchAllDomains: number;
    catchAllEmails: number;
    catchAllPct: number;
  };
  duplicateStats: {
    totalPeople: number;
    canonicalPeople: number;
    aliasedPeople: number;
    avgTrialsPerPerson: number;
  };
  enrichmentQueue: {
    pending: number;
    running: number;
    done: number;
    failed: number;
    staleDone: number;
  };
  topCatchAllDomains: { domain: string; count: number }[];
  recentJobs: {
    nctId: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    contactsFound: number;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  published: '#16a34a',
  verified: 'var(--brand-teal)',
  inferred: '#f59e0b',
  catch_all: '#f97316',
  rejected: '#ef4444',
  unknown: 'var(--text-tertiary)',
};

const STATUS_BG: Record<string, string> = {
  published: 'rgba(22, 163, 74, 0.1)',
  verified: 'rgba(20, 184, 166, 0.1)',
  inferred: 'rgba(245, 158, 11, 0.1)',
  catch_all: 'rgba(249, 115, 22, 0.1)',
  rejected: 'rgba(239, 68, 68, 0.1)',
  unknown: 'var(--bg-subtle)',
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <div style={{ fontSize: '24px', fontWeight: 700, color: color ?? 'var(--text-primary)' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Coverage</span>
        <span style={{ fontSize: '12px', fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div style={{ height: '8px', background: 'var(--bg-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DataQualityPage() {
  const { data, isLoading, mutate } = useSWR<DataQualityStats>(
    '/api/admin/data-quality',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30000 }
  );

  if (isLoading) {
    return (
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>Loading...</div>
      </main>
    );
  }

  if (!data || (data as any).error) {
    return (
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ color: '#ef4444', fontSize: '14px' }}>Failed to load data quality stats.</div>
      </main>
    );
  }

  const { enrichmentCoverage: cov, verificationBreakdown, catchAllStats, duplicateStats, enrichmentQueue, topCatchAllDomains, recentJobs } = data;
  const totalEmails = verificationBreakdown.reduce((s, r) => s + r.count, 0);

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Data Quality
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Enrichment coverage, contact verification, and pipeline health
          </p>
        </div>
        <button
          onClick={() => mutate()}
          style={{
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            borderRadius: '6px',
            border: '1px solid var(--border-subtle)',
            background: 'white',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Coverage overview */}
      <section style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Enrichment Coverage
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          <StatCard label="Total Trials" value={cov.totalTrials} />
          <StatCard label="Enriched Trials" value={cov.enrichedTrials} color="var(--brand-teal)"
            sub={`${cov.coveragePct}% coverage`} />
          <StatCard label="Trials with Contacts" value={cov.trialsWithContacts} />
          <StatCard label="Total Email Contacts" value={cov.totalContacts} />
          <StatCard label="Verified Emails" value={cov.trialsWithVerifiedEmail}
            sub="trials with published/verified email" color="#16a34a" />
        </div>
        <div style={{
          background: 'white',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '16px',
          marginTop: '12px',
        }}>
          <CoverageBar pct={cov.coveragePct} />
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '28px' }}>

        {/* Verification breakdown */}
        <section>
          <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Email Verification Breakdown
          </h2>
          <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Status', 'Count', 'Share'].map(h => (
                    <th key={h} style={{ padding: '8px 14px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {verificationBreakdown.map((row, i) => (
                  <tr key={row.status} style={{ borderBottom: i < verificationBreakdown.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: STATUS_BG[row.status] ?? 'var(--bg-subtle)',
                        color: STATUS_COLORS[row.status] ?? 'var(--text-secondary)',
                      }}>
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {row.count.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '4px', background: 'var(--bg-subtle)', borderRadius: '2px', minWidth: '60px' }}>
                          <div style={{
                            width: `${row.pct}%`,
                            height: '100%',
                            background: STATUS_COLORS[row.status] ?? 'var(--text-tertiary)',
                            borderRadius: '2px',
                          }} />
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '32px', textAlign: 'right' }}>{row.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-subtle)' }}>
                  <td style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Total</td>
                  <td style={{ padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{totalEmails.toLocaleString()}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Queue stats */}
          <section>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Enrichment Queue
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[
                { label: 'Pending', value: enrichmentQueue.pending, color: '#f59e0b' },
                { label: 'Running', value: enrichmentQueue.running, color: '#2563eb' },
                { label: 'Done (30d)', value: enrichmentQueue.done, color: '#16a34a' },
                { label: 'Failed', value: enrichmentQueue.failed, color: '#ef4444' },
                { label: 'Stale (>30d)', value: enrichmentQueue.staleDone, color: 'var(--text-tertiary)' },
              ].map(s => (
                <div key={s.label} style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Catch-all stats */}
          <section>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Catch-All Domains
            </h2>
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#f97316' }}>{catchAllStats.catchAllDomains}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>of {catchAllStats.totalDomains} domains</div>
                </div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#f97316' }}>{catchAllStats.catchAllPct}%</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>emails unreliable</div>
                </div>
              </div>
              {topCatchAllDomains.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                    Top catch-all domains
                  </div>
                  {topCatchAllDomains.map(d => (
                    <div key={d.domain} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{d.domain}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>{d.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Identity / dedup stats */}
          <section>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Person Identity
            </h2>
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>{duplicateStats.totalPeople}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>total person records</div>
                </div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--brand-teal)' }}>{duplicateStats.canonicalPeople}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>canonical (deduplicated)</div>
                </div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b' }}>{duplicateStats.aliasedPeople}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>resolved as aliases</div>
                </div>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>{duplicateStats.avgTrialsPerPerson}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>avg trials / person</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Recent enrichment jobs */}
      <section>
        <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Recent Enrichment Jobs
        </h2>
        <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                {['NCT ID', 'Status', 'Contacts Found', 'Started', 'Finished'].map(h => (
                  <th key={h} style={{ padding: '8px 14px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    No enrichment jobs yet
                  </td>
                </tr>
              ) : recentJobs.map((job, i) => (
                <tr key={job.nctId + job.startedAt} style={{ borderBottom: i < recentJobs.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <a href={`/trials/${job.nctId}`} style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--brand-teal)', textDecoration: 'none' }}>
                      {job.nctId}
                    </a>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      background: job.status === 'done' ? 'rgba(22, 163, 74, 0.1)'
                        : job.status === 'running' ? 'rgba(37, 99, 235, 0.1)'
                        : job.status === 'failed' ? 'rgba(239, 68, 68, 0.1)'
                        : 'var(--bg-subtle)',
                      color: job.status === 'done' ? '#16a34a'
                        : job.status === 'running' ? '#2563eb'
                        : job.status === 'failed' ? '#ef4444'
                        : 'var(--text-secondary)',
                    }}>
                      {job.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: 600, color: job.contactsFound > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                    {job.contactsFound}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {timeAgo(job.startedAt)}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {timeAgo(job.finishedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
