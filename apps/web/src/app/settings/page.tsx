'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    dataMode: 'public',
    tamDefaults: {},
    litDefaults: {},
    statsDefaults: {},
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('v4_settings');
    if (stored) {
      try {
        setSettings(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse settings:', e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('v4_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', letterSpacing: '-0.02em', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Configure your workspace preferences and data sources.
        </p>
      </div>

      <div className="linear-card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>General</h2>

        <div style={{ marginBottom: '24px' }}>
          <label className="label-uppercase" style={{ marginBottom: '8px' }}>Data Mode</label>
          <div style={{ maxWidth: '300px' }}>
            <select
              className="form-select"
              value={settings.dataMode}
              onChange={(e) => setSettings({ ...settings, dataMode: e.target.value })}
            >
              <option value="public">Public Data (Live)</option>
              <option value="synthetic">Synthetic Data (Test)</option>
            </select>
          </div>
          <p style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Choose whether to pull live data from public APIs or use internal synthetic datasets for testing.
          </p>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
          <button
            onClick={handleSave}
            className="btn-primary"
            style={{ minWidth: '100px' }}
          >
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="linear-card" style={{ marginBottom: '24px', opacity: 0.7 }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Default Assumptions</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          Configure default values for TAM calculations, literature analysis, and statistics.
        </p>
        <div style={{ padding: '12px', background: 'var(--bg-subtle)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-tertiary)', border: '1px dashed var(--border-subtle)' }}>
          Advanced assumption configuration modules are currently disabled.
        </div>
      </div>

      <div className="linear-card" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-primary)' }}>Admin</h2>
        <Link href="/admin/data-quality" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-subtle)',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          fontSize: '13px',
          fontWeight: 500,
        }}>
          Data Quality Dashboard
        </Link>
      </div>

      <div className="linear-card" style={{ backgroundColor: '#F8FAFC' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-primary)' }}>Environment Info</h3>
        <div style={{ display: 'grid', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>API Connection</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--brand-teal)' }}>Active</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>ClinicalTrials.gov</span>
            <span style={{ fontFamily: 'monospace' }}>v2 API</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>PubMed</span>
            <span style={{ fontFamily: 'monospace' }}>NCBI E-Utilities</span>
          </div>
        </div>
      </div>
    </div>
  );
}
