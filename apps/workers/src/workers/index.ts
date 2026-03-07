// Export all workers
export * from './marketRefreshWorker';
export * from './marketDetailWorker';
export * from './sponsorRefreshWorker';
export * from './programRefreshWorker';
export * from './analysisWorker';
export * from './regionAttractivenessWorker';
export * from './aactImportWorker';
export * from './trialContactWorker';
export * from './investigatorContactWorker';

// Start all workers
import './marketRefreshWorker';
import './marketDetailWorker';
import './sponsorRefreshWorker';
import './programRefreshWorker';
import './analysisWorker';
import './regionAttractivenessWorker';
import './aactImportWorker';
import './trialContactWorker';
import './investigatorContactWorker';

console.log('[Workers] All workers started (including AACT import + index+detail pipeline + trial/investigator contact enrichment)');
