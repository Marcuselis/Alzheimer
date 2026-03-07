'use client';

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────────────────────

interface Contact {
  personId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: string;
  organization: string | null;
  domain: string | null;
  email: string | null;
  emailLabel: string | null;
  emailVerificationStatus: string | null;
  emailConfidence: number;
  linkedinUrl: string | null;
  linkedinConfidence: number;
  overallScore: number;
  confidenceLabel: 'high' | 'medium' | 'low';
}

interface EnrichmentJob {
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

interface OpportunityScore {
  score: number;
  phaseScore: number;
  statusScore: number;
  sponsorScore: number;
  investigatorScore: number;
  recencyScore: number;
  explanation: string;
}

interface ContactsResponse {
  nctId: string;
  contacts: Contact[];
  enrichmentJob: EnrichmentJob | null;
  opportunityScore: OpportunityScore | null;
  total: number;
}

interface Trial {
  nct_id: string;
  title: string;
  sponsor: string;
  phase: string;
  status: string;
  enrollment: string;
  locations: string;
  interventions: string;
  principal_investigators?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json());

function verificationBadge(status: string | null, label: string | null) {
  const effective = status || label;
  if (!effective) return null;

  const config: Record<string, { text: string; color: string; bg: string; title: string }> = {
    published:  { text: 'Published',  color: '#276749', bg: '#C6F6D5', title: 'Found verbatim on official institution page' },
    verified:   { text: 'Verified',   color: '#2B6CB0', bg: '#BEE3F8', title: 'Pattern-inferred and confirmed via SMTP check' },
    inferred:   { text: 'Inferred',   color: '#975A16', bg: '#FEFCBF', title: 'Pattern-generated from name + domain. Not confirmed.' },
    catch_all:  { text: 'Catch-all',  color: '#744210', bg: '#FEEBC8', title: 'Domain accepts all addresses — SMTP check unreliable' },
    rejected:   { text: 'Rejected',   color: '#9B2335', bg: '#FED7D7', title: 'SMTP server rejected this address' },
    unknown:    { text: 'Unverified', color: '#4A5568', bg: '#EDF2F7', title: 'Not yet verified' },
  };

  const c = config[effective] ?? config['unknown'];

  return (
    <span
      title={c.title}
      style={{
        fontSize: '10px',
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: '4px',
        background: c.bg,
        color: c.color,
        cursor: 'help',
        whiteSpace: 'nowrap',
      }}
    >
      {c.text}
    </span>
  );
}

function confidenceBadge(label: 'high' | 'medium' | 'low') {
  const map = {
    high:   { text: 'High',   color: '#22543D', bg: '#9AE6B4' },
    medium: { text: 'Medium', color: '#7B341E', bg: '#FBD38D' },
    low:    { text: 'Low',    color: '#63171B', bg: '#FEB2B2' },
  };
  const c = map[label];
  return (
    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: c.bg, color: c.color }}>
      {c.text}
    </span>
  );
}

// ── Opportunity Score Widget ──────────────────────────────────────────────────

function OpportunityScoreWidget({ score }: { score: OpportunityScore }) {
  const color = score.score >= 70 ? '#276749' : score.score >= 45 ? '#975A16' : '#4A5568';
  const bg    = score.score >= 70 ? '#F0FFF4' : score.score >= 45 ? '#FFFBEB' : '#F7FAFC';
  const label = score.score >= 70 ? 'High priority' : score.score >= 45 ? 'Medium priority' : 'Lower priority';

  return (
    <div style={{ background: bg, border: `1px solid ${color}30`, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Opportunity score
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span style={{ fontSize: '22px', fontWeight: 800, color }}>{score.score}</span>
          <span style={{ fontSize: '12px', color: `${color}99` }}>/100</span>
        </div>
      </div>
      <div style={{ height: '5px', background: `${color}20`, borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
        <div style={{ height: '100%', width: `${score.score}%`, background: color, borderRadius: '3px' }} />
      </div>
      <div style={{ fontSize: '11px', color, marginBottom: '6px' }}>{label} · {score.explanation}</div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {[
          { label: 'Phase', val: score.phaseScore, max: 35 },
          { label: 'Status', val: score.statusScore, max: 30 },
          { label: 'Sponsor', val: score.sponsorScore, max: 20 },
          { label: 'Investigators', val: score.investigatorScore, max: 10 },
          { label: 'Recency', val: score.recencyScore, max: 5 },
        ].map(c => (
          <div key={c.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color }}>{c.val}</div>
            <div style={{ fontSize: '9px', color: `${color}80`, textTransform: 'uppercase' }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Contact Card ──────────────────────────────────────────────────────────────

function ContactCard({ contact }: { contact: Contact }) {
  const [copied, setCopied] = useState(false);

  const copyEmail = () => {
    if (!contact.email) return;
    navigator.clipboard.writeText(contact.email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const roleLabel = contact.role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--border-subtle)',
      borderRadius: '10px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div>
          <Link
            href={`/investigators/${contact.personId}`}
            style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', textDecoration: 'none' }}
          >
            {contact.fullName}
          </Link>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {roleLabel}
          </div>
          {contact.organization && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '1px' }}>
              {contact.organization}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {confidenceBadge(contact.confidenceLabel)}
        </div>
      </div>

      {/* Email row */}
      {contact.email && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
            <rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="2,4 12,13 22,4" />
          </svg>
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
            {contact.email}
          </span>
          {verificationBadge(contact.emailVerificationStatus, contact.emailLabel)}
          <button
            onClick={copyEmail}
            title="Copy email"
            style={{
              background: 'none',
              border: '1px solid var(--border-subtle)',
              borderRadius: '5px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              color: copied ? '#38A169' : 'var(--text-secondary)',
              transition: 'color 0.15s',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      {/* Email confidence bar */}
      {contact.email && contact.emailConfidence > 0 && (
        <div>
          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>
            Email confidence: {Math.round(contact.emailConfidence * 100)}%
          </div>
          <div style={{ height: '4px', background: '#EDF2F7', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.round(contact.emailConfidence * 100)}%`,
              background: contact.emailConfidence >= 0.8 ? '#38A169'
                        : contact.emailConfidence >= 0.5 ? '#D69E2E'
                        : '#E53E3E',
              borderRadius: '2px',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {!contact.email && (
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          No email found
        </div>
      )}

      {/* LinkedIn row */}
      {contact.linkedinUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#0077B5">
            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
            <rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>
          </svg>
          <a
            href={contact.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#0077B5', textDecoration: 'none' }}
          >
            LinkedIn profile
          </a>
          {contact.linkedinConfidence > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
              ({Math.round(contact.linkedinConfidence * 100)}% match)
            </span>
          )}
        </div>
      )}

      {/* Source badges */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '2px' }}>
        <span style={{ fontSize: '10px', background: '#EBF8FF', color: '#2B6CB0', padding: '2px 6px', borderRadius: '4px' }}>
          ClinicalTrials.gov
        </span>
        {contact.email && (contact.emailVerificationStatus === 'published' || contact.emailLabel === 'published') && (
          <span style={{ fontSize: '10px', background: '#F0FFF4', color: '#276749', padding: '2px 6px', borderRadius: '4px' }}>
            Staff directory
          </span>
        )}
        {contact.linkedinUrl && (
          <span style={{ fontSize: '10px', background: '#E6F2FF', color: '#1D4E89', padding: '2px 6px', borderRadius: '4px' }}>
            LinkedIn
          </span>
        )}
      </div>
    </div>
  );
}

// ── Contacts Section ──────────────────────────────────────────────────────────

function ContactsSection({ nctId }: { nctId: string }) {
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<ContactsResponse>(
    `/api/trials/${nctId}/contacts`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const isRunning = data?.enrichmentJob?.status === 'running' || data?.enrichmentJob?.status === 'pending';

  // Poll while job is running
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => mutate(), 4000);
    return () => clearInterval(id);
  }, [isRunning, mutate]);

  const triggerEnrichment = async () => {
    setTriggering(true);
    setTriggerMsg(null);
    try {
      const resp = await fetch(`/api/trials/${nctId}/enrich`, { method: 'POST' });
      if (resp.ok) {
        setTriggerMsg('Enrichment queued. Results will appear in a few minutes.');
        setTimeout(() => mutate(), 5000);
      } else {
        setTriggerMsg('Failed to queue enrichment. Is the worker running?');
      }
    } catch {
      setTriggerMsg('Network error. Check that the API is running.');
    } finally {
      setTriggering(false);
    }
  };

  const highContacts = data?.contacts.filter(c => c.confidenceLabel === 'high') ?? [];
  const medContacts  = data?.contacts.filter(c => c.confidenceLabel === 'medium') ?? [];
  const lowContacts  = data?.contacts.filter(c => c.confidenceLabel === 'low') ?? [];

  return (
    <section style={{ marginTop: '32px' }}>
      {/* Section header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Contacts
          </h2>
          {data && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {data.total} person{data.total !== 1 ? 's' : ''} found
              {data.enrichmentJob?.finishedAt && (
                <> &middot; enriched {new Date(data.enrichmentJob.finishedAt).toLocaleDateString()}</>
              )}
            </div>
          )}
        </div>

        <button
          onClick={triggerEnrichment}
          disabled={triggering || isRunning}
          style={{
            background: isRunning ? 'var(--border-subtle)' : 'var(--brand-teal)',
            color: 'white',
            border: 'none',
            borderRadius: '7px',
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: triggering || isRunning ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {isRunning ? (
            <>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Enriching...
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              {data?.total ? 'Re-enrich' : 'Find contacts'}
            </>
          )}
        </button>
      </div>

      {/* Status / feedback */}
      {triggerMsg && (
        <div style={{
          padding: '10px 14px',
          background: triggerMsg.includes('queued') ? '#F0FFF4' : '#FFF5F5',
          border: `1px solid ${triggerMsg.includes('queued') ? '#C6F6D5' : '#FEB2B2'}`,
          borderRadius: '7px',
          fontSize: '13px',
          color: triggerMsg.includes('queued') ? '#276749' : '#9B2335',
          marginBottom: '14px',
        }}>
          {triggerMsg}
        </div>
      )}

      {data?.enrichmentJob?.status === 'error' && (
        <div style={{
          padding: '10px 14px',
          background: '#FFF5F5',
          border: '1px solid #FEB2B2',
          borderRadius: '7px',
          fontSize: '12px',
          color: '#9B2335',
          marginBottom: '14px',
        }}>
          Last enrichment failed: {data.enrichmentJob.error}
        </div>
      )}

      {/* Opportunity score */}
      {data?.opportunityScore && <OpportunityScoreWidget score={data.opportunityScore} />}

      {isLoading && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', padding: '20px 0' }}>Loading contacts...</div>
      )}

      {!isLoading && data?.total === 0 && !isRunning && (
        <div style={{
          padding: '32px',
          textAlign: 'center',
          background: 'var(--bg-subtle)',
          borderRadius: '10px',
          color: 'var(--text-secondary)',
          fontSize: '13px',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '10px' }}>👤</div>
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>No contacts enriched yet</div>
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            Click "Find contacts" to run the enrichment pipeline for this trial.
          </div>
        </div>
      )}

      {/* Contact cards — ranked by confidence */}
      {highContacts.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            High confidence
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {highContacts.map(c => <ContactCard key={c.personId} contact={c} />)}
          </div>
        </div>
      )}

      {medContacts.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Medium confidence
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {medContacts.map(c => <ContactCard key={c.personId} contact={c} />)}
          </div>
        </div>
      )}

      {lowContacts.length > 0 && (
        <details style={{ marginBottom: '20px' }}>
          <summary style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', marginBottom: '10px' }}>
            Low confidence ({lowContacts.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
            {lowContacts.map(c => <ContactCard key={c.personId} contact={c} />)}
          </div>
        </details>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  );
}

// ── Trial Detail Page ─────────────────────────────────────────────────────────

export default function TrialDetailPage({ params }: { params: { nctId: string } }) {
  const { nctId } = params;

  const { data: trialsData, isLoading } = useSWR<{ trials: Trial[] }>(
    `/api/trials?nct=${nctId}`,
    fetcher
  );

  const trial = trialsData?.trials?.[0];

  if (isLoading) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading trial...</div>
      </div>
    );
  }

  if (!trial) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px' }}>
        <Link href="/market-scan" style={{ color: 'var(--brand-teal)', fontSize: '13px', textDecoration: 'none' }}>
          ← Back to Market Scan
        </Link>
        <div style={{ marginTop: '24px', color: 'var(--text-secondary)' }}>
          Trial <strong>{nctId}</strong> not found.
        </div>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    RECRUITING: '#38A169',
    ACTIVE_NOT_RECRUITING: '#D69E2E',
    COMPLETED: '#718096',
    TERMINATED: '#E53E3E',
    WITHDRAWN: '#A0AEC0',
  };
  const stColor = statusColor[trial.status?.replace(/\s+/g, '_').toUpperCase()] ?? '#718096';

  const countries = trial.locations
    ? [...new Set(trial.locations.split('|').map(l => l.split(',').pop()?.trim()).filter(Boolean))]
    : [];

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px' }}>

      {/* Breadcrumb */}
      <Link href="/market-scan" style={{ color: 'var(--brand-teal)', fontSize: '13px', textDecoration: 'none' }}>
        ← Market Scan
      </Link>

      {/* Trial header */}
      <div style={{ marginTop: '16px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '5px',
            background: `${stColor}18`,
            color: stColor,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            {trial.status}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {trial.phase}
          </span>
          <a
            href={`https://clinicaltrials.gov/study/${nctId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '11px', color: 'var(--brand-teal)', textDecoration: 'none' }}
          >
            {nctId} ↗
          </a>
        </div>

        <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35, margin: '0 0 10px' }}>
          {trial.title}
        </h1>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Sponsor</div>
            <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{trial.sponsor}</div>
          </div>
          {trial.enrollment && (
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Enrollment</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{trial.enrollment}</div>
            </div>
          )}
          {countries.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>Countries</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{countries.slice(0, 5).join(', ')}{countries.length > 5 ? ` +${countries.length - 5}` : ''}</div>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '0 0 8px' }} />

      {/* Contacts section */}
      <ContactsSection nctId={nctId} />

    </div>
  );
}
