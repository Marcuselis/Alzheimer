/**
 * Email verification module.
 *
 * Verification hierarchy (honest about what each step can actually tell you):
 *
 *   published   — email scraped verbatim from an official institution page
 *   verified    — pattern-inferred, domain has MX, SMTP says mailbox exists, domain is NOT catch-all
 *   inferred    — pattern-inferred, domain has MX, but SMTP unavailable/blocked or catch-all
 *   catch_all   — domain accepts all RCPT TO regardless — SMTP positive means nothing
 *   rejected    — SMTP server explicitly rejected the recipient (250 vs 5xx)
 *   unknown     — MX lookup failed or connection timed out
 *
 * Limitations (documented here, not hidden):
 *   - Many institutional SMTP servers block port 25 probing entirely
 *   - Many use catch-all mailboxes — especially European universities
 *   - Rate-limiting / tarpit responses are common
 *   - This is ONE signal, not truth. "published" is always stronger.
 */

import * as dns from 'dns/promises';
import * as net from 'net';

export type VerificationStatus = 'published' | 'verified' | 'inferred' | 'catch_all' | 'rejected' | 'unknown';

export interface VerificationResult {
  status: VerificationStatus;
  mxValid: boolean;
  catchAll: boolean | null; // null = could not determine
  smtpResponse: string | null;
  checkedAt: Date;
}

const SMTP_TIMEOUT_MS = 8_000;
const SMTP_HELO_DOMAIN = 'medino.com'; // our sending domain for HELO
const PROBE_FROM = 'verify@medino.com'; // sender used in MAIL FROM during probe

// Domains known to be catch-all (skip SMTP verification for these)
const KNOWN_CATCH_ALL_DOMAINS = new Set([
  'ki.se',
  'uu.se',
  'lu.se',
  'gu.se',
  'uio.no',
  'ku.dk',
  'helsinki.fi',
  'cam.ac.uk',
  'ox.ac.uk',
  // Add more as discovered
]);

// Domains that block all external SMTP probing
const KNOWN_SMTP_BLOCKED = new Set([
  'mayo.edu',
  'harvard.edu',
  'stanford.edu',
  'nih.gov',
  'fda.gov',
]);

/**
 * Resolve MX records for a domain.
 * Returns true if at least one MX record exists.
 */
async function checkMX(domain: string): Promise<{ valid: boolean; mxHosts: string[] }> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return { valid: false, mxHosts: [] };
    const sorted = records.sort((a, b) => a.priority - b.priority);
    return { valid: true, mxHosts: sorted.map(r => r.exchange) };
  } catch {
    // ENODATA, ENOTFOUND, etc.
    return { valid: false, mxHosts: [] };
  }
}

/**
 * SMTP probe: connect to MX host and issue RCPT TO.
 * Returns the SMTP response string and whether it was a 250 (accepted) or 5xx (rejected).
 *
 * Note: many servers respond 250 to everything (catch-all) or just disconnect.
 * That's why you need the catch-all detection step separately.
 */
async function smtpProbe(
  mxHost: string,
  emailAddress: string
): Promise<{ accepted: boolean; response: string } | null> {
  return new Promise(resolve => {
    let resolved = false;
    let buffer = '';

    const done = (result: { accepted: boolean; response: string } | null) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    const socket = net.createConnection({ host: mxHost, port: 25 });
    socket.setTimeout(SMTP_TIMEOUT_MS);

    socket.on('timeout', () => done(null));
    socket.on('error', () => done(null));

    const send = (line: string) => socket.write(line + '\r\n');

    let step = 0;

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3), 10);
        const isFinal = line.charAt(3) !== '-'; // multi-line responses use '-'

        if (!isFinal) continue;

        switch (step) {
          case 0: // greeting
            if (code === 220) { send(`HELO ${SMTP_HELO_DOMAIN}`); step = 1; }
            else done(null);
            break;
          case 1: // HELO response
            if (code === 250) { send(`MAIL FROM:<${PROBE_FROM}>`); step = 2; }
            else done(null);
            break;
          case 2: // MAIL FROM response
            if (code === 250) { send(`RCPT TO:<${emailAddress}>`); step = 3; }
            else done(null);
            break;
          case 3: // RCPT TO response — this is the money step
            send('QUIT');
            done({ accepted: code === 250, response: line });
            break;
          default:
            done(null);
        }
      }
    });
  });
}

/**
 * Detect catch-all: probe a definitely-nonexistent address on the same domain.
 * If it's also accepted, the domain accepts everything.
 */
async function detectCatchAll(mxHost: string, domain: string): Promise<boolean | null> {
  const nonce = Math.random().toString(36).substring(2, 10);
  const fakeAddress = `definitely-does-not-exist-${nonce}@${domain}`;

  const result = await smtpProbe(mxHost, fakeAddress);
  if (result === null) return null; // could not determine
  return result.accepted; // if accepted → catch-all
}

/**
 * Main verification entry point.
 *
 * If the email is already labeled 'published', skip SMTP (trust the page scrape).
 * For inferred emails, run the full MX + SMTP + catch-all pipeline.
 */
export async function verifyEmail(
  email: string,
  currentLabel: 'published' | 'inferred' | null
): Promise<VerificationResult> {
  // Published emails scraped from official pages — trust them directly
  if (currentLabel === 'published') {
    return {
      status: 'published',
      mxValid: true,
      catchAll: null,
      smtpResponse: null,
      checkedAt: new Date(),
    };
  }

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return { status: 'unknown', mxValid: false, catchAll: null, smtpResponse: null, checkedAt: new Date() };
  }

  // Known catch-all domains — don't waste time on SMTP
  if (KNOWN_CATCH_ALL_DOMAINS.has(domain)) {
    const { valid } = await checkMX(domain);
    return {
      status: 'inferred',
      mxValid: valid,
      catchAll: true,
      smtpResponse: null,
      checkedAt: new Date(),
    };
  }

  // Known SMTP-blocked domains
  if (KNOWN_SMTP_BLOCKED.has(domain)) {
    const { valid } = await checkMX(domain);
    return {
      status: valid ? 'inferred' : 'unknown',
      mxValid: valid,
      catchAll: null,
      smtpResponse: null,
      checkedAt: new Date(),
    };
  }

  // Step 1: MX lookup
  const { valid: mxValid, mxHosts } = await checkMX(domain);
  if (!mxValid || mxHosts.length === 0) {
    return { status: 'unknown', mxValid: false, catchAll: null, smtpResponse: null, checkedAt: new Date() };
  }

  const mxHost = mxHosts[0];

  // Step 2: Catch-all detection
  const isCatchAll = await detectCatchAll(mxHost, domain);

  if (isCatchAll === true) {
    // Add to known catch-all set for this session
    KNOWN_CATCH_ALL_DOMAINS.add(domain);
    return {
      status: 'catch_all',
      mxValid: true,
      catchAll: true,
      smtpResponse: null,
      checkedAt: new Date(),
    };
  }

  // Step 3: SMTP probe for the actual address
  const smtpResult = await smtpProbe(mxHost, email);

  if (smtpResult === null) {
    // SMTP blocked or timed out
    return {
      status: 'inferred',
      mxValid: true,
      catchAll: isCatchAll,
      smtpResponse: null,
      checkedAt: new Date(),
    };
  }

  if (smtpResult.accepted) {
    return {
      status: 'verified',
      mxValid: true,
      catchAll: false,
      smtpResponse: smtpResult.response,
      checkedAt: new Date(),
    };
  } else {
    return {
      status: 'rejected',
      mxValid: true,
      catchAll: false,
      smtpResponse: smtpResult.response,
      checkedAt: new Date(),
    };
  }
}

/**
 * Confidence score adjustment based on verification status.
 * Call this AFTER verifyEmail() to correct the initial confidence estimate.
 */
export function adjustConfidenceForVerification(
  baseConfidence: number,
  status: VerificationStatus
): number {
  switch (status) {
    case 'published':  return Math.max(baseConfidence, 0.90);
    case 'verified':   return Math.max(baseConfidence, 0.72);
    case 'inferred':   return Math.min(baseConfidence, 0.55);
    case 'catch_all':  return Math.min(baseConfidence, 0.40);
    case 'rejected':   return 0.02;
    case 'unknown':    return Math.min(baseConfidence, 0.30);
    default:           return baseConfidence;
  }
}
