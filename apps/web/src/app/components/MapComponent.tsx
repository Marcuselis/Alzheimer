'use client';

import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getCoordinates } from '../../lib/locations';
import Link from 'next/link';

interface Trial {
    nct_id: string;
    title: string;
    sponsor: string;
    phase: string;
    status: string;
    locations: string;
}

export default function MapComponent({ trials }: { trials: Trial[] }) {
    const markers: { position: [number, number], trial: Trial, location: string }[] = [];

    if (trials && trials.length > 0) {
        trials.forEach(trial => {
            if (!trial.locations) return;

            const locs = trial.locations.split('|');
            locs.forEach((loc, idx) => {
                const coords = getCoordinates(loc);
                if (coords) {
                    // Deterministic jitter based on NCT ID + location index for stability
                    const seed = trial.nct_id + idx;
                    let hash = 0;
                    for (let i = 0; i < seed.length; i++) {
                        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
                        hash |= 0;
                    }

                    const jitterLat = (Math.abs(hash % 100) / 100 - 0.5) * 1.5;
                    const jitterLng = (Math.abs((hash >> 8) % 100) / 100 - 0.5) * 1.5;

                    markers.push({
                        position: [coords[0] + jitterLat, coords[1] + jitterLng],
                        trial,
                        location: loc.trim()
                    });
                }
            });
        });
    }

    return (
        <div style={{
            height: '600px',
            width: '100%',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
        }}>
            <MapContainer
                center={[20, 0]}
                zoom={2.5}
                minZoom={2}
                maxBounds={[[-90, -180], [90, 180]]}
                maxBoundsViscosity={1.0}
                style={{ height: '100%', width: '100%', background: '#f8fafc' }}
                zoomControl={false}
                attributionControl={false}
                worldCopyJump={false}
            >
                {/* Voyager style - Reverted as requested */}
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
                    noWrap={true}
                    bounds={[[-90, -180], [90, 180]]}
                />
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
                    noWrap={true}
                    bounds={[[-90, -180], [90, 180]]}
                />

                <ZoomControl position="bottomright" />

                {markers.map((m, idx) => (
                    <CircleMarker
                        key={`${m.trial.nct_id}-${idx}`}
                        center={m.position}
                        radius={6}
                        pathOptions={{
                            color: '#ffffff',
                            fillColor: '#469B94', // Brand Teal
                            fillOpacity: 0.9,
                            weight: 1.5
                        }}
                    >
                        <Popup className="linear-popup">
                            <div style={{
                                padding: '12px',
                                minWidth: '240px',
                                fontFamily: 'var(--font-sans)',
                                color: 'var(--text-primary)'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '8px',
                                    paddingBottom: '8px',
                                    borderBottom: '1px solid var(--border-subtle)'
                                }}>
                                    <Link href={`https://clinicaltrials.gov/study/${m.trial.nct_id}`} target="_blank" style={{
                                        color: 'var(--brand-teal)',
                                        fontWeight: '600',
                                        fontSize: '12px',
                                        letterSpacing: '0.02em'
                                    }}>
                                        {m.trial.nct_id}
                                    </Link>
                                    <span style={{
                                        fontSize: '10px',
                                        fontWeight: '600',
                                        background: m.trial.status === 'RECRUITING' ? '#E6F5F4' : '#F1F5F9',
                                        color: m.trial.status === 'RECRUITING' ? '#0F766E' : '#64748B',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        textTransform: 'uppercase'
                                    }}>
                                        {m.trial.status?.replace(/_/g, ' ')}
                                    </span>
                                </div>

                                <div style={{
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    lineHeight: '1.4',
                                    marginBottom: '6px',
                                    color: 'var(--text-primary)'
                                }}>
                                    {m.trial.title}
                                </div>

                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '10px'
                                }}>
                                    {m.trial.sponsor}
                                </div>

                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--text-tertiary)',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '4px'
                                }}>
                                    <span style={{ marginTop: '2px' }}>📍</span>
                                    <span>{m.location}</span>
                                </div>
                            </div>
                        </Popup>
                    </CircleMarker>
                ))}
            </MapContainer>
        </div>
    );
}
