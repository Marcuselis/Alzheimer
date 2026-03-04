const fetch = require('node-fetch');
const Cache = require('../cache');

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * Search PubMed for papers related to molecule + Alzheimer's
 */
async function searchLiterature(moleculeName, synonyms = [], options = {}) {
    const {
        recencyDays = 365,
        maxResults = 200,
        articleTypes = ['Clinical Trial', 'Review', 'Meta-Analysis']
    } = options;
    
    const cacheKey = `pubmed_${moleculeName.toLowerCase().trim()}_${recencyDays}_${maxResults}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
        console.log(`[PubMed] Cache hit for: ${moleculeName}`);
        return cached;
    }
    
    try {
        // Build query: molecule OR synonyms + Alzheimer keywords
        const moleculeTerms = [moleculeName, ...synonyms].map(s => `"${s}"`).join(' OR ');
        const query = `(${moleculeTerms}) AND (Alzheimer OR "Alzheimer's disease" OR dementia)`;
        
        // Calculate date filter (PDAT field)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - recencyDays);
        const dateStr = cutoffDate.toISOString().split('T')[0].replace(/-/g, '/');
        const dateQuery = `(${dateStr}:3000[PDAT])`;
        
        const fullQuery = `${query} AND ${dateQuery}`;
        
        console.log(`[PubMed] Searching: ${fullQuery}`);
        
        // Step 1: esearch to get PMIDs
        const searchUrl = `${PUBMED_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(fullQuery)}&retmax=${maxResults}&retmode=json`;
        const searchResponse = await fetch(searchUrl, { timeout: 30000 });
        
        if (!searchResponse.ok) {
            throw new Error(`PubMed esearch error: ${searchResponse.status}`);
        }
        
        const searchData = await searchResponse.json();
        const pmids = searchData.esearchresult?.idlist || [];
        
        if (pmids.length === 0) {
            console.log(`[PubMed] No results for: ${moleculeName}`);
            Cache.set(cacheKey, [], 24 * 3600);
            return [];
        }
        
        console.log(`[PubMed] Found ${pmids.length} PMIDs, fetching details...`);
        
        // Step 2: efetch to get full details (batch in groups of 100)
        const papers = [];
        for (let i = 0; i < pmids.length; i += 100) {
            const batch = pmids.slice(i, i + 100);
            const fetchUrl = `${PUBMED_BASE}/efetch.fcgi?db=pubmed&id=${batch.join(',')}&retmode=xml`;
            const fetchResponse = await fetch(fetchUrl, { timeout: 60000 });
            
            if (!fetchResponse.ok) {
                console.warn(`[PubMed] efetch batch ${i} failed: ${fetchResponse.status}`);
                continue;
            }
            
            const xmlText = await fetchResponse.text();
            const batchPapers = parsePubMedXML(xmlText);
            papers.push(...batchPapers);
        }
        
        // Tag papers with keywords
        const tagged = papers.map(paper => tagPaper(paper, moleculeName));
        
        // Dedupe by PMID
        const deduped = dedupeByPMID(tagged);
        
        // Sort by recency + relevance
        deduped.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return (b.relevanceScore || 0) - (a.relevanceScore || 0);
        });
        
        // Cache for 24 hours
        Cache.set(cacheKey, deduped, 24 * 3600);
        
        return deduped;
    } catch (error) {
        console.error(`[PubMed] Error searching for ${moleculeName}:`, error.message);
        throw error;
    }
}

/**
 * Parse PubMed XML response
 */
function parsePubMedXML(xmlText) {
    const papers = [];
    
    // Simple regex-based parsing (for MVP; could use proper XML parser)
    const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
    let match;
    
    while ((match = articleRegex.exec(xmlText)) !== null) {
        const articleXml = match[1];
        
        const pmid = extractXMLField(articleXml, 'PMID');
        const title = extractXMLField(articleXml, 'ArticleTitle');
        const abstract = extractXMLField(articleXml, 'AbstractText');
        const journal = extractXMLField(articleXml, 'Title');
        const year = parseInt(extractXMLField(articleXml, 'Year') || '0', 10);
        
        // Authors
        const authorRegex = /<Author>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]+)<\/ForeName>[\s\S]*?<\/Author>/g;
        const authors = [];
        let authorMatch;
        while ((authorMatch = authorRegex.exec(articleXml)) !== null) {
            authors.push(`${authorMatch[2]} ${authorMatch[1]}`);
        }
        
        // Publication types
        const pubTypeRegex = /<PublicationType>([^<]+)<\/PublicationType>/g;
        const publicationTypes = [];
        let typeMatch;
        while ((typeMatch = pubTypeRegex.exec(articleXml)) !== null) {
            publicationTypes.push(typeMatch[1]);
        }
        
        if (pmid && title) {
            papers.push({
                pmid,
                title,
                journal: journal || 'Unknown',
                year: year || new Date().getFullYear(),
                authors: authors.slice(0, 5), // First 5 authors
                abstract: abstract || '',
                publicationTypes
            });
        }
    }
    
    return papers;
}

function extractXMLField(xml, fieldName) {
    const regex = new RegExp(`<${fieldName}[^>]*>([\\s\\S]*?)<\\/${fieldName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : '';
}

/**
 * Tag paper with keywords (efficacy, safety, biomarker, mechanism, phase2, phase3)
 */
function tagPaper(paper, moleculeName) {
    const text = `${paper.title} ${paper.abstract}`.toLowerCase();
    const tags = [];
    
    if (text.includes('efficacy') || text.includes('effective') || text.includes('improvement')) {
        tags.push('efficacy');
    }
    if (text.includes('safety') || text.includes('adverse') || text.includes('tolerability')) {
        tags.push('safety');
    }
    if (text.includes('biomarker') || text.includes('amyloid') || text.includes('tau')) {
        tags.push('biomarker');
    }
    if (text.includes('mechanism') || text.includes('pathway') || text.includes('target')) {
        tags.push('mechanism');
    }
    if (text.includes('phase 2') || text.includes('phase ii')) {
        tags.push('phase2');
    }
    if (text.includes('phase 3') || text.includes('phase iii')) {
        tags.push('phase3');
    }
    
    // Relevance score: count of molecule mentions
    const moleculeLower = moleculeName.toLowerCase();
    const relevanceScore = (text.match(new RegExp(moleculeLower, 'g')) || []).length;
    
    return {
        ...paper,
        tags,
        relevanceScore
    };
}

/**
 * Dedupe papers by PMID
 */
function dedupeByPMID(papers) {
    const seen = new Set();
    return papers.filter(paper => {
        if (seen.has(paper.pmid)) return false;
        seen.add(paper.pmid);
        return true;
    });
}

module.exports = {
    searchLiterature
};
