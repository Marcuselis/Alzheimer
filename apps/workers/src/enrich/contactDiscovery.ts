import { Pool } from 'pg';
import { searchWeb, WebSearchResult } from '../sources/webSearch';

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app',
});

export interface ContactCandidate {
  fullName: string | null;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  confidence: 'low' | 'medium' | 'high';
  evidence: {
    links: Array<{ url: string; title: string; snippet: string }>;
    query: string;
  };
  score: number;
}

export interface ContactDiscoveryInput {
  sponsorId: string;
  marketId: string;
  sponsorName: string;
  personaRoles: {
    painOwnerPersona: string;
    decisionOwnerPersona: string;
  };
  sponsorDomain?: string; // Optional: if we know the sponsor's domain
}

/**
 * Extract name, title, and company from search result title/snippet
 */
function parseCandidateFromResult(
  result: WebSearchResult,
  sponsorName: string
): { fullName: string | null; title: string | null; company: string | null } {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const sponsorLower = sponsorName.toLowerCase();

  // Try to extract name (usually before "-" or "|" or "at")
  let fullName: string | null = null;
  let title: string | null = null;
  let company: string | null = null;

  // Pattern 1: "Jane Doe - VP Clinical Operations - Sponsor | LinkedIn"
  const pattern1 = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-|]\s*(.+?)(?:\s*[-|]\s*(.+))?$/i;
  const match1 = result.title.match(pattern1);
  if (match1) {
    fullName = match1[1].trim();
    const rest = match1[2] || '';
    if (rest.toLowerCase().includes('linkedin')) {
      title = null; // LinkedIn is not a title
    } else {
      title = rest.trim();
    }
    company = match1[3]?.trim() || null;
  }

  // Pattern 2: "John Smith, Head of Clinical Operations, Sponsor"
  const pattern2 = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),\s*(.+?)(?:,\s*(.+))?$/i;
  const match2 = result.title.match(pattern2);
  if (match2 && !fullName) {
    fullName = match2[1].trim();
    title = match2[2].trim();
    company = match2[3]?.trim() || null;
  }

  // Pattern 3: Extract from snippet if title didn't work
  if (!fullName) {
    // Look for "Name - Title" pattern in snippet
    const snippetPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-|]\s*(.+?)(?:\s*[-|])/i;
    const snippetMatch = result.snippet.match(snippetPattern);
    if (snippetMatch) {
      fullName = snippetMatch[1].trim();
      title = snippetMatch[2].trim();
    }
  }

  // Extract title keywords if we have text but no structured title
  if (!title && text) {
    const titleKeywords = [
      'vp', 'vice president', 'director', 'head', 'chief', 'senior',
      'clinical operations', 'clinical development', 'trial', 'monitoring',
      'lead', 'manager', 'executive'
    ];
    for (const keyword of titleKeywords) {
      if (text.includes(keyword)) {
        // Try to extract surrounding context
        const keywordIndex = text.indexOf(keyword);
        const start = Math.max(0, keywordIndex - 30);
        const end = Math.min(text.length, keywordIndex + keyword.length + 30);
        const context = text.substring(start, end);
        title = context.trim();
        break;
      }
    }
  }

  // Extract company if sponsor name appears
  if (text.includes(sponsorLower) && !company) {
    company = sponsorName;
  }

  return { fullName, title, company };
}

/**
 * Score a candidate based on various factors
 */
function scoreCandidate(
  candidate: { fullName: string | null; title: string | null; company: string | null; linkedinUrl: string | null },
  result: WebSearchResult,
  sponsorName: string,
  personaRole: string,
  personaType: 'pain_owner' | 'decision_owner'
): number {
  let score = 0;
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const sponsorLower = sponsorName.toLowerCase();
  const roleLower = personaRole.toLowerCase();

  // +40 if LinkedIn profile URL
  if (candidate.linkedinUrl && candidate.linkedinUrl.includes('linkedin.com/in/')) {
    score += 40;
  }

  // +20 if snippet/title contains sponsor name
  if (text.includes(sponsorLower)) {
    score += 20;
  }

  // +15 if title contains persona keywords
  const personaKeywords = [
    'clinical operations', 'clinical development', 'trial monitoring',
    'clinical ops', 'trial management', 'clinical systems'
  ];
  if (candidate.title) {
    const titleLower = candidate.title.toLowerCase();
    for (const keyword of personaKeywords) {
      if (titleLower.includes(keyword)) {
        score += 15;
        break;
      }
    }
  }

  // +10 if seniority matches persona
  if (candidate.title) {
    const titleLower = candidate.title.toLowerCase();
    if (personaType === 'decision_owner') {
      // Decision owner should be VP/Chief level
      if (titleLower.includes('vp') || titleLower.includes('vice president') || 
          titleLower.includes('chief') || titleLower.includes('cmo') || 
          titleLower.includes('head of')) {
        score += 10;
      }
    } else {
      // Pain owner should be Director/Head level
      if (titleLower.includes('director') || titleLower.includes('head') || 
          titleLower.includes('lead') || titleLower.includes('manager')) {
        score += 10;
      }
    }
  }

  // -20 if appears to be recruiter/job post
  if (text.includes('recruiter') || text.includes('hiring') || 
      text.includes('job opening') || text.includes('careers') ||
      result.url.includes('/jobs/') || result.url.includes('/job/')) {
    score -= 20;
  }

  // -20 if company mismatch (if we have company info)
  if (candidate.company && !text.includes(sponsorLower) && 
      !candidate.company.toLowerCase().includes(sponsorLower)) {
    score -= 20;
  }

  return score;
}

/**
 * Map score to confidence level
 */
function scoreToConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Compute contacts for a sponsor based on persona recommendations
 */
export async function computeContactsForSponsor(
  input: ContactDiscoveryInput
): Promise<{ pain_owner: ContactCandidate[]; decision_owner: ContactCandidate[] }> {
  const { sponsorId, marketId, sponsorName, personaRoles, sponsorDomain } = input;

  const results: {
    pain_owner: ContactCandidate[];
    decision_owner: ContactCandidate[];
  } = {
    pain_owner: [],
    decision_owner: [],
  };

  // Process each persona type
  for (const personaType of ['pain_owner', 'decision_owner'] as const) {
    const personaRole = personaType === 'pain_owner' 
      ? personaRoles.painOwnerPersona 
      : personaRoles.decisionOwnerPersona;

    // Build 4 search queries
    const queries = [
      `"${sponsorName}" "${personaRole}"`,
      `site:linkedin.com/in "${sponsorName}" "${personaRole}"`,
      `"${personaRole}" "${sponsorName}" LinkedIn`,
      `${sponsorName} clinical operations leadership`,
    ];

    // Run all queries and merge results
    const allResults: Map<string, WebSearchResult> = new Map();
    
    for (const query of queries) {
      try {
        const searchResults = await searchWeb(query, 10);
        for (const result of searchResults) {
          // Dedupe by URL
          if (!allResults.has(result.url)) {
            allResults.set(result.url, result);
          }
        }
        // Small delay between queries to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[ContactDiscovery] Search error for query "${query}":`, error.message);
        // Continue with other queries
      }
    }

    // Extract candidates from results
    const candidates: ContactCandidate[] = [];

    for (const result of Array.from(allResults.values()).slice(0, 20)) {
      // Check if it's a LinkedIn profile
      const isLinkedIn = result.url.includes('linkedin.com/in/');
      
      // Check if it's a credible source
      const isCredible = isLinkedIn || 
        result.url.includes(sponsorName.toLowerCase().replace(/\s+/g, '')) ||
        result.url.includes('.com/team') ||
        result.url.includes('.com/about') ||
        result.url.includes('.com/leadership') ||
        result.url.includes('conference') ||
        result.url.includes('press-release');

      if (!isCredible) {
        continue; // Skip non-credible sources
      }

      // Parse candidate info
      const parsed = parseCandidateFromResult(result, sponsorName);
      
      // Extract LinkedIn URL if present
      let linkedinUrl: string | null = null;
      if (isLinkedIn) {
        linkedinUrl = result.url;
      } else {
        // Check if snippet contains LinkedIn URL
        const linkedinMatch = result.snippet.match(/linkedin\.com\/in\/[a-z0-9-]+/i);
        if (linkedinMatch) {
          linkedinUrl = `https://www.${linkedinMatch[0]}`;
        }
      }

      // Only create candidate if we have at least a name or LinkedIn URL
      if (!parsed.fullName && !linkedinUrl) {
        continue;
      }

      // Score the candidate
      const score = scoreCandidate(
        { ...parsed, linkedinUrl },
        result,
        sponsorName,
        personaRole,
        personaType
      );

      const confidence = scoreToConfidence(score);

      // Only include candidates with at least low confidence
      if (score > 0) {
        candidates.push({
          fullName: parsed.fullName,
          title: parsed.title,
          company: parsed.company || sponsorName,
          linkedinUrl,
          confidence,
          evidence: {
            links: [{
              url: result.url,
              title: result.title,
              snippet: result.snippet,
            }],
            query: queries.join('; '),
          },
          score,
        });
      }
    }

    // Sort by score and take top 3
    candidates.sort((a, b) => b.score - a.score);
    results[personaType] = candidates.slice(0, 3);
  }

  return results;
}

/**
 * Store contacts in database
 */
export async function storeContactsForSponsor(
  sponsorId: string,
  marketId: string,
  personaRoles: { painOwnerPersona: string; decisionOwnerPersona: string },
  contacts: { pain_owner: ContactCandidate[]; decision_owner: ContactCandidate[] }
): Promise<void> {
  // Delete old candidates for this sponsor/persona (older than 30 days)
  await db.query(`
    DELETE FROM contact_candidates
    WHERE sponsor_id = $1 AND market_id = $2
    AND computed_at < NOW() - INTERVAL '30 days'
  `, [sponsorId, marketId]);

  // Insert new candidates
  for (const personaType of ['pain_owner', 'decision_owner'] as const) {
    const personaRole = personaType === 'pain_owner' 
      ? personaRoles.painOwnerPersona 
      : personaRoles.decisionOwnerPersona;

    for (const candidate of contacts[personaType]) {
      try {
        await db.query(`
          INSERT INTO contact_candidates (
            sponsor_id, market_id, persona_type, persona_role,
            full_name, title, company, linkedin_url, source, confidence, evidence_json, computed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT DO NOTHING
        `, [
          sponsorId,
          marketId,
          personaType,
          personaRole,
          candidate.fullName,
          candidate.title,
          candidate.company,
          candidate.linkedinUrl,
          'public_web',
          candidate.confidence,
          JSON.stringify(candidate.evidence),
        ]);
      } catch (error: any) {
        // Skip duplicates (unique constraint violations)
        if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
          console.error(`[ContactDiscovery] Error storing candidate:`, error.message);
        }
      }
    }
  }
}
