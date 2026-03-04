// Export all workers
export * from './marketRefreshWorker';
export * from './marketDetailWorker';
export * from './sponsorRefreshWorker';
export * from './programRefreshWorker';
export * from './analysisWorker';
export * from './regionAttractivenessWorker';
export * from './aactImportWorker';

// Start all workers
import './marketRefreshWorker';
import './marketDetailWorker';
import './sponsorRefreshWorker';
import './programRefreshWorker';
import './analysisWorker';
import './regionAttractivenessWorker';
import './aactImportWorker';

console.log('[Workers] All workers started (including AACT import + index+detail pipeline)');
