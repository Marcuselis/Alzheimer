'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [navSearch, setNavSearch] = useState('');

  const handleNavSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (navSearch.trim().length >= 2) {
      router.push(`/literature?q=${encodeURIComponent(navSearch.trim())}`);
      setNavSearch(''); // Clear after search
    }
  };

  const navItems = [
    { href: '/market-scan', label: 'Market Scan' },
    { href: '/map', label: 'Trial Map' },
    { href: '/literature', label: 'Literature' },
    { href: '/funnel', label: 'Prospect Funnel' },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <nav style={{
      background: 'rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border-subtle)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div className="container" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '60px', /* Linear standard header height */
        padding: '0 20px',
        maxWidth: '1400px',
        gap: '24px'
      }}>
        {/* Logo Area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px', flex: 1 }}>
          <Link href="/" style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%'
          }}>
            <Image
              src="/medinologo4.svg"
              alt="Medino Logo"
              width={180}
              height={70}
              style={{ height: 'auto', width: 'auto', maxHeight: '58px' }}
              priority
            />
          </Link>

          {/* Nav Search bar */}
          <form onSubmit={handleNavSearch} style={{ position: 'relative', width: '300px' }}>
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              placeholder="Search literature..."
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              style={{
                width: '100%',
                height: '32px',
                padding: '0 12px 0 32px',
                fontSize: '13px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-subtle)',
                outline: 'none',
                transition: 'all 0.1s ease',
                color: 'var(--text-primary)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand-teal)';
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(20, 184, 166, 0.1)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.background = 'var(--bg-subtle)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </form>
        </div>

        {/* Navigation Links */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {navItems.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--bg-subtle)' : 'transparent',
                  transition: 'all 0.15s ease'
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

