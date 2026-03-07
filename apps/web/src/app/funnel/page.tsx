'use client';

import React, { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';

type FunnelStage = 'prospect' | 'awareness' | 'interest' | 'contract' | 'realized';
type AdFocus = 'primary' | 'secondary' | 'limited';

interface Company {
    id: string;
    name: string;
    stage: FunnelStage;
    isNordicActive?: boolean;
    adFocus?: AdFocus;
}

const AD_FOCUS_META: Record<AdFocus, { label: string; color: string; bg: string; tooltip: string }> = {
    primary:   { label: 'Core AD',     color: '#38A169', bg: 'rgba(56,161,105,0.12)', tooltip: 'Company has an approved or late-stage AD therapy (e.g. lecanemab, donanemab). High-priority prospect.' },
    secondary: { label: 'AD Pipeline', color: '#D69E2E', bg: 'rgba(214,158,46,0.12)', tooltip: 'Active AD clinical trials but no approved product yet. Promising prospect worth pursuing.' },
    limited:   { label: 'Limited AD',  color: '#E53E3E', bg: 'rgba(229,62,62,0.10)', tooltip: 'Little or no current AD pipeline — prior programs failed or were discontinued. Consider removing or deprioritising.' },
};

const NORDIC_TOOLTIP = 'Company has operations, trials, or a registered entity active in the Nordic region (FI/SE/NO/DK).';

function LegendBadge({ label, color, bg, tooltip }: { label: string; color: string; bg: string; tooltip: string }) {
    const [show, setShow] = React.useState(false);
    return (
        <span
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
            style={{ position: 'relative', display: 'inline-block', cursor: 'default' }}
        >
            <span style={{
                fontSize: '11px',
                color,
                background: bg,
                padding: '3px 8px',
                borderRadius: '6px',
                fontWeight: 500,
                display: 'inline-block',
            }}>
                {label}
            </span>
            {show && (
                <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 7px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#1A202C',
                    color: '#E2E8F0',
                    fontSize: '11px',
                    lineHeight: '1.5',
                    padding: '7px 10px',
                    borderRadius: '7px',
                    width: '220px',
                    textAlign: 'center',
                    whiteSpace: 'normal',
                    zIndex: 100,
                    pointerEvents: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                }}>
                    {tooltip}
                    {/* Arrow */}
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: '5px solid #1A202C',
                    }} />
                </div>
            )}
        </span>
    );
}

// Initial funnel companies
const INITIAL_COMPANIES: Company[] = [
    { id: '1',  name: 'Novo Nordisk',        stage: 'prospect', isNordicActive: true,  adFocus: 'secondary' },
    { id: '2',  name: 'Eisai',               stage: 'prospect', isNordicActive: true,  adFocus: 'primary'   },
    { id: '3',  name: 'Roche',               stage: 'prospect', isNordicActive: true,  adFocus: 'secondary' },
    { id: '4',  name: 'Biogen',              stage: 'prospect', isNordicActive: true,  adFocus: 'primary'   },
    { id: '5',  name: 'Novartis',            stage: 'prospect', isNordicActive: true,  adFocus: 'limited'   },
    { id: '6',  name: 'GSK',                 stage: 'prospect', isNordicActive: false, adFocus: 'limited'   },
    { id: '7',  name: 'Janssen',             stage: 'prospect', isNordicActive: true,  adFocus: 'limited'   },
    { id: '8',  name: 'Bristol Myers Squibb',stage: 'prospect', isNordicActive: false, adFocus: 'limited'   },
    { id: '9',  name: 'BioArctic',           stage: 'contract', isNordicActive: true,  adFocus: 'primary'   },
    { id: '10', name: 'Lilly',               stage: 'contract', isNordicActive: true,  adFocus: 'primary'   },
];

// Known AD focus metadata keyed by lowercase sponsor name
const KNOWN_AD_FOCUS: Record<string, AdFocus> = {
    'eisai': 'primary', 'biogen': 'primary', 'bioarctic': 'primary', 'eli lilly': 'primary',
    'lilly': 'primary', 'ac immune': 'primary', 'anavex life sciences': 'primary',
    'prothena': 'primary', 'cassava sciences': 'primary', 'alzamend neuro': 'primary',
    'novo nordisk': 'secondary', 'roche': 'secondary', 'astrazeneca': 'secondary',
    'sanofi': 'secondary', 'abbvie': 'secondary', 'ucb': 'secondary',
    'johnson & johnson': 'secondary', 'janssen': 'limited', 'gsk': 'limited',
    'novartis': 'limited', 'bristol-myers squibb': 'limited', 'bristol myers squibb': 'limited',
};

const STAGES: { id: FunnelStage; title: string; subtitle?: string; color: string }[] = [
    { id: 'prospect',  title: 'Prospect',   subtitle: 'Potential',            color: '#3182CE' },
    { id: 'awareness', title: 'Awareness',  subtitle: 'Contacted',            color: '#9F7AEA' },
    { id: 'interest',  title: 'Interest',   subtitle: 'Understanding',        color: '#319795' },
    { id: 'contract',  title: 'Contract',   subtitle: 'Project Phase (Customer)', color: '#38A169' },
    { id: 'realized',  title: 'Realized',   subtitle: 'Project Completed',   color: '#718096' },
];

const STORAGE_KEY = 'medino_funnel_v2';

function loadState(): Company[] {
    if (typeof window === 'undefined') return INITIAL_COMPANIES;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Company[]) : INITIAL_COMPANIES;
    } catch {
        return INITIAL_COMPANIES;
    }
}

export default function FunnelPage() {
    const [companies, setCompanies] = useState<Company[]>(INITIAL_COMPANIES);
    const [didHydrateFromStorage, setDidHydrateFromStorage] = useState(false);
    const [draggedId, setDraggedId]   = useState<string | null>(null);
    const [dragOverStage, setDragOverStage] = useState<FunnelStage | null>(null);
    const [hoveredId, setHoveredId]   = useState<string | null>(null);
    const [customName, setCustomName] = useState('');

    // ── Finder filters (draft = what's typed, active = applied) ──────────────
    type FinderFilters = { name: string; adFocus: AdFocus[]; nordicOnly: boolean };
    const EMPTY_FINDER: FinderFilters = { name: '', adFocus: [], nordicOnly: false };
    const [finderDraft,   setFinderDraft]   = useState<FinderFilters>(EMPTY_FINDER);
    const [finderActive,  setFinderActive]  = useState<FinderFilters>(EMPTY_FINDER);

    const applyFinderFilters  = () => setFinderActive({ ...finderDraft });
    const clearFinderFilters  = () => { setFinderDraft(EMPTY_FINDER); setFinderActive(EMPTY_FINDER); };
    const removeFinderChip    = (key: keyof FinderFilters) => {
        const reset = { ...finderActive, [key]: key === 'adFocus' ? [] : key === 'nordicOnly' ? false : '' };
        setFinderDraft(reset);
        setFinderActive(reset);
    };
    const toggleAdFocus = (f: AdFocus) =>
        setFinderDraft(prev => ({
            ...prev,
            adFocus: prev.adFocus.includes(f) ? prev.adFocus.filter(x => x !== f) : [...prev.adFocus, f],
        }));

    useEffect(() => {
        setCompanies(loadState());
        setDidHydrateFromStorage(true);
    }, []);

    useEffect(() => {
        if (!didHydrateFromStorage) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(companies));
    }, [companies, didHydrateFromStorage]);

    // ── Drag & Drop ──────────────────────────────────────────────────────────
    const onDragStart = (e: React.DragEvent, id: string) => {
        setDraggedId(id);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => {
            const el = document.getElementById(`card-${id}`);
            if (el) el.style.opacity = '0.35';
        }, 0);
    };

    const onDragEnd = (_: React.DragEvent, id: string) => {
        setDraggedId(null);
        setDragOverStage(null);
        const el = document.getElementById(`card-${id}`);
        if (el) el.style.opacity = '1';
    };

    const onDrop = (e: React.DragEvent, stage: FunnelStage) => {
        e.preventDefault();
        setDragOverStage(null);
        if (draggedId) {
            setCompanies(prev => prev.map(c => c.id === draggedId ? { ...c, stage } : c));
        }
    };

    // ── Mutations ────────────────────────────────────────────────────────────
    const removeCompany = (id: string) => {
        setCompanies(prev => prev.filter(c => c.id !== id));
    };

    const addFromPool = (poolItem: Omit<Company, 'stage'>) => {
        setCompanies(prev => [...prev, { ...poolItem, stage: 'prospect' }]);
    };

    const addCustom = () => {
        const name = customName.trim();
        if (!name) return;
        setCompanies(prev => [...prev, {
            id: `custom-${Date.now()}`,
            name,
            stage: 'prospect',
            isNordicActive: false,
            adFocus: 'secondary',
        }]);
        setCustomName('');
    };

    const resetToDefaults = () => {
        if (confirm('Reset funnel to default companies? This cannot be undone.')) {
            setCompanies(INITIAL_COMPANIES);
        }
    };

    // ── Live sponsor pool from trials API ────────────────────────────────────
    const { data: trialsData, isLoading: poolLoading } = useSWR<{ trials: { sponsor: string }[] }>(
        '/api/trials?region=Nordic',
        (url: string) => fetch(url).then(r => r.json())
    );

    const fullPool = useMemo((): Omit<Company, 'stage'>[] => {
        if (!trialsData?.trials) return [];
        const seen = new Set<string>();
        return trialsData.trials
            .map(t => t.sponsor?.trim())
            .filter((s): s is string => Boolean(s))
            .filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
            .map(name => ({
                id: `api-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                name,
                isNordicActive: true,
                adFocus: (KNOWN_AD_FOCUS[name.toLowerCase()] ?? 'secondary') as AdFocus,
            }));
    }, [trialsData]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const activeFunnelNames = new Set(companies.map(c => c.name.toLowerCase().trim()));
    const hasActiveFinderFilter = finderActive.name || finderActive.adFocus.length > 0 || finderActive.nordicOnly;
    const availableInPool = fullPool.filter(d => {
        if (activeFunnelNames.has(d.name.toLowerCase().trim())) return false;
        if (finderActive.name && !d.name.toLowerCase().includes(finderActive.name.toLowerCase())) return false;
        if (finderActive.adFocus.length > 0 && (!d.adFocus || !finderActive.adFocus.includes(d.adFocus))) return false;
        return true; // all API results are Nordic Active, so nordicOnly filter is always satisfied
    });

    const totalInFunnel  = companies.length;
    const totalContract  = companies.filter(c => c.stage === 'contract').length;

    return (
        <div style={{ maxWidth: '1600px', margin: '0 auto', padding: '24px' }}>

            {/* ── Header ── */}
            <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px' }}>
                <div>
                    <h1 style={{ fontSize: '26px', color: 'var(--text-primary)', marginBottom: '6px' }}>Partner Funnel</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Drag companies between stages. Hover a card to remove it.
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                        onClick={resetToDefaults}
                        style={{
                            background: 'none',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '8px',
                            padding: '8px 14px',
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        Reset to defaults
                    </button>

                    <div style={{
                        background: 'var(--brand-teal-dark)',
                        color: 'white',
                        padding: '14px 22px',
                        borderRadius: '50px',
                        maxWidth: '300px',
                        textAlign: 'center',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        boxShadow: '0 4px 12px rgba(44,107,102,0.2)',
                    }}>
                        <b>{totalInFunnel} companies</b> conducting AD clinical research
                        / active in the Nordics, of which {totalContract} have a platform development contract.
                        <div style={{ marginTop: '6px', fontWeight: 600, color: 'var(--brand-teal-light)' }}>
                            Customer &amp; Reference
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Legend ── */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                {(Object.entries(AD_FOCUS_META) as [AdFocus, typeof AD_FOCUS_META[AdFocus]][]).map(([key, meta]) => (
                    <LegendBadge key={key} label={meta.label} color={meta.color} bg={meta.bg} tooltip={meta.tooltip} />
                ))}
                <LegendBadge
                    label="Nordic Active"
                    color="var(--brand-teal)"
                    bg="rgba(79,209,197,0.12)"
                    tooltip={NORDIC_TOOLTIP}
                />
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>

                {/* ── Finder Panel ── */}
                <div className="linear-card" style={{
                    width: '290px',
                    flexShrink: 0,
                    padding: '18px',
                    background: 'var(--bg-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>Prospect Finder</h2>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' }}>
                        Filter AD companies and click to add to Prospect stage.
                    </p>

                    {/* ── Filters ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>

                        {/* Name search */}
                        <div>
                            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Company name</div>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="e.g. AstraZeneca"
                                value={finderDraft.name}
                                onChange={e => setFinderDraft(prev => ({ ...prev, name: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && applyFinderFilters()}
                                style={{ fontSize: '12px' }}
                            />
                        </div>

                        {/* AD Focus multi-select */}
                        <div>
                            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>AD focus</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {(Object.entries(AD_FOCUS_META) as [AdFocus, typeof AD_FOCUS_META[AdFocus]][]).map(([key, meta]) => {
                                    const active = finderDraft.adFocus.includes(key);
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => toggleAdFocus(key)}
                                            style={{
                                                fontSize: '11px',
                                                fontWeight: 500,
                                                padding: '3px 8px',
                                                borderRadius: '6px',
                                                border: `1px solid ${active ? meta.color : 'var(--border-subtle)'}`,
                                                background: active ? meta.bg : 'white',
                                                color: active ? meta.color : 'var(--text-secondary)',
                                                cursor: 'pointer',
                                                transition: 'all 0.12s',
                                            }}
                                        >
                                            {meta.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Nordic toggle */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                                type="checkbox"
                                checked={finderDraft.nordicOnly}
                                onChange={e => setFinderDraft(prev => ({ ...prev, nordicOnly: e.target.checked }))}
                            />
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Nordic Active only</span>
                        </label>
                    </div>

                    {/* Apply / Clear */}
                    <div style={{ display: 'flex', gap: '7px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', marginBottom: '10px' }}>
                        <button onClick={applyFinderFilters} className="btn-primary" style={{ flex: 1, fontSize: '12px', padding: '6px 0' }}>
                            Apply
                        </button>
                        <button onClick={clearFinderFilters} className="btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '6px 0' }}>
                            Clear
                        </button>
                    </div>

                    {/* Active filter chips */}
                    {hasActiveFinderFilter && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                            {finderActive.name && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: 'var(--brand-teal-light)', color: 'var(--brand-teal-dark)', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                    <span style={{ opacity: 0.65, textTransform: 'uppercase', fontSize: '10px' }}>name</span> {finderActive.name}
                                    <button onClick={() => removeFinderChip('name')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: '13px', lineHeight: 1, padding: 0 }}>×</button>
                                </span>
                            )}
                            {finderActive.adFocus.map(f => (
                                <span key={f} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: AD_FOCUS_META[f].bg, color: AD_FOCUS_META[f].color, padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                    {AD_FOCUS_META[f].label}
                                    <button onClick={() => setFinderActive(prev => ({ ...prev, adFocus: prev.adFocus.filter(x => x !== f) }))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: '13px', lineHeight: 1, padding: 0 }}>×</button>
                                </span>
                            ))}
                            {finderActive.nordicOnly && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: 'rgba(79,209,197,0.12)', color: 'var(--brand-teal)', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                    Nordic
                                    <button onClick={() => removeFinderChip('nordicOnly')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: '13px', lineHeight: 1, padding: 0 }}>×</button>
                                </span>
                            )}
                        </div>
                    )}

                    {/* Divider before add-custom */}
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Add custom</div>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Company name..."
                            value={customName}
                            onChange={e => setCustomName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addCustom()}
                            style={{ flex: 1, fontSize: '12px' }}
                        />
                        <button
                            onClick={addCustom}
                            disabled={!customName.trim()}
                            style={{
                                background: customName.trim() ? 'var(--brand-teal)' : 'var(--border-subtle)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                width: '32px',
                                cursor: customName.trim() ? 'pointer' : 'default',
                                fontSize: '20px',
                                lineHeight: 1,
                                transition: 'background 0.15s',
                            }}
                        >+</button>
                    </div>

                    {/* Pool list */}
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                        {poolLoading ? 'Loading...' : `Results (${availableInPool.length})`}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        {!poolLoading && availableInPool.length === 0 && (
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px 0', fontStyle: 'italic' }}>
                                {hasActiveFinderFilter ? 'No matches for these filters' : 'All prospects added to funnel'}
                            </div>
                        )}
                        {availableInPool.map((item: Omit<Company, 'stage'>) => {
                            const focus = item.adFocus ? AD_FOCUS_META[item.adFocus] : null;
                            return (
                                <div
                                    key={item.id}
                                    onClick={() => addFromPool(item)}
                                    style={{
                                        background: 'white',
                                        border: '1px solid var(--border-subtle)',
                                        borderRadius: '8px',
                                        padding: '9px 11px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        transition: 'all 0.12s ease',
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = 'var(--brand-teal)';
                                        e.currentTarget.style.transform = 'translateX(3px)';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                                        e.currentTarget.style.transform = 'translateX(0)';
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                                        <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
                                            {item.isNordicActive && (
                                                <span style={{ fontSize: '10px', color: 'var(--brand-teal)', background: 'rgba(79,209,197,0.12)', padding: '1px 5px', borderRadius: '4px' }}>Nordic</span>
                                            )}
                                            {focus && (
                                                <span style={{ fontSize: '10px', color: focus.color, background: focus.bg, padding: '1px 5px', borderRadius: '4px' }}>{focus.label}</span>
                                            )}
                                        </div>
                                    </div>
                                    <span style={{ color: 'var(--brand-teal)', fontSize: '17px', fontWeight: 'bold', marginLeft: '8px' }}>+</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Funnel Board ── */}
                <div style={{ flex: 1, display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '20px' }}>
                    {STAGES.map(stage => {
                        const stageCompanies = companies.filter(c => c.stage === stage.id);
                        const isDropTarget   = dragOverStage === stage.id && draggedId !== null;

                        return (
                            <div
                                key={stage.id}
                                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                                onDragLeave={() => setDragOverStage(null)}
                                onDrop={e => onDrop(e, stage.id)}
                                style={{ flex: 1, minWidth: '190px', display: 'flex', flexDirection: 'column', gap: '10px' }}
                            >
                                {/* Stage header */}
                                <div style={{
                                    background: isDropTarget ? `${stage.color}15` : 'white',
                                    border: `2px solid ${stage.color}`,
                                    borderRadius: '12px',
                                    padding: '13px 10px',
                                    textAlign: 'center',
                                    position: 'relative',
                                    transition: 'background 0.15s',
                                }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{stage.title}</div>
                                    {stage.subtitle && (
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>{stage.subtitle}</div>
                                    )}
                                    <div style={{
                                        position: 'absolute',
                                        bottom: '-11px',
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        background: stage.color,
                                        color: 'white',
                                        minWidth: '26px',
                                        height: '22px',
                                        padding: '0 6px',
                                        borderRadius: '11px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
                                        zIndex: 10,
                                    }}>
                                        {stageCompanies.length}
                                    </div>
                                </div>

                                {/* Cards container */}
                                <div style={{
                                    borderLeft:   `2px dashed ${isDropTarget ? stage.color : `${stage.color}50`}`,
                                    borderRight:  `2px dashed ${isDropTarget ? stage.color : `${stage.color}50`}`,
                                    borderBottom: `2px dashed ${isDropTarget ? stage.color : `${stage.color}50`}`,
                                    borderTop: 'none',
                                    borderBottomLeftRadius: '8px',
                                    borderBottomRightRadius: '8px',
                                    flex: 1,
                                    marginTop: '10px',
                                    padding: '12px 8px',
                                    minHeight: '400px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    background: isDropTarget ? `${stage.color}06` : 'rgba(255,255,255,0.4)',
                                    transition: 'all 0.15s ease',
                                }}>
                                    {stageCompanies.map(company => {
                                        const focus    = company.adFocus ? AD_FOCUS_META[company.adFocus] : null;
                                        const isHover  = hoveredId === company.id;

                                        return (
                                            <div
                                                key={company.id}
                                                id={`card-${company.id}`}
                                                draggable
                                                onDragStart={e => onDragStart(e, company.id)}
                                                onDragEnd={e => onDragEnd(e, company.id)}
                                                onMouseEnter={() => setHoveredId(company.id)}
                                                onMouseLeave={() => setHoveredId(null)}
                                                style={{
                                                    background: 'white',
                                                    border: `1px solid ${isHover ? stage.color : 'var(--border-subtle)'}`,
                                                    borderRadius: '8px',
                                                    padding: '10px 10px 10px 12px',
                                                    cursor: 'grab',
                                                    userSelect: 'none',
                                                    transition: 'all 0.12s ease',
                                                    boxShadow: isHover
                                                        ? `0 3px 10px ${stage.color}25`
                                                        : '0 1px 3px rgba(0,0,0,0.05)',
                                                    transform: isHover ? 'translateY(-1px)' : 'translateY(0)',
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            color: 'var(--text-primary)',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }}>
                                                            {company.name}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                                                            {company.isNordicActive && (
                                                                <span style={{ fontSize: '10px', color: 'var(--brand-teal)', background: 'rgba(79,209,197,0.12)', padding: '1px 5px', borderRadius: '4px', lineHeight: '1.5' }}>Nordic</span>
                                                            )}
                                                            {focus && (
                                                                <span style={{ fontSize: '10px', color: focus.color, background: focus.bg, padding: '1px 5px', borderRadius: '4px', lineHeight: '1.5' }}>{focus.label}</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Delete button — visible on hover */}
                                                    <button
                                                        onClick={e => { e.stopPropagation(); removeCompany(company.id); }}
                                                        title="Remove from funnel"
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            color: isHover ? '#E53E3E' : 'transparent',
                                                            fontSize: '17px',
                                                            lineHeight: 1,
                                                            padding: '0',
                                                            flexShrink: 0,
                                                            transition: 'color 0.12s ease',
                                                            fontWeight: 400,
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {stageCompanies.length === 0 && (
                                        <div style={{
                                            flex: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'var(--text-tertiary)',
                                            fontSize: '12px',
                                            fontStyle: 'italic',
                                            pointerEvents: 'none',
                                        }}>
                                            {isDropTarget ? 'Release to drop' : 'Drop here'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
