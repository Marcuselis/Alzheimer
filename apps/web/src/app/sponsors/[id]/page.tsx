'use client';

import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface SponsorTrial {
  nctId: string;
  title: string;
  phase: string;
  status: string;
  enrollment: number | null;
  opportunityScore: number | null;
}

interface SponsorInvestigator {
  personId: string;
  fullName: string;
  influenceScore: number;
  trialCount: number;
  primaryOrg: string | null;
  primaryEmail: string | null;
}

interface PhaseBreakdown {
  phase: string;
  count: number;
}

interface SponsorDetail {
  id: string;
  name: string;
  trialCount: number;
  activeTrialCount: number;
  phase3Count: number;
  recruitingCount: number;
  trials: SponsorTrial[];
  investigators: SponsorInvestigator[];
  phases: PhaseBreakdown[];
  countries: string[];
  interventions: string[];
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const isRecruiting = s === 'recruiting';
  const isActive = s.includes('active');
  const color = isRecruiting ? '#16a34a' : isActive ? '#2563eb' : 'var(--text-tertiary)';
  const bg = isRecruiting ? 'rgba(22, 163, 74, 0.1)' : isActive ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-subtle)';
  return (
    <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: bg, color }}>
      {status}
    </span>
  );
}

function PhaseTag({ phase }: { phase: string }) {
  if (!phase) return null;
  const isP3 = phase.includes('3') || phase.includes('III');
  const isP2 = phase.includes('2') || phase.includes('II');
  return (
    <span style={{
      padding: '2px 7px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 600,
      background: isP3 ? 'rgba(20, 184, 166, 0.12)' : isP2 ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-subtle)',
      color: isP3 ? 'var(--brand-teal)' : isP2 ? '#d97706' : 'var(--text-tertiary)',
    }}>
      {phase}
    </span>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>—</span>;
  const color = score >= 70 ? 'var(--brand-teal)' : score >= 45 ? '#f59e0b' : 'var(--text-tertiary)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: 700,
      background: 'var(--bg-subtle)',
      color,
    }}>
      {score}
    </span>
  );
}

export default function SponsorDetailPage({ params }: { params: { id: string } }) {
  const { data: sponsor, isLoading } = useSWR<SponsorDetail>(
    `/api/sponsors/${encodeURIComponent(params.id)}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>Loading...</div>
      </main>
    );
  }

  if (!sponsor || (sponsor as any).error) {
    return (
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>Sponsor not found.</div>
        <Link href="/sponsors" style={{ color: 'var(--brand-teal)', fontSize: '14px' }}>Back to sponsors</Link>
      </main>
    );
  }

  const recruitingTrials = sponsor.trials.filter(t => t.status.toLowerCase() === 'recruiting');
  const topInvestigators = [...sponsor.investigators].sort((a, b) => b.influenceScore - a.influenceScore).slice(0, 10);

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: '20px' }}>
        <Link href="/sponsors" style={{ fontSize: '13px', color: 'var(--text-tertiary)', textDecoration: 'none' }}>
          Sponsors
        </Link>
        <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', margin: '0 6px' }}>/</span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{sponsor.name}</span>
      </div>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>
          {sponsor.name}
        </h1>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {[
            { label: 'Total Trials', value: sponsor.trialCount },
            { label: 'Recruiting', value: sponsor.recruitingCount, highlight: sponsor.recruitingCount > 0 },
            { label: 'Phase 3', value: sponsor.phase3Count, highlight: sponsor.phase3Count > 0 },
            { label: 'Investigators', value: sponsor.investigators.length },
            { label: 'Countries', value: sponsor.countries.length },
          ].map(stat => (
            <div key={stat.label} style={{
              padding: '12px 16px',
              background: 'white',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              minWidth: '100px',
            }}>
              <div style={{
                fontSize: '22px',
                fontWeight: 700,
                color: stat.highlight ? 'var(--brand-teal)' : 'var(--text-primary)',
              }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Trials table */}
          <section>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
              Trials
              <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 400, color: 'var(--text-tertiary)' }}>
                ({sponsor.trials.length})
              </span>
            </h2>
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                    {['NCT ID', 'Title', 'Phase', 'Status', 'Enrollment', 'Score'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'left' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sponsor.trials.map((trial, i) => (
                    <tr
                      key={trial.nctId}
                      style={{ borderBottom: i < sponsor.trials.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <Link href={`/trials/${trial.nctId}`} style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--brand-teal)', textDecoration: 'none' }}>
                          {trial.nctId}
                        </Link>
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: '320px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {trial.title}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <PhaseTag phase={trial.phase} />
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <StatusBadge status={trial.status} />
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {trial.enrollment?.toLocaleString() ?? '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <ScoreBadge score={trial.opportunityScore} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Investigators */}
          {topInvestigators.length > 0 && (
            <section>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                Key Investigators
                <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 400, color: 'var(--text-tertiary)' }}>
                  ({sponsor.investigators.length})
                </span>
              </h2>
              <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                      {['Name', 'Institution', 'Trials', 'Influence', 'Contact'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', textAlign: 'left' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topInvestigators.map((inv, i) => (
                      <tr
                        key={inv.personId}
                        style={{ borderBottom: i < topInvestigators.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '10px 12px' }}>
                          <Link href={`/investigators/${inv.personId}`} style={{ fontSize: '13px', fontWeight: 500, color: 'var(--brand-teal)', textDecoration: 'none' }}>
                            {inv.fullName}
                          </Link>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {inv.primaryOrg ?? '—'}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {inv.trialCount}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {inv.influenceScore}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {inv.primaryEmail ? (
                            <a href={`mailto:${inv.primaryEmail}`} style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--brand-teal)', textDecoration: 'none' }}>
                              {inv.primaryEmail}
                            </a>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Phase breakdown */}
          {sponsor.phases.length > 0 && (
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                Phase Breakdown
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sponsor.phases.map(p => {
                  const maxCount = Math.max(...sponsor.phases.map(x => x.count));
                  const pct = Math.round((p.count / maxCount) * 100);
                  return (
                    <div key={p.phase}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{p.phase}</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.count}</span>
                      </div>
                      <div style={{ height: '4px', background: 'var(--bg-subtle)', borderRadius: '2px' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brand-teal)', borderRadius: '2px' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recruiting now */}
          {recruitingTrials.length > 0 && (
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                Actively Recruiting
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recruitingTrials.slice(0, 8).map(t => (
                  <Link
                    key={t.nctId}
                    href={`/trials/${t.nctId}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <div style={{ padding: '8px', borderRadius: '6px', background: 'var(--bg-subtle)' }}>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--brand-teal)', marginBottom: '2px' }}>
                        {t.nctId}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {t.title}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Countries */}
          {sponsor.countries.length > 0 && (
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                Countries ({sponsor.countries.length})
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {sponsor.countries.map(c => (
                  <span key={c} style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                  }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Molecules / Interventions */}
          {sponsor.interventions.length > 0 && (
            <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                Molecules & Interventions
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sponsor.interventions.slice(0, 10).map((intervention, i) => (
                  <span key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {intervention}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
