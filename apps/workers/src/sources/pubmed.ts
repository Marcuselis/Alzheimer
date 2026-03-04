import fetch from 'node-fetch';
import { Paper, PaperSchema } from '@app/shared';

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EFETCH_BATCH_SIZE = 100;
const EFETCH_CONCURRENCY = 2;
const PUBMED_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function searchLiterature(
  moleculeName: string,
  synonyms: string[] = [],
  options: { recencyDays?: number; maxResults?: number } = {}
): Promise<Paper[]> {
  const { recencyDays = 365, maxResults = 200 } = options;
  
  try {
    const moleculeTerms = [moleculeName, ...synonyms].map(s => `"${s}"`).join(' OR ');
    const query = `(${moleculeTerms}) AND (Alzheimer OR "Alzheimer's disease" OR dementia)`;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - recencyDays);
    const dateStr = cutoffDate.toISOString().split('T')[0].replace(/-/g, '/');
    const dateQuery = `(${dateStr}:3000[PDAT])`;
    const fullQuery = `${query} AND ${dateQuery}`;
    
    console.log(`[PubMed] Searching: ${fullQuery}`);
    
    const searchUrl = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(fullQuery)}&retmax=${maxResults}&retmode=json`;
    const searchResponse = await fetch(searchUrl, { timeout: 30000 } as any);
    
    if (!searchResponse.ok) {
      throw new Error(`PubMed esearch error: ${searchResponse.status}`);
    }
    
    const searchData: any = await searchResponse.json();
    const pmids = searchData.esearchresult?.idlist || [];
    
    if (pmids.length === 0) {
      return [];
    }
    
    await delay(100);
    
    const batches: string[][] = [];
    for (let i = 0; i < pmids.length; i += EFETCH_BATCH_SIZE) {
      batches.push(pmids.slice(i, i + EFETCH_BATCH_SIZE));
    }
    
    const papers: Paper[] = [];
    for (let b = 0; b < batches.length; b += EFETCH_CONCURRENCY) {
      const chunk = batches.slice(b, b + EFETCH_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (batch) => {
          const fetchUrl = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&id=${batch.join(',')}&retmode=xml`;
          const fetchResponse = await fetch(fetchUrl, { timeout: 60000 } as any);
          if (!fetchResponse.ok) return [];
          const xmlText = await fetchResponse.text();
          return parsePubMedXML(xmlText);
        })
      );
      results.forEach((batchPapers) => papers.push(...batchPapers));
      if (b + EFETCH_CONCURRENCY < batches.length) {
        await delay(PUBMED_DELAY_MS);
      }
    }
    
    const tagged = papers.map(p => tagPaper(p, moleculeName));
    const deduped = dedupeByPMID(tagged);
    deduped.sort((a, b) => (b.year || 0) - (a.year || 0));
    
    return deduped;
  } catch (error) {
    console.error(`[PubMed] Error:`, error);
    throw error;
  }
}

function parsePubMedXML(xmlText: string): Paper[] {
  const papers: Paper[] = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  
  while ((match = articleRegex.exec(xmlText)) !== null) {
    const articleXml = match[1];
    const pmid = extractXMLField(articleXml, 'PMID');
    const title = extractXMLField(articleXml, 'ArticleTitle');
    const abstract = extractXMLField(articleXml, 'AbstractText');
    const journal = extractXMLField(articleXml, 'Title');
    const year = parseInt(extractXMLField(articleXml, 'Year') || '0', 10);
    
    const authors: string[] = [];
    const authorRegex = /<Author>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]+)<\/ForeName>[\s\S]*?<\/Author>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(articleXml)) !== null) {
      authors.push(`${authorMatch[2]} ${authorMatch[1]}`);
    }
    
    const publicationTypes: string[] = [];
    const pubTypeRegex = /<PublicationType>([^<]+)<\/PublicationType>/g;
    let typeMatch;
    while ((typeMatch = pubTypeRegex.exec(articleXml)) !== null) {
      publicationTypes.push(typeMatch[1]);
    }
    
    if (pmid && title) {
      papers.push(PaperSchema.parse({
        pmid,
        title,
        journal: journal || 'Unknown',
        year: year || new Date().getFullYear(),
        authors: authors.slice(0, 5),
        abstract: abstract || '',
        publicationTypes,
      }));
    }
  }
  
  return papers;
}

function extractXMLField(xml: string, fieldName: string): string {
  const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function tagPaper(paper: Paper, moleculeName: string): Paper {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  const tags: string[] = [];
  
  if (text.includes('efficacy') || text.includes('effective')) tags.push('efficacy');
  if (text.includes('safety') || text.includes('adverse')) tags.push('safety');
  if (text.includes('biomarker') || text.includes('amyloid')) tags.push('biomarker');
  if (text.includes('mechanism') || text.includes('pathway')) tags.push('mechanism');
  if (text.includes('phase 2') || text.includes('phase ii')) tags.push('phase2');
  if (text.includes('phase 3') || text.includes('phase iii')) tags.push('phase3');
  
  const relevanceScore = (text.match(new RegExp(moleculeName.toLowerCase(), 'g')) || []).length;
  
  return { ...paper, tags, relevanceScore };
}

function dedupeByPMID(papers: Paper[]): Paper[] {
  const seen = new Set<string>();
  return papers.filter(p => {
    if (seen.has(p.pmid)) return false;
    seen.add(p.pmid);
    return true;
  });
}
