'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';

const DEFAULT_MARKET_ID = 'market_alzheimers_phase23';

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore non-JSON upstream responses and fall back to status text.
  }

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `API error: ${response.status}`);
  }

  return payload as T;
};

function LiteratureContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchSynonyms, setSearchSynonyms] = useState('');
  const [recencyDays, setRecencyDays] = useState(365);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(initialQuery || null);

  // Sync with URL if it changes
  useEffect(() => {
    const q = searchParams.get('q');
    if (q && q !== submittedQuery) {
      setSearchQuery(q);
      setSubmittedQuery(q);
    }
  }, [searchParams]);

  // Fetch literature when search is submitted
  const { data: searchResults, isLoading, error } = useSWR<any>(
    submittedQuery
      ? `/api/literature/search?q=${encodeURIComponent(submittedQuery)}&synonyms=${encodeURIComponent(searchSynonyms)}&recencyDays=${recencyDays}&maxResults=100`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Fetch market trends
  const { data: trends, isLoading: trendsLoading } = useSWR<any>(
    `/api/markets/${DEFAULT_MARKET_ID}/literature/trends`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length >= 2) {
      setSubmittedQuery(searchQuery.trim());
      router.push(`/literature?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleQuickSearch = (molecule: string) => {
    setSearchQuery(molecule);
    setSubmittedQuery(molecule);
    router.push(`/literature?q=${encodeURIComponent(molecule)}`);
  };

  return (
    <div className="container" style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/market-scan" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ← Back to Market Scan
        </Link>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', letterSpacing: '-0.02em', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>Literature Search</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Search PubMed for Alzheimer's research publications. Find efficacy, safety, and biomarker studies.
        </p>
      </div>

      {/* Search Form */}
      <div className="linear-card" style={{ marginBottom: '32px' }}>
        <form onSubmit={handleSearch}>
          <div style={{ marginBottom: '20px' }}>
            <label className="label-uppercase">Search Term</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g., lecanemab, aducanumab, amyloid..."
              className="form-input"
              style={{ height: '40px', fontSize: '14px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            <div>
              <label className="label-uppercase">Synonyms (Optional)</label>
              <input
                type="text"
                value={searchSynonyms}
                onChange={(e) => setSearchSynonyms(e.target.value)}
                placeholder="e.g., BAN2401, Leqembi"
                className="form-input"
              />
            </div>
            <div>
              <label className="label-uppercase">Time Period</label>
              <select
                value={recencyDays}
                onChange={(e) => setRecencyDays(parseInt(e.target.value))}
                className="form-select"
              >
                <option value={90}>Last 3 months</option>
                <option value={180}>Last 6 months</option>
                <option value={365}>Last 12 months</option>
                <option value={730}>Last 2 years</option>
                <option value={1095}>Last 3 years</option>
              </select>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={isLoading || searchQuery.trim().length < 2}
              style={{ width: '100%', height: '36px', fontSize: '14px' }}
            >
              {isLoading ? 'Searching PubMed...' : 'Search Literature'}
            </button>
          </div>
        </form>
      </div>

      {/* Market Trends */}
      {!submittedQuery ? (
        <div className="linear-card">
          <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>Market Literature Trends</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '24px' }}>
            Publication activity for top molecules in the Alzheimer's market
          </p>

          {trendsLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              Loading market trends...
            </div>
          ) : trends?.moleculeTrends?.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {trends.moleculeTrends.map((trend: any, i: number) => (
                <div
                  key={i}
                  style={{
                    padding: '20px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                  }}
                  onClick={() => handleQuickSearch(trend.molecule)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--brand-teal)';
                    e.currentTarget.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>{trend.molecule}</div>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      background: trend.trend === 'increasing' ? '#ECFDF5' : trend.trend === 'decreasing' ? '#FEF2F2' : '#F1F5F9',
                      color: trend.trend === 'increasing' ? '#059669' : trend.trend === 'decreasing' ? '#DC2626' : '#64748B',
                      letterSpacing: '0.05em'
                    }}>
                      {trend.trend === 'increasing' ? '↑ Rising' : trend.trend === 'decreasing' ? '↓ Falling' : '→ Stable'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '2px' }}>Papers</div>
                      <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>{trend.paperCount}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '2px' }}>Trials</div>
                      <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>{trend.trialCount}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${(trend.efficacyPapers / trend.paperCount) * 100}%`, height: '100%', background: '#10B981' }}></div>
                    </div>
                    <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${(trend.safetyPapers / trend.paperCount) * 100}%`, height: '100%', background: '#EF4444' }}></div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '9px', color: 'var(--text-tertiary)', fontWeight: '500' }}>
                    <span>Efficacy</span>
                    <span>Safety</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No trend data available.
            </div>
          )}
        </div>
      ) : null}

      {/* Search Results */}
      {error && (
        <div className="linear-card" style={{ backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }}>
          <p style={{ color: '#991B1B', margin: 0, fontSize: '13px' }}>Error searching literature: {error.message}</p>
        </div>
      )}

      {isLoading && (
        <div className="linear-card" style={{ textAlign: 'center', padding: '60px' }}>
          <div style={{ fontSize: '14px', color: 'var(--brand-teal)', fontWeight: '600', marginBottom: '8px' }}>
            Searching PubMed...
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            Looking for publications matching "{submittedQuery}"
          </p>
        </div>
      )}

      {searchResults && !isLoading && (
        <div>
          {/* Results Summary */}
          <div className="linear-card" style={{ marginBottom: '20px', backgroundColor: '#F8FAFC', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Found {searchResults.insights?.totalPapers || 0} publications
              </h2>
              <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '12px' }}>
                Search: "{searchResults.query}" • Last {recencyDays} days
              </p>
            </div>
            <button onClick={() => setSubmittedQuery(null)} className="btn-secondary" style={{ height: '28px', fontSize: '12px' }}>
              Clear Search
            </button>
          </div>

          {/* Insights Grid */}
          {searchResults.insights && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
              <div className="linear-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>Total Papers</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {searchResults.insights.totalPapers}
                </div>
              </div>
              <div className="linear-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>Recent (12mo)</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#10B981' }}>
                  {searchResults.insights.recentPublications}
                </div>
              </div>
              <div className="linear-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>Efficacy</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--brand-teal)' }}>
                  {searchResults.insights.tagBreakdown?.efficacy || 0}
                </div>
              </div>
              <div className="linear-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>Safety</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#EF4444' }}>
                  {searchResults.insights.tagBreakdown?.safety || 0}
                </div>
              </div>
              <div className="linear-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>Biomarker</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#8B5CF6' }}>
                  {searchResults.insights.tagBreakdown?.biomarker || 0}
                </div>
              </div>
            </div>
          )}

          {/* Papers List */}
          <div className="linear-card">
            <h3 style={{ marginBottom: '20px', fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Publications</h3>

            {searchResults.papers?.length === 0 ? (
              <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '40px', fontSize: '13px' }}>
                No publications found. Try adjusting your search query.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {searchResults.papers?.map((paper: any, i: number) => (
                  <div
                    key={paper.pmid}
                    style={{
                      padding: '20px',
                      borderBottom: i < searchResults.papers.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      backgroundColor: i < 3 ? 'rgba(20, 184, 166, 0.02)' : 'transparent',
                      position: 'relative'
                    }}
                  >
                    {i < 3 && (
                      <div style={{
                        position: 'absolute',
                        right: '20px',
                        top: '20px',
                        fontSize: '10px',
                        fontWeight: 700,
                        color: 'var(--brand-teal)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--brand-teal)' }}></span>
                        Top Match
                      </div>
                    )}

                    <div style={{ marginBottom: '6px', maxWidth: '90%' }}>
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '15px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          lineHeight: '1.4',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--brand-teal)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                      >
                        {paper.title}
                      </a>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                      <span>{paper.authors?.slice(0, 3).join(', ')}{paper.authors?.length > 3 ? ' et al.' : ''}</span>
                      <span style={{ color: 'var(--border-subtle)' }}>|</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{paper.journal}</span>
                      {paper.relevanceScore > 20 && (
                        <span style={{
                          background: '#E0F2FE',
                          color: '#0369A1',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontSize: '9px',
                          fontWeight: 700,
                          marginLeft: '4px'
                        }}>HIGH IMPACT</span>
                      )}
                      <span style={{ color: 'var(--border-subtle)' }}>|</span>
                      <span>{paper.year}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                      {/* Priority Tag: Peer Reviewed or Clinical Trial */}
                      {paper.publicationTypes?.some((t: string) => t.includes('Clinical Trial') || t.includes('Randomized')) && (
                        <span style={{
                          padding: '2px 8px',
                          background: '#F0F9FF',
                          borderRadius: '4px',
                          fontSize: '10px',
                          color: '#0369A1',
                          fontWeight: 700,
                          border: '1px solid #BAE6FD',
                          textTransform: 'uppercase'
                        }}>
                          Peer Reviewed Trial
                        </span>
                      )}

                      {paper.tags?.map((tag: string) => {
                        const color = tag === 'efficacy' ? '#10B981' : tag === 'safety' ? '#EF4444' : '#3B82F6';
                        const bg = tag === 'efficacy' ? '#ECFDF5' : tag === 'safety' ? '#FEF2F2' : '#EFF6FF';
                        return (
                          <span
                            key={tag}
                            style={{
                              padding: '2px 8px',
                              background: bg,
                              borderRadius: '4px',
                              fontSize: '11px',
                              color: color,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.02em'
                            }}
                          >
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchResults.papers?.length > 0 && (
              <div style={{ padding: '20px', textAlign: 'center', borderTop: '1px solid var(--border-subtle)' }}>
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(searchResults.query + ' Alzheimer')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  style={{ display: 'inline-flex', height: '32px', fontSize: '12px' }}
                >
                  View Full Results on PubMed →
                </a>
              </div>
            )}
          </div>

          {/* Top Journals & Timestamp */}
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            {searchResults.insights?.topJournals?.length > 0 && (
              <div>
                Top Journals: {searchResults.insights.topJournals.slice(0, 3).map((j: any) => j.name).join(', ')}
              </div>
            )}
            {searchResults.fetchedAt && (
              <div>Data fetched: {new Date(searchResults.fetchedAt).toLocaleString()}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiteraturePage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading literature...</div>}>
      <LiteratureContent />
    </Suspense>
  );
}
