'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvestigatorProfile {
  personId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  primaryRole: string;
  influenceScore: number;
  trialCount: number;
  publicationCount: number;
  orcid: string | null;
  primaryOrganization: string | null;
  trials: { nctId: string; title: string; sponsor: string; phase: string; status: string }[];
  sponsors: string[];
}

interface InvestigatorContact {
  id: string;
  investigatorId: string;
  type: string;
  value: string;
  status: 'published' | 'verified' | 'inferred' | 'catch_all' | 'rejected' | 'unknown' | 'matched' | 'possible';
  sourceType: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  confidence: number;
  isPrimary: boolean;
  visible: boolean;
  mxValid: boolean | null;
  catchAll: boolean | null;
}

interface EnrichmentStatus {
  investigatorId: string;
  status: 'not_started' | 'queued' | 'running' | 'done' | 'partial' | 'failed';
  contactsFound: number;
  lastRunAt: string | null;
  errorMessage: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json());

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  published:  { label: 'Published',  color: '#166534', bg: '#dcfce7' },
  verified:   { label: 'Verified',   color: '#1e40af', bg: '#dbeafe' },
  matched:    { label: 'Matched',    color: '#0f766e', bg: '#ccfbf1' },
  possible:   { label: 'Possible',   color: '#475569', bg: '#e2e8f0' },
  inferred:   { label: 'Inferred',   color: '#92400e', bg: '#fef3c7' },
  catch_all:  { label: 'Catch-all',  color: '#9a3412', bg: '#ffedd5' },
  rejected:   { label: 'Rejected',   color: '#991b1b', bg: '#fee2e2' },
  unknown:    { label: 'Unverified', color: '#374151', bg: '#f3f4f6' },
};

function VerificationBadge({ status }: { status: InvestigatorContact['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

function InfluenceBar({ score }: { score: number }) {
  const color = score >= 60 ? '#16a34a' : score >= 30 ? '#d97706' : '#9ca3af';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Influence score</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color }}>{score}/100</span>
      </div>
      <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function PhaseTag({ phase }: { phase: string }) {
  const p = (phase || '').toLowerCase();
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap',
      background: p.includes('3') ? '#f0fdf4' : p.includes('2') ? '#eff6ff' : '#f9fafb',
      color: p.includes('3') ? '#166534' : p.includes('2') ? '#1d4ed8' : '#6b7280',
    }}>
      {phase || '—'}
    </span>
  );
}

// ── Contacts section ──────────────────────────────────────────────────────────

function ContactsSection({
  personId,
  fullName,
  institution,
}: {
  personId: string;
  fullName: string;
  institution: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const { data: contactsData, isLoading: contactsLoading, mutate: refetchContacts } =
    useSWR<{ contacts: InvestigatorContact[]; enrichmentStatus: EnrichmentStatus }>(
      `/api/investigators/${personId}/contacts`,
      fetcher,
      { revalidateOnFocus: false }
    );

  const { data: statusData, mutate: refetchStatus } = useSWR<EnrichmentStatus>(
    `/api/investigators/${personId}/enrichment-status`,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: (data) => {
        const s = data?.status ?? contactsData?.enrichmentStatus?.status;
        return s === 'queued' || s === 'running' ? 3000 : 0;
      },
      onSuccess: (data) => {
        if (data?.status === 'done' || data?.status === 'partial') refetchContacts();
      },
    }
  );

  const enrichStatus = statusData ?? contactsData?.enrichmentStatus;
  const contacts = contactsData?.contacts ?? [];
  const emails = contacts.filter(c => c.type === 'email');
  const linkedins = contacts.filter(c => c.type === 'linkedin');
  const websites = contacts.filter(c => c.type === 'website');
  const phones = contacts.filter(c => c.type === 'phone');

  // Priority: published email > verified email > matched LinkedIn > official profile > inferred email > possible website
  const bestPublishedEmail = emails.find(c => c.status === 'published') ?? null;
  const bestVerifiedEmail = emails.find(c => c.status === 'verified') ?? null;
  const bestMatchedLinkedIn = linkedins.find(c => c.status === 'matched') ?? null;
  const bestOfficialProfile = websites.find(c => c.status === 'matched') ?? null;
  const bestInferredEmail = emails.find(c => c.status === 'inferred' || c.status === 'catch_all') ?? null;
  const bestDepartmentFallback = websites.find(c => c.status === 'possible') ?? null;

  const bestContact = bestPublishedEmail
    ?? bestVerifiedEmail
    ?? bestMatchedLinkedIn
    ?? bestOfficialProfile
    ?? bestInferredEmail
    ?? bestDepartmentFallback
    ?? null;

  const isWorking = enrichStatus?.status === 'queued' || enrichStatus?.status === 'running';
  const hasRun = enrichStatus && enrichStatus.status !== 'not_started';

  const triggerEnrich = async () => {
    try {
      await fetch(`/api/investigators/${personId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, institution, topic: 'alzheimer neurology' }),
      });
      refetchStatus();
    } catch (err) {
      console.error('Failed to queue enrichment:', err);
    }
  };

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email).then(() => {
      setCopied(email);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="linear-card" style={{ padding: '18px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Contact
        </div>
        {!isWorking && (
          <button
            onClick={triggerEnrich}
            style={{
              padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '5px',
              border: '1px solid var(--border-subtle)', background: 'white',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {hasRun ? 'Re-check' : 'Find contacts'}
          </button>
        )}
      </div>

      {/* Working indicator */}
      {isWorking && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: '#eff6ff', borderRadius: '6px', marginBottom: '12px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
          <span style={{ fontSize: '12px', color: '#1d4ed8' }}>
            {enrichStatus.status === 'queued' ? 'Queued — waiting for worker...' : 'Searching for contacts...'}
          </span>
        </div>
      )}

      {/* Empty state */}
      {!contactsLoading && !isWorking && contacts.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic', marginBottom: '4px' }}>
          {enrichStatus?.status === 'failed'
            ? `Search failed: ${enrichStatus.errorMessage ?? 'unknown error'}`
            : hasRun
            ? 'No contacts found. Try re-checking.'
            : 'No contact info yet — click Find contacts.'}
        </div>
      )}

      {/* Best contact fallback */}
      {bestContact && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Best contact</div>
          <div style={{ fontFamily: bestContact.type === 'email' ? 'monospace' : 'inherit', fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: '6px' }}>
            {bestContact.type === 'email' ? bestContact.value : bestContact.sourceLabel || bestContact.value}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
            <VerificationBadge status={bestContact.status} />
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
              {bestContact.type}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
              {bestContact.confidence}% confidence
            </span>
            {bestContact.sourceLabel && (
              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                ·{' '}
                {bestContact.sourceUrl
                  ? <a href={bestContact.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-teal)', textDecoration: 'none' }}>{bestContact.sourceLabel}</a>
                  : bestContact.sourceLabel}
              </span>
            )}
          </div>
          {bestContact.type === 'email' && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => copyEmail(bestContact.value)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  background: copied === bestContact.value ? '#f0fdf4' : 'white',
                  color: copied === bestContact.value ? '#16a34a' : 'var(--text-secondary)',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {copied === bestContact.value ? 'Copied!' : 'Copy'}
              </button>
              <a
                href={`mailto:${bestContact.value}`}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: '6px', textAlign: 'center',
                  background: 'var(--brand-teal)', color: 'white',
                  fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                }}
              >
                Send
              </a>
            </div>
          )}
          {bestContact.type !== 'email' && (
            <a
              href={bestContact.value}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                padding: '6px 0',
                borderRadius: '6px',
                background: bestContact.type === 'linkedin' ? '#0077b5' : 'var(--brand-teal)',
                color: 'white',
                fontSize: '11px',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Open {bestContact.type === 'linkedin' ? 'LinkedIn' : 'Profile'}
            </a>
          )}
        </div>
      )}

      {/* LinkedIn */}
      {linkedins[0] && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>LinkedIn</div>
          <a href={linkedins[0].value} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#0077b5', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="#0077b5">
              <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
              <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
            </svg>
            View profile
          </a>
        </div>
      )}

      {/* Profile pages */}
      {websites.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Profile links</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {websites.slice(0, 3).map(w => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <a href={w.value} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: 'var(--brand-teal)', textDecoration: 'none' }}>
                  {w.sourceLabel || 'Open profile'}
                </a>
                <VerificationBadge status={w.status} />
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{w.confidence}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phone */}
      {phones[0] && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Phone</div>
          <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>{phones[0].value}</span>
        </div>
      )}

      {/* Other email candidates */}
      {emails.length > 0 && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Email candidates
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(bestContact?.type === 'email' ? emails.slice(1) : emails).map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span
                  style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-primary)', cursor: 'pointer' }}
                  onClick={() => copyEmail(c.value)}
                  title="Click to copy"
                >
                  {c.value}
                </span>
                <VerificationBadge status={c.status} />
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{c.confidence}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Institution + last checked */}
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
        {institution && (
          <div style={{ marginBottom: '4px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>Institution</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{institution}</div>
          </div>
        )}
        {enrichStatus?.lastRunAt && (
          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
            Last checked {new Date(enrichStatus.lastRunAt).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvestigatorPage({ params }: { params: { personId: string } }) {
  const { personId } = params;

  const { data: profile, isLoading, error } = useSWR<InvestigatorProfile>(
    `/api/investigators/${personId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px', color: 'var(--text-secondary)', fontSize: '14px' }}>
        Loading...
      </div>
    );
  }

  if (error || !profile || (profile as any).error) {
    return (
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px' }}>
        <Link href="/investigators" style={{ color: 'var(--brand-teal)', fontSize: '13px', textDecoration: 'none' }}>← Investigators</Link>
        <div style={{ marginTop: '24px', color: 'var(--text-secondary)' }}>Investigator not found.</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px' }}>
      <Link href="/investigators" style={{ color: 'var(--brand-teal)', fontSize: '13px', textDecoration: 'none' }}>
        ← Investigators
      </Link>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', marginTop: '20px', alignItems: 'start' }}>

        {/* Left: profile + trials */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Header card */}
          <div className="linear-card" style={{ padding: '24px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
              {profile.fullName}
            </h1>
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Principal Investigator
              {profile.primaryOrganization && <> · {profile.primaryOrganization}</>}
            </div>

            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{profile.trialCount}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Trials</div>
              </div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{profile.sponsors.length}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Sponsors</div>
              </div>
            </div>

            <InfluenceBar score={profile.influenceScore} />
          </div>

          {/* Trials */}
          <div className="linear-card" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 14px' }}>
              Trials ({profile.trialCount})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {profile.trials.map(trial => (
                <div
                  key={trial.nctId}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: '7px', gap: '10px' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link
                      href={`/trials/${trial.nctId}`}
                      style={{ fontSize: '13px', fontWeight: 600, color: 'var(--brand-teal)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {trial.title || trial.nctId}
                    </Link>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{trial.sponsor}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexShrink: 0 }}>
                    <PhaseTag phase={trial.phase} />
                    <span style={{ fontSize: '10px', color: trial.status === 'RECRUITING' ? '#16a34a' : '#9ca3af', fontWeight: 600 }}>
                      {trial.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sponsors */}
          {profile.sponsors.length > 0 && (
            <div className="linear-card" style={{ padding: '20px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                Sponsors ({profile.sponsors.length})
              </h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {profile.sponsors.map(s => (
                  <Link
                    key={s}
                    href={`/sponsors/${encodeURIComponent(s)}`}
                    style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', background: 'var(--bg-subtle)', color: 'var(--brand-teal)', border: '1px solid var(--border-subtle)', textDecoration: 'none' }}
                  >
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: contacts sidebar */}
        <div>
          <ContactsSection
            personId={personId}
            fullName={profile.fullName}
            institution={profile.primaryOrganization}
          />
        </div>
      </div>
    </div>
  );
}
