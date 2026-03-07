'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

interface NewsEvent {
  id: string;
  eventType: string;
  title: string;
  summary: string;
  importanceScore: number;
  importanceLevel: 'high' | 'medium' | 'low';
  eventDate: string | null;
  whyItMatters: string | null;
  sourceUrl: string | null;
  entities: Array<{
    id: string;
    entityType: string;
    entityId: string;
    entityName: string | null;
  }>;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

const EVENT_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  trial_launched: { label: 'Trial Launched', icon: '🚀', color: '#059669' },
  trial_status_changed: { label: 'Trial Status', icon: '🔄', color: '#2563eb' },
  publication_published: { label: 'Publication', icon: '📄', color: '#7c3aed' },
  sponsor_update: { label: 'Sponsor Update', icon: '🏢', color: '#d97706' },
  regulatory_update: { label: 'Regulatory', icon: '⚖️', color: '#dc2626' },
  investigator_signal: { label: 'Investigator Signal', icon: '👤', color: '#06b6d4' },
};

function ImportanceBadge({ level, score }: { level: 'high' | 'medium' | 'low'; score: number }) {
  const colors = {
    high: { bg: '#fee2e2', text: '#991b1b' },
    medium: { bg: '#fef3c7', text: '#92400e' },
    low: { bg: '#f3f4f6', text: '#374151' },
  };
  const c = colors[level];
  return (
    <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: c.bg, color: c.text }}>
      {level.toUpperCase()} ({score}%)
    </span>
  );
}

function EntityLink({ type, id, name }: { type: string; id: string; name: string | null }) {
  const label = name || id;
  let href = '#';

  if (type === 'trial') href = `/trials/${id}`;
  else if (type === 'sponsor') href = `/sponsors/${id}`;
  else if (type === 'investigator') href = `/investigators/${id}`;

  return (
    <Link href={href} style={{ fontSize: '12px', color: 'var(--brand-teal)', textDecoration: 'none', marginRight: '8px' }}>
      {label}
    </Link>
  );
}

export default function NewsPage() {
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [limit, setLimit] = useState(30);

  const params = new URLSearchParams({
    limit: String(limit),
    ...(selectedEventTypes.length > 0 && { eventTypes: selectedEventTypes.join(',') }),
    ...(selectedLevels.length > 0 && { importanceLevels: selectedLevels.join(',') }),
  });

  const { data, isLoading } = useSWR<{ events: NewsEvent[] }>(
    `/api/news?${params}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const events = data?.events ?? [];

  const toggleEventType = (type: string) => {
    setSelectedEventTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleLevel = (level: string) => {
    setSelectedLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          News
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Alzheimer's research signals — trials, publications, regulatory updates
        </p>
      </div>

      {/* Filters */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: '20px',
        marginBottom: '24px',
      }}>

        {/* Left sidebar filters */}
        <div style={{ background: 'white', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
              Importance
            </h3>
            {['high', 'medium', 'low'].map(level => (
              <label key={level} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={selectedLevels.includes(level)}
                  onChange={() => toggleLevel(level)}
                  style={{ cursor: 'pointer' }}
                />
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
              Type
            </h3>
            {Object.entries(EVENT_TYPE_LABELS).map(([type, { label }]) => (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={selectedEventTypes.includes(type)}
                  onChange={() => toggleEventType(type)}
                  style={{ cursor: 'pointer' }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Right: feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {isLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Loading news...
            </div>
          ) : events.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No news events found
            </div>
          ) : (
            <>
              {events.map(event => {
                const typeConfig = EVENT_TYPE_LABELS[event.eventType] || { label: event.eventType, icon: '📰', color: '#6b7280' };
                return (
                  <div
                    key={event.id}
                    style={{
                      background: 'white',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '16px',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    {/* Title + Badge */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '20px', marginTop: '2px' }}>
                        {typeConfig.icon}
                      </span>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                          {event.title}
                        </h3>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: typeConfig.color + '20',
                              color: typeConfig.color,
                            }}
                          >
                            {typeConfig.label}
                          </span>
                          <ImportanceBadge level={event.importanceLevel} score={event.importanceScore} />
                          {event.eventDate && (
                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                              {new Date(event.eventDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '8px 0', lineHeight: 1.5 }}>
                      {event.summary}
                    </p>

                    {/* Why it matters */}
                    {event.whyItMatters && (
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                        <strong>Why it matters:</strong> {event.whyItMatters}
                      </div>
                    )}

                    {/* Entities */}
                    {event.entities.length > 0 && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }}>
                          Related
                        </div>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          {event.entities.map(entity => (
                            <EntityLink key={entity.id} type={entity.entityType} id={entity.entityId} name={entity.entityName} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action button */}
                    {event.sourceUrl && (
                      <a
                        href={event.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          marginTop: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '6px 12px',
                          borderRadius: '5px',
                          background: 'var(--brand-teal)',
                          color: 'white',
                          textDecoration: 'none',
                        }}
                      >
                        View source
                      </a>
                    )}
                  </div>
                );
              })}

              {/* Load more */}
              {events.length >= limit && (
                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                  <button
                    onClick={() => setLimit(l => l + 20)}
                    style={{
                      padding: '8px 20px',
                      fontSize: '13px',
                      fontWeight: 600,
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
            </>
          )}
        </div>
      </div>
    </main>
  );
}
