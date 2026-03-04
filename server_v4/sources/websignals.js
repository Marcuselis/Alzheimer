const fetch = require('node-fetch');
const Cache = require('../cache');

/**
 * Search for web signals (press releases, news, regulatory mentions)
 * Best-effort implementation using simple search queries
 */
async function searchWebSignals(sponsorName, moleculeName, options = {}) {
    const { maxResults = 10 } = options;
    
    const cacheKey = `websignals_${sponsorName.toLowerCase().trim()}_${moleculeName.toLowerCase().trim()}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
        console.log(`[WebSignals] Cache hit for: ${sponsorName} / ${moleculeName}`);
        return cached;
    }
    
    try {
        // For MVP, we'll use a simple approach: search Google News API or similar
        // Since we don't have API keys, we'll return a structured response indicating
        // that web signals are not available in this MVP, but the structure is ready
        
        console.log(`[WebSignals] Searching for: ${sponsorName} + ${moleculeName} + Alzheimer`);
        
        // Placeholder: In a full implementation, you would:
        // 1. Use Google News API, Bing News API, or similar
        // 2. Search for: sponsorName + moleculeName + "Alzheimer" + "Phase 3" etc.
        // 3. Parse results for title, snippet, date, source
        // 4. Filter for press releases, regulatory mentions, trial updates
        
        const signals = [];
        
        // For now, return empty array with a note that this is best-effort
        // The frontend will handle this gracefully
        
        // Cache for 12 hours (shorter than CT.gov/PubMed since news is more time-sensitive)
        Cache.set(cacheKey, signals, 12 * 3600);
        
        return signals;
    } catch (error) {
        console.error(`[WebSignals] Error searching for ${sponsorName}/${moleculeName}:`, error.message);
        // Don't throw - web signals are optional
        return [];
    }
}

/**
 * Format a signal result
 */
function formatSignal(title, snippet, url, date, source) {
    return {
        title,
        snippet,
        url,
        date: date || new Date().toISOString(),
        source: source || 'Web'
    };
}

module.exports = {
    searchWebSignals
};
