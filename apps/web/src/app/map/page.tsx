'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import dynamic from 'next/dynamic';

const fetcher = (url: string) => fetch(url).then(res => res.json());

// Load map dynamically to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('../components/MapComponent'), {
    ssr: false,
    loading: () => <div style={{ height: '600px', width: '100%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>Loading map assets...</div>
});

export default function MapPage() {
    const [searchParams, setSearchParams] = useState({
        sponsor: '', phase: '', nct: '', search: '', molecule: '', country: '', city: '', region: 'All'
    });

    const [activeFilters, setActiveFilters] = useState({
        sponsor: '', phase: '', nct: '', search: '', molecule: '', country: '', city: '', region: 'All'
    });

    // Build query string (Exactly as in market scan)
    const buildQueryString = () => {
        const params = new URLSearchParams();
        Object.entries(activeFilters).forEach(([key, value]) => {
            if (value && value !== 'All') params.append(key, value);
            if (key === 'region' && value === 'Nordic') params.append(key, value);
        });
        return params.toString();
    };

    const queryString = buildQueryString();
    const trialsUrl = `/api/trials${queryString ? `?${queryString}` : ''}`;
    const { data: trialsData, isLoading } = useSWR(trialsUrl, fetcher);

    const trials = trialsData?.trials || [];
    const totalTrials = trialsData?.total || 0;

    const handleSearch = () => setActiveFilters({ ...searchParams });

    const removeFilter = (key: string) => {
        const updated = { ...activeFilters, [key]: key === 'region' ? 'All' : '' };
        setActiveFilters(updated);
        setSearchParams(updated);
    };

    const handleClear = () => {
        const empty = { sponsor: '', phase: '', nct: '', search: '', molecule: '', country: '', city: '', region: 'All' };
        setSearchParams(empty);
        setActiveFilters(empty);
    };

    const handleInputChange = (field: string, value: string) => setSearchParams(prev => ({ ...prev, [field]: value }));

    return (
        <div className="container">
            {/* Header */}
            <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: '20px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', letterSpacing: '-0.02em', fontWeight: '600', marginBottom: '4px', color: 'var(--text-primary)' }}>
                        Global Trial Visualization
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Geographic distribution of {totalTrials} Alzheimer's clinical trials
                    </p>
                </div>
            </div>

            {/* Map Section */}
            <div className="linear-card" style={{ padding: '0', marginBottom: '24px', position: 'relative' }}>
                <MapComponent trials={trials} />
            </div>

            {/* Search Filters (Same as Market Scan) */}
            <div className="linear-card" style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '20px', color: 'var(--text-primary)' }}>Filter Map View</h2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                    {[
                        { label: 'Molecule / Intervention', key: 'molecule', placeholder: 'e.g. Lecanemab' },
                        { label: 'Sponsor', key: 'sponsor', placeholder: 'e.g. Roche' },
                        { label: 'NCT Number', key: 'nct', placeholder: 'e.g. NCT0716...' }
                    ].map((field) => (
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
                        <label className="label-uppercase">Phase</label>
                        <select
                            className="form-select"
                            value={searchParams.phase}
                            onChange={(e) => handleInputChange('phase', e.target.value)}
                        >
                            <option value="">Any Phase</option>
                            <option value="PHASE3">Phase 3</option>
                            <option value="PHASE2">Phase 2</option>
                            <option value="PHASE1">Phase 1</option>
                        </select>
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
                    {[
                        { label: 'Country', key: 'country', placeholder: 'e.g. France' },
                        { label: 'City', key: 'city', placeholder: 'e.g. Paris' }
                    ].map((field) => (
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
                    <div className="hidden md:block"></div>
                </div>

                <div style={{ display: 'flex', gap: '12px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                    <button onClick={handleSearch} className="btn-primary">Update Map</button>
                    <button onClick={handleClear} className="btn-secondary">Clear All</button>
                </div>

                {/* Active Filters */}
                {Object.entries(activeFilters).some(([k, v]) => v && v !== 'All') && (
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px dashed var(--border-subtle)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {Object.entries(activeFilters).map(([key, value]) => {
                                if (!value || value === 'All') return null;
                                return (
                                    <div key={key} style={{
                                        display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
                                        backgroundColor: 'var(--brand-teal-light)', color: 'var(--brand-teal-dark)',
                                        borderRadius: '6px', fontSize: '11px', fontWeight: '600',
                                        border: '1px solid rgba(70, 155, 148, 0.2)'
                                    }}>
                                        <span style={{ opacity: 0.7, textTransform: 'uppercase' }}>{key}</span>
                                        <span style={{ width: '1px', height: '10px', background: 'currentColor', opacity: 0.3 }}></span>
                                        <span>{value}</span>
                                        <button onClick={() => removeFilter(key)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', marginLeft: '4px', fontSize: '14px', lineHeight: 0.5 }}>×</button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <div className="linear-card" style={{ backgroundColor: '#F8FAFC', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <strong>Note:</strong> Map markers are positioned by country with visual jitter to show multiple trials. Zoom in to explore regions.
                </div>
            </div>
        </div>
    );
}
