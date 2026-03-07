'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Investigator {
  personId: string;
  fullName: string;
  normalizedName: string;
  primaryOrg: string | null;
  influenceScore: number;
  trialCount: number;
  publicationCount: number;
  primaryEmail: string | null;
  linkedinUrl: string | null;
  orcid: string | null;
}

function InfluenceBar({ score }: { score: number }) {
  const pct = Math.min(score, 100);
  const color = pct >= 70 ? 'var(--brand-teal)' : pct >= 40 ? '#f59e0b' : 'var(--text-tertiary)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
        width: '64px',
        height: '6px',
        background: 'var(--border-subtle)',
        borderRadius: '3px',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px' }} />
      </div>
      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {score}
      </span>
    </div>
  );
}

export default function InvestigatorsPage() {
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState('0');
  const [limit, setLimit] = useState(50);

  const params = new URLSearchParams({ limit: String(limit), minScore });
  const { data, isLoading } = useSWR<{ investigators: Investigator[]; total: number }>(
    `/api/investigators?${params}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const investigators = data?.investigators ?? [];
  const total = data?.total ?? 0;

  const filtered = search.trim().length >= 2
    ? investigators.filter(inv =>
        inv.fullName.toLowerCase().includes(search.toLowerCase()) ||
        (inv.primaryOrg ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : investigators;

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Investigators
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Key opinion leaders and principal investigators across Alzheimer&apos;s trials
        </p>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '20px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1', minWidth: '240px', maxWidth: '360px' }}>
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or institution..."
            value={search}
            onChange={handleSearch}
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

        {/* Min influence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Min influence:
          </label>
          <select
            value={minScore}
            onChange={e => setMinScore(e.target.value)}
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
            <option value="0">All</option>
            <option value="20">20+</option>
            <option value="40">40+</option>
            <option value="60">60+</option>
            <option value="80">80+</option>
          </select>
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {isLoading ? 'Loading...' : `${filtered.length} of ${total} investigators`}
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
              {['Investigator', 'Institution', 'Trials', 'Influence', 'Contact'].map(h => (
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
                  Loading investigators...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
                  No investigators found
                </td>
              </tr>
            ) : (
              filtered.map((inv, i) => (
                <tr
                  key={inv.personId}
                  style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Name */}
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/investigators/${inv.personId}`} style={{
                      fontSize: '14px',
                      fontWeight: 500,
                      color: 'var(--brand-teal)',
                      textDecoration: 'none',
                    }}>
                      {inv.fullName}
                    </Link>
                    {inv.orcid && (
                      <span style={{
                        marginLeft: '8px',
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        fontFamily: 'monospace',
                      }}>
                        ORCID
                      </span>
                    )}
                  </td>

                  {/* Institution */}
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {inv.primaryOrg ?? '—'}
                    </span>
                  </td>

                  {/* Trials */}
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '28px',
                      height: '20px',
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}>
                      {inv.trialCount}
                    </span>
                  </td>

                  {/* Influence */}
                  <td style={{ padding: '12px 16px' }}>
                    <InfluenceBar score={inv.influenceScore} />
                  </td>

                  {/* Contact */}
                  <td style={{ padding: '12px 16px' }}>
                    {inv.primaryEmail ? (
                      <a
                        href={`mailto:${inv.primaryEmail}`}
                        style={{ fontSize: '12px', color: 'var(--brand-teal)', textDecoration: 'none', fontFamily: 'monospace' }}
                      >
                        {inv.primaryEmail}
                      </a>
                    ) : inv.linkedinUrl ? (
                      <a
                        href={inv.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '12px', color: 'var(--text-tertiary)', textDecoration: 'none' }}
                      >
                        LinkedIn
                      </a>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {!isLoading && filtered.length >= limit && (
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            onClick={() => setLimit(l => l + 50)}
            style={{
              padding: '8px 20px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'white',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Load more
          </button>
        </div>
      )}
    </main>
  );
}
