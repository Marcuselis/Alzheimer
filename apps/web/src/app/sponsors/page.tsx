'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface SponsorSummary {
  id: string;
  name: string;
  trialCount: number;
  activeTrialCount: number;
  phase3Count: number;
  recruitingCount: number;
  topPhase: string | null;
}

function PhaseTag({ phase }: { phase: string | null }) {
  if (!phase) return null;
  const isP3 = phase.includes('3') || phase.includes('III');
  const isP2 = phase.includes('2') || phase.includes('II');
  return (
    <span style={{
      display: 'inline-block',
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

export default function SponsorsPage() {
  const [search, setSearch] = useState('');
  const [minTrials, setMinTrials] = useState('1');

  const params = new URLSearchParams({ limit: '150', minTrials });
  if (search.trim().length >= 2) params.set('search', search.trim());

  const { data, isLoading } = useSWR<{ sponsors: SponsorSummary[]; total: number }>(
    `/api/sponsors?${params}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const sponsors = data?.sponsors ?? [];

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Sponsors
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Pharmaceutical companies and academic institutions running Alzheimer&apos;s trials
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '240px', maxWidth: '360px' }}>
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search sponsors..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              height: '34px',
              padding: '0 12px 0 32px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-subtle)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--brand-teal)'; e.currentTarget.style.background = 'white'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--bg-subtle)'; }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Min trials:
          </label>
          <select
            value={minTrials}
            onChange={e => setMinTrials(e.target.value)}
            style={{
              height: '34px',
              padding: '0 8px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-subtle)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <option value="1">All</option>
            <option value="3">3+</option>
            <option value="5">5+</option>
            <option value="10">10+</option>
          </select>
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {isLoading ? 'Loading...' : `${sponsors.length} sponsors`}
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'white',
        border: '1px solid var(--border-subtle)',
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
              {['Sponsor', 'Top Phase', 'Trials', 'Recruiting', 'Phase 3'].map(h => (
                <th key={h} style={{
                  padding: '10px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-tertiary)',
                  textAlign: 'left',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
                  Loading sponsors...
                </td>
              </tr>
            ) : sponsors.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
                  No sponsors found
                </td>
              </tr>
            ) : (
              sponsors.map((s, i) => (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: i < sponsors.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/sponsors/${encodeURIComponent(s.id)}`} style={{
                      fontSize: '14px',
                      fontWeight: 500,
                      color: 'var(--brand-teal)',
                      textDecoration: 'none',
                    }}>
                      {s.name}
                    </Link>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <PhaseTag phase={s.topPhase} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.trialCount}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {s.recruitingCount > 0 ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#16a34a',
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                        {s.recruitingCount}
                      </span>
                    ) : (
                      <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {s.phase3Count > 0 ? (
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--brand-teal)' }}>
                        {s.phase3Count}
                      </span>
                    ) : (
                      <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
