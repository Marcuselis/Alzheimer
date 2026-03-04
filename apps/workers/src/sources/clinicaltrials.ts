import fetch from 'node-fetch';
import { Trial, TrialSchema } from '@app/shared';

const CT_QUERY_BASE = 'https://clinicaltrials.gov/api/query/study_fields';

export async function searchTrialsByMolecule(moleculeName: string): Promise<Trial[]> {
  try {
    const searchQuery = `(INTERVENTION:${encodeURIComponent(moleculeName)}) AND (CONDITION:Alzheimer OR CONDITION:Dementia)`;
    const fields = 'NCTId,BriefTitle,OverallStatus,Phase,StudyType,LeadSponsorName,Condition,InterventionName,InterventionType,LocationCountry,StartDate,PrimaryCompletionDate,EnrollmentCount,OutcomeMeasureTitle,OutcomeMeasureType,EligibilityCriteria';
    const url = `${CT_QUERY_BASE}?expr=${encodeURIComponent(searchQuery)}&fields=${fields}&min_rnk=1&max_rnk=100&fmt=json`;
    
    console.log(`[CT.gov] Fetching trials for: ${moleculeName}`);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000,
    } as any);
    
    if (!response.ok) {
      throw new Error(`CT.gov API error: ${response.status}`);
    }
    
    const jsonData: any = await response.json();
    const studies = jsonData.StudyFieldsResponse?.StudyFields || [];
    
    return studies.map((study: any) => {
      const fields = study.FieldValues || {};
      const getFirst = (arr: any[]) => Array.isArray(arr) && arr.length > 0 ? arr[0] : '';
      
      return TrialSchema.parse({
        nctId: getFirst(fields.NCTId),
        title: getFirst(fields.BriefTitle),
        status: getFirst(fields.OverallStatus),
        phase: getFirst(fields.Phase) || 'N/A',
        studyType: getFirst(fields.StudyType),
        sponsor: getFirst(fields.LeadSponsorName),
        conditions: fields.Condition || [],
        interventionsText: (fields.InterventionName || []).join(', '),
        outcomesPrimaryText: (fields.OutcomeMeasureTitle || []).filter((_: any, i: number) => 
          (fields.OutcomeMeasureType || [])[i] === 'Primary'
        ),
        outcomesSecondaryText: (fields.OutcomeMeasureTitle || []).filter((_: any, i: number) => 
          (fields.OutcomeMeasureType || [])[i] === 'Secondary'
        ),
        locations: fields.LocationCountry || [],
        startDate: getFirst(fields.StartDate),
        primaryCompletionDate: getFirst(fields.PrimaryCompletionDate),
        enrollment: parseInt(getFirst(fields.EnrollmentCount) || '0', 10),
        eligibilityCriteria: getFirst(fields.EligibilityCriteria) || '',
      });
    });
  } catch (error) {
    console.error(`[CT.gov] Error:`, error);
    throw error;
  }
}
