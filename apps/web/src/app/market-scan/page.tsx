'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, type ExportColumnKey } from '@/lib/trialExport';

const fetcher = (url: string) => fetch(url).then(res => res.json());
const PHASE_OPTIONS = [
  { value: 'EARLY_PHASE1', label: 'Early Phase 1' },
  { value: 'PHASE1', label: 'Phase 1' },
  { value: 'PHASE2', label: 'Phase 2' },
  { value: 'PHASE3', label: 'Phase 3' },
  { value: 'PHASE4', label: 'Phase 4' },
] as const;

type Filters = {
  sponsor: string;
  phase: string[];
  nct: string;
  search: string;
  molecule: string;
  country: string;
  city: string;
  region: 'All' | 'Nordic';
};

const EMPTY_FILTERS: Filters = {
  sponsor: '',
  phase: [],
  nct: '',
  search: '',
  molecule: '',
  country: '',
  city: '',
  region: 'All',
};

// --- Components ---

function NordicDashboard({ facets, onCountryClick }: { facets: any, onCountryClick: (country: string) => void }) {
  if (!facets || !facets.nordic) return null;

  const { nordic, globalReach } = facets;
  const countries = [
    { name: 'Sweden', count: nordic.sweden },
    { name: 'Denmark', count: nordic.denmark },
    { name: 'Norway', count: nordic.norway },
    { name: 'Finland', count: nordic.finland }
  ].sort((a, b) => b.count - a.count);

  const maxCount = Math.max(...countries.map(c => c.count));

  return (
    <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: '16px' }}>
      {/* Nordic Presence Card */}
      <div className="linear-card" style={{ padding: '0', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: '#FBFCFD',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderRadius: '6px 6px 0 0'
        }}>
          <h2 style={{ fontSize: '13px', fontWeight: '600', margin: 0, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            Nordic Region Focus
          </h2>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '500' }}>Active Clinical Sites</span>
        </div>

        <div style={{ padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
            {/* Left Column: List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {countries.map((item) => (
                <div
                  key={item.name}
                  onClick={() => onCountryClick(item.name)}
                  className="nordic-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    margin: '0 -8px',
                    borderRadius: '6px',
                    transition: 'background 0.2s ease'
                  }}
                >
                  <div style={{ width: '80px', fontSize: '13px', fontWeight: '500', color: 'var(--text-secondary)' }}>{item.name}</div>
                  <div style={{ flex: 1, height: '6px', background: 'var(--bg-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(item.count / maxCount) * 100}%`,
                      height: '100%',
                      background: 'var(--brand-teal)',
                      borderRadius: '3px'
                    }}></div>
                  </div>
                  <div style={{ width: '30px', textAlign: 'right', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{item.count}</div>
                </div>
              ))}
            </div>

            {/* Right Column: Mini Map or Insight (Placeholder for now, just text) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-subtle)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--text-primary)', lineHeight: '1' }}>
                  {countries.reduce((acc, c) => acc + c.count, 0)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total Nordic Trials
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global Reach Card */}
      <div className="linear-card" style={{
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '4px',
          background: 'var(--brand-teal)'
        }}></div>
        <h3 style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600', marginTop: '24px' }}>
          Total Geographic Reach
        </h3>
        <div style={{ fontSize: '56px', fontWeight: '700', lineHeight: '1', letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: '16px 0' }}>
          {globalReach}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '24px', fontWeight: '500' }}>
          Countries
        </div>
      </div>
    </div>
  );
}

export default function MarketScanPage() {
  const [searchParams, setSearchParams] = useState<Filters>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState<Filters>(EMPTY_FILTERS);

  // Build query string
  const buildQueryString = () => {
    const params = new URLSearchParams();
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (key === 'phase') {
        (value as string[]).forEach((phase) => params.append('phase', phase));
        return;
      }
      if (key === 'region') {
        if (value === 'Nordic') params.append('region', value);
        return;
      }
      if (value) params.append(key, value as string);
    });
    return params.toString();
  };

  const queryString = buildQueryString();
  const trialsUrl = `/api/trials${queryString ? `?${queryString}` : ''}`;
  const { data: trialsData, isLoading } = useSWR(trialsUrl, fetcher);

  const trials = trialsData?.trials || [];
  const totalTrials = trialsData?.total || 0;
  const facets = trialsData?.facets || {};

  const [sortConfig, setSortConfig] = useState({ key: 'nct_id', direction: 'asc' });
  const [selectedExportColumns, setSelectedExportColumns] = useState<ExportColumnKey[]>(DEFAULT_EXPORT_COLUMNS);
  const [isExporting, setIsExporting] = useState(false);
  const NORDIC_COUNTRIES = ['sweden', 'denmark', 'finland', 'norway', 'iceland'];

  // --- Helpers ---
  const getMoleculeStyle = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('lecanemab') || n.includes('donanemab') || n.includes('amyloid')) return { bg: '#FEF2F2', text: '#B91C1C', label: 'Amyloid' };
    if (n.includes('tau') || n.includes('e2814')) return { bg: '#EFF6FF', text: '#1D4ED8', label: 'Tau' };
    if (n.includes('inflammation') || n.includes('immunity')) return { bg: '#FEFCE8', text: '#A16207', label: 'Inflammation' };
    if (n.includes('metabolism')) return { bg: '#FDF2F8', text: '#BE185D', label: 'Metabolism' };
    if (n.includes('cholinergic')) return { bg: '#F0FDF4', text: '#15803D', label: 'Cognitive' };
    return { bg: '#F0FDFA', text: '#0F766E', label: 'Targeted' };
  };

  const getFilteredLocations = (locationStr: string) => {
    if (!locationStr) return [];
    const locs = locationStr.split('|');
    const { region, country, city } = activeFilters;
    const isLocationFiltered = region === 'Nordic' || country || city;

    if (isLocationFiltered) {
      return locs.filter(loc => {
        const lowLoc = loc.toLowerCase();
        let matches = true;
        if (region === 'Nordic') matches = matches && NORDIC_COUNTRIES.some(nc => lowLoc.includes(nc));
        if (country) matches = matches && lowLoc.includes(country.toLowerCase());
        if (city) matches = matches && lowLoc.includes(city.toLowerCase());
        return matches;
      });
    }
    return locs;
  };

  const sortedTrials = [...trials].sort((a, b) => {
    let aVal = (a as any)[sortConfig.key] || '';
    let bVal = (b as any)[sortConfig.key] || '';
    if (sortConfig.key === 'molecule') {
      aVal = a.parsed_molecules?.[0] || '';
      bVal = b.parsed_molecules?.[0] || '';
    }
    if (aVal.toString().toLowerCase() < bVal.toString().toLowerCase()) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal.toString().toLowerCase() > bVal.toString().toLowerCase()) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSearch = () => setActiveFilters({ ...searchParams });

  const removeFilter = (key: keyof Filters) => {
    const updated: Filters = {
      ...activeFilters,
      [key]: key === 'region' ? 'All' : key === 'phase' ? [] : ''
    };
    setActiveFilters(updated);
    setSearchParams(updated);
  };

  const handleClear = () => {
    setSearchParams(EMPTY_FILTERS);
    setActiveFilters(EMPTY_FILTERS);
  };

  const handleInputChange = (field: Exclude<keyof Filters, 'phase'>, value: string) =>
    setSearchParams((prev) => ({ ...prev, [field]: value as Filters[typeof field] }));

  const handlePhaseToggle = (phase: string) => {
    setSearchParams((prev) => {
      const hasPhase = prev.phase.includes(phase);
      return {
        ...prev,
        phase: hasPhase ? prev.phase.filter((item) => item !== phase) : [...prev.phase, phase]
      };
    });
  };

  const toggleExportColumn = (column: ExportColumnKey) => {
    setSelectedExportColumns((previous) => {
      if (previous.includes(column)) {
        if (previous.length === 1) return previous;
        return previous.filter((item) => item !== column);
      }
      return DEFAULT_EXPORT_COLUMNS.filter((item) => previous.includes(item) || item === column);
    });
  };

  const handleExportCsv = async () => {
    if (selectedExportColumns.length === 0) return;

    try {
      setIsExporting(true);

      const params = new URLSearchParams(queryString);
      params.set('columns', selectedExportColumns.join(','));
      params.set('sortKey', sortConfig.key);
      params.set('sortDirection', sortConfig.direction);

      const response = await fetch(`/api/trials/export?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const contentDisposition = response.headers.get('content-disposition');
      const match = contentDisposition?.match(/filename="([^"]+)"/i);

      link.href = url;
      link.download = match?.[1] || `market-scan-results-${sortedTrials.length}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('CSV export failed:', error);
      window.alert('Failed to export CSV. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const primarySearchFields = [
    { label: 'Molecule / Intervention', key: 'molecule', placeholder: 'e.g. Lecanemab' },
    { label: 'Sponsor', key: 'sponsor', placeholder: 'e.g. Roche' },
    { label: 'NCT Number', key: 'nct', placeholder: 'e.g. NCT0716...' }
  ] as const;

  const locationSearchFields = [
    { label: 'Country', key: 'country', placeholder: 'e.g. France' },
    { label: 'City', key: 'city', placeholder: 'e.g. Paris' }
  ] as const;

  return (
    <div className="container">
      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', letterSpacing: '-0.02em', fontWeight: '600', marginBottom: '4px', color: 'var(--text-primary)' }}>
            Market and Prospect Tracker
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Browse and search {totalTrials} Alzheimer's clinical trials
          </p>
        </div>
      </div>

      <NordicDashboard
        facets={facets}
        onCountryClick={(country) => {
          const updated: Filters = { ...activeFilters, country, region: 'Nordic' };
          setSearchParams(updated);
          setActiveFilters(updated);
          // Optional: Scroll to results
          window.scrollTo({ top: 600, behavior: 'smooth' });
        }}
      />

      {/* Assumptions Block (Refined) */}
      <div className="linear-card" style={{ marginBottom: '24px', backgroundColor: '#F8FAFC', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.2)' }}></div>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            System Configuration
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
          {[
            { label: 'Condition', value: 'Alzheimer Disease' },
            { label: 'Study Status', value: 'Recruiting, Active, Not yet recruiting' },
            { label: 'Study Type', value: 'Interventional' },
            { label: 'Target Phases', value: 'Phases 1-4 + Early P1' },
            { label: 'Data Source', value: 'ClinicalTrials.gov v2 (Live)' }
          ].map((item, i) => (
            <div key={i}>
              <div style={{ fontSize: '10px', color: '#94A3B8', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.02em' }}>{item.label}</div>
              <div style={{ fontSize: '13px', color: '#334155', fontWeight: '500' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Search Filters */}
      <div className="linear-card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '20px', color: 'var(--text-primary)' }}>Search Parameters</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          {primarySearchFields.map((field) => (
            <div key={field.key}>
              <label className="label-uppercase">{field.label}</label>
              <input
                type="text"
                className="form-input"
                value={(searchParams as any)[field.key]}
                onChange={(e) => handleInputChange(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            </div>
          ))}
          <div>
            <label className="label-uppercase">Phases (Multi-select)</label>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px 10px', background: 'white', minHeight: '32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {PHASE_OPTIONS.map((phaseOption) => (
                  <label key={phaseOption.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={searchParams.phase.includes(phaseOption.value)}
                      onChange={() => handlePhaseToggle(phaseOption.value)}
                    />
                    <span>{phaseOption.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div>
            <label className="label-uppercase">Region</label>
            <select
              className="form-select"
              value={searchParams.region}
              onChange={(e) => handleInputChange('region', e.target.value)}
            >
              <option value="All">All Regions</option>
              <option value="Nordic">Nordic Countries</option>
            </select>
          </div>
          {locationSearchFields.map((field) => (
            <div key={field.key}>
              <label className="label-uppercase">{field.label}</label>
              <input
                type="text"
                className="form-input"
                value={(searchParams as any)[field.key]}
                onChange={(e) => handleInputChange(field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            </div>
          ))}
          {/* Empty spacer for grid alignment if needed */}
          <div className="hidden md:block"></div>
        </div>

        <div style={{ display: 'flex', gap: '12px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={handleSearch} className="btn-primary">Apply Filters</button>
          <button onClick={handleClear} className="btn-secondary">Clear All</button>
        </div>

        {/* Active Filters */}
        {Object.entries(activeFilters).some(([, value]) => Array.isArray(value) ? value.length > 0 : value && value !== 'All') && (
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px dashed var(--border-subtle)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(Object.entries(activeFilters) as [keyof Filters, Filters[keyof Filters]][]).map(([key, value]) => {
                if (Array.isArray(value) && value.length === 0) return null;
                if (!Array.isArray(value) && (!value || value === 'All')) return null;
                const displayValue = Array.isArray(value)
                  ? value
                    .map((item) => item === 'EARLY_PHASE1' ? 'Early Phase 1' : item.replace('PHASE', 'Phase '))
                    .join(', ')
                  : value;
                return (
                  <div key={key} style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
                    backgroundColor: 'var(--brand-teal-light)', color: 'var(--brand-teal-dark)',
                    borderRadius: '6px', fontSize: '11px', fontWeight: '600',
                    border: '1px solid rgba(70, 155, 148, 0.2)'
                  }}>
                    <span style={{ opacity: 0.7, textTransform: 'uppercase' }}>{key}</span>
                    <span style={{ width: '1px', height: '10px', background: 'currentColor', opacity: 0.3 }}></span>
                    <span>{displayValue}</span>
                    <button onClick={() => removeFilter(key)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', marginLeft: '4px', fontSize: '14px', lineHeight: 0.5 }}>×</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Results Table */}
      <div className="linear-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FBFCFD' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', margin: 0 }}>Results ({totalTrials})</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <details style={{ position: 'relative' }}>
              <summary
                className="btn-secondary"
                style={{ height: '28px', fontSize: '11px', padding: '0 10px', listStyle: 'none', display: 'inline-flex' }}
              >
                Columns ({selectedExportColumns.length})
              </summary>
              <div
                style={{
                  position: 'absolute',
                  top: '32px',
                  right: 0,
                  width: '230px',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  padding: '10px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                  zIndex: 20
                }}
              >
                {EXPORT_COLUMNS.map((column) => (
                  <label
                    key={column.key}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedExportColumns.includes(column.key)}
                      onChange={() => toggleExportColumn(column.key)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                  At least one column must stay selected.
                </div>
              </div>
            </details>
            <button
              onClick={handleExportCsv}
              className="btn-secondary"
              disabled={sortedTrials.length === 0 || selectedExportColumns.length === 0 || isExporting}
              style={{ height: '28px', fontSize: '11px', padding: '0 10px' }}
            >
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '500' }}>SORT</span>
            <select
              value={`${sortConfig.key}-${sortConfig.direction}`}
              onChange={(e) => {
                const [key, direction] = e.target.value.split('-');
                setSortConfig({ key, direction: direction as 'asc' | 'desc' });
              }}
              style={{ padding: '4px 8px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '11px', backgroundColor: 'white', color: 'var(--text-secondary)' }}
            >
              <option value="nct_id-asc">NCT ID (A-Z)</option>
              <option value="status-asc">Status</option>
              <option value="phase-desc">Phase (High-Low)</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Loading market data...</div>
        ) : trials.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>No trials found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', backgroundColor: '#FAFAFA' }}>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>NCT ID</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Molecule</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', width: '30%' }}>Title / Sponsor</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Locations</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Principal Investigator</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Phase</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedTrials.map((trial: any) => {
                  const filteredLocs = getFilteredLocations(trial.locations);
                  return (
                    <tr key={trial.nct_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        <Link href={`https://clinicaltrials.gov/study/${trial.nct_id}`} target="_blank" style={{ color: 'var(--brand-teal)', fontWeight: '600' }}>
                          {trial.nct_id}
                        </Link>
                      </td>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        {trial.parsed_molecules && trial.parsed_molecules.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {trial.parsed_molecules.slice(0, 2).map((mol: string, i: number) => {
                              const s = getMoleculeStyle(mol);
                              return (
                                <span key={i} style={{
                                  display: 'inline-flex', padding: '2px 6px', borderRadius: '4px',
                                  fontSize: '11px', fontWeight: '600', backgroundColor: s.bg, color: s.text,
                                  border: `1px solid ${s.text}15`, width: 'fit-content'
                                }}>
                                  {mol}
                                </span>
                              )
                            })}
                            {trial.parsed_molecules.length > 2 && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>+ {trial.parsed_molecules.length - 2} more</span>}
                          </div>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>--</span>}
                      </td>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: '500', color: 'var(--text-primary)', marginBottom: '4px', lineHeight: '1.4' }}>{trial.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{trial.sponsor}</div>
                      </td>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        {filteredLocs.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto', paddingRight: '8px' }}>
                            {filteredLocs.map((loc, idx) => (
                              <div key={idx} style={{
                                fontSize: '11px',
                                fontWeight: '500',
                                color: 'var(--text-secondary)', // Slightly softer for improved readability in a list
                                lineHeight: '1.4',
                                borderBottom: idx !== filteredLocs.length - 1 ? '1px dashed var(--border-subtle)' : 'none',
                                paddingBottom: idx !== filteredLocs.length - 1 ? '4px' : '0'
                              }}>
                                {loc.trim()}
                              </div>
                            ))}
                          </div>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>--</span>}
                      </td>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        {trial.principal_investigators ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {(trial.principal_investigators as string).split('|').map((pi: string, i: number) => (
                              <div key={i} style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.4' }}>{pi}</div>
                            ))}
                          </div>
                        ) : <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>--</span>}
                      </td>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary)' }}>{trial.phase?.replace('PHASE', 'Phase ') || '--'}</span>
                      </td>
                      <td style={{ padding: '16px 20px', verticalAlign: 'top' }}>
                        <span style={{
                          fontSize: '11px', fontWeight: '600', padding: '2px 6px', borderRadius: '4px',
                          backgroundColor: trial.status === 'RECRUITING' ? '#ECFDF5' : '#F1F5F9',
                          color: trial.status === 'RECRUITING' ? '#059669' : '#64748B'
                        }}>
                          {trial.status?.replace(/_/g, ' ') || '--'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
