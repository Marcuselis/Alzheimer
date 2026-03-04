const fetch = require('node-fetch');
const Cache = require('../cache');

const CT_API_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const CT_QUERY_BASE = 'https://clinicaltrials.gov/api/query/study_fields';

/**
 * Search trials by molecule name
 */
async function searchTrialsByMolecule(moleculeName) {
    const cacheKey = `ct_molecule_${moleculeName.toLowerCase().trim()}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
        console.log(`[CT.gov] Cache hit for molecule: ${moleculeName}`);
        return cached;
    }
    
    try {
        // Search for trials with this intervention
        const searchQuery = `(INTERVENTION:${encodeURIComponent(moleculeName)}) AND (CONDITION:Alzheimer OR CONDITION:Dementia)`;
        const fields = 'NCTId,BriefTitle,OverallStatus,Phase,StudyType,LeadSponsorName,Condition,InterventionName,InterventionType,LocationCountry,StartDate,PrimaryCompletionDate,EnrollmentCount,OutcomeMeasureTitle,OutcomeMeasureType,EligibilityCriteria';
        const url = `${CT_QUERY_BASE}?expr=${encodeURIComponent(searchQuery)}&fields=${fields}&min_rnk=1&max_rnk=100&fmt=json`;
        
        console.log(`[CT.gov] Fetching trials for molecule: ${moleculeName}`);
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000
        });
        
        if (!response.ok) {
            throw new Error(`CT.gov API error: ${response.status}`);
        }
        
        const jsonData = await response.json();
        const studies = jsonData.StudyFieldsResponse?.StudyFields || [];
        
        const normalized = studies.map(study => normalizeTrial(study));
        
        // Cache for 24 hours
        Cache.set(cacheKey, normalized, 24 * 3600);
        
        return normalized;
    } catch (error) {
        console.error(`[CT.gov] Error searching by molecule ${moleculeName}:`, error.message);
        throw error;
    }
}

/**
 * Search trials by sponsor name
 */
async function searchTrialsBySponsor(sponsorName) {
    const cacheKey = `ct_sponsor_${sponsorName.toLowerCase().trim()}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
        console.log(`[CT.gov] Cache hit for sponsor: ${sponsorName}`);
        return cached;
    }
    
    try {
        const searchQuery = `(LEADSPONSOR:${encodeURIComponent(sponsorName)}) AND (CONDITION:Alzheimer OR CONDITION:Dementia)`;
        const fields = 'NCTId,BriefTitle,OverallStatus,Phase,StudyType,LeadSponsorName,Condition,InterventionName,InterventionType,LocationCountry,StartDate,PrimaryCompletionDate,EnrollmentCount,OutcomeMeasureTitle,OutcomeMeasureType,EligibilityCriteria';
        const url = `${CT_QUERY_BASE}?expr=${encodeURIComponent(searchQuery)}&fields=${fields}&min_rnk=1&max_rnk=100&fmt=json`;
        
        console.log(`[CT.gov] Fetching trials for sponsor: ${sponsorName}`);
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000
        });
        
        if (!response.ok) {
            throw new Error(`CT.gov API error: ${response.status}`);
        }
        
        const jsonData = await response.json();
        const studies = jsonData.StudyFieldsResponse?.StudyFields || [];
        
        const normalized = studies.map(study => normalizeTrial(study));
        
        // Cache for 24 hours
        Cache.set(cacheKey, normalized, 24 * 3600);
        
        return normalized;
    } catch (error) {
        console.error(`[CT.gov] Error searching by sponsor ${sponsorName}:`, error.message);
        throw error;
    }
}

/**
 * Get detailed trial information by NCT ID
 */
async function getTrialDetails(nctId) {
    const cacheKey = `ct_detail_${nctId}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
        console.log(`[CT.gov] Cache hit for trial: ${nctId}`);
        return cached;
    }
    
    try {
        const url = `${CT_API_BASE}/${nctId}`;
        console.log(`[CT.gov] Fetching details for: ${nctId}`);
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000
        });
        
        if (!response.ok) {
            throw new Error(`CT.gov API error: ${response.status}`);
        }
        
        const data = await response.json();
        const normalized = normalizeTrialDetail(data);
        
        // Cache for 7 days
        Cache.set(cacheKey, normalized, 7 * 24 * 3600);
        
        return normalized;
    } catch (error) {
        console.error(`[CT.gov] Error fetching trial ${nctId}:`, error.message);
        throw error;
    }
}

/**
 * Normalize trial from study_fields response
 */
function normalizeTrial(study) {
    const fields = study.FieldValues || {};
    
    return {
        nctId: getFirst(fields.NCTId),
        title: getFirst(fields.BriefTitle),
        status: getFirst(fields.OverallStatus),
        phase: getFirst(fields.Phase) || 'N/A',
        studyType: getFirst(fields.StudyType),
        sponsor: getFirst(fields.LeadSponsorName),
        conditions: fields.Condition || [],
        interventionsText: (fields.InterventionName || []).join(', '),
        outcomesPrimaryText: (fields.OutcomeMeasureTitle || []).filter((_, i) => 
            (fields.OutcomeMeasureType || [])[i] === 'Primary'
        ),
        outcomesSecondaryText: (fields.OutcomeMeasureTitle || []).filter((_, i) => 
            (fields.OutcomeMeasureType || [])[i] === 'Secondary'
        ),
        locations: fields.LocationCountry || [],
        startDate: getFirst(fields.StartDate),
        primaryCompletionDate: getFirst(fields.PrimaryCompletionDate),
        enrollment: parseInt(getFirst(fields.EnrollmentCount) || '0', 10),
        eligibilityCriteria: getFirst(fields.EligibilityCriteria) || ''
    };
}

/**
 * Normalize detailed trial from API v2 response
 */
function normalizeTrialDetail(data) {
    const protocol = data.protocolSection || {};
    const idInfo = protocol.identificationModule || {};
    const status = protocol.statusModule || {};
    const design = protocol.designModule || {};
    const eligibility = protocol.eligibilityModule || {};
    const contacts = protocol.contactsLocationsModule || {};
    
    return {
        nctId: idInfo.nctId,
        title: idInfo.briefTitle,
        status: status.overallStatus,
        phase: (design.phases || []).join(', ') || 'N/A',
        studyType: design.studyType,
        sponsor: (protocol.sponsorCollaboratorsModule?.leadSponsor?.name || ''),
        conditions: (protocol.conditionsModule?.conditions || []).map(c => c.name),
        interventionsText: (protocol.armsInterventionsModule?.interventions || []).map(i => i.name).join(', '),
        outcomesPrimaryText: (protocol.outcomesModule?.primaryOutcomes || []).map(o => o.measure),
        outcomesSecondaryText: (protocol.outcomesModule?.secondaryOutcomes || []).map(o => o.measure),
        locations: (contacts.locations || []).map(l => l.location?.country || '').filter(Boolean),
        startDate: status.startDateStruct?.date || '',
        primaryCompletionDate: status.primaryCompletionDateStruct?.date || '',
        enrollment: eligibility.enrollment?.count || 0,
        eligibilityCriteria: eligibility.eligibilityCriteria || ''
    };
}

function getFirst(arr) {
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : '';
}

module.exports = {
    searchTrialsByMolecule,
    searchTrialsBySponsor,
    getTrialDetails
};
