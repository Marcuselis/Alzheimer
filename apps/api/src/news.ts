/**
 * News/Signals read layer — fetch and filter news events
 */

import { db } from './db/client';

export type EventType = 'trial_launched' | 'trial_status_changed' | 'publication_published' | 'sponsor_update' | 'regulatory_update' | 'investigator_signal';
export type ImportanceLevel = 'high' | 'medium' | 'low';
export type EntityType = 'trial' | 'sponsor' | 'investigator' | 'institution' | 'molecule' | 'paper';

export interface NewsEvent {
  id: string;
  articleId: string | null;
  eventType: EventType;
  title: string;
  summary: string;
  importanceScore: number;
  importanceLevel: ImportanceLevel;
  eventDate: string | null;
  whyItMatters: string | null;
  recommendedAction: string | null;
  sourceUrl: string | null;
  entities: Array<{
    id: string;
    entityType: EntityType;
    entityId: string;
    entityName: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface NewsFilter {
  eventTypes?: EventType[];
  importanceLevels?: ImportanceLevel[];
  entityType?: EntityType;
  entityId?: string;
  limit?: number;
  offset?: number;
  dateRange?: {
    from: string;
    to: string;
  };
}

export async function getNewsEvents(filter: NewsFilter): Promise<NewsEvent[]> {
  const {
    eventTypes,
    importanceLevels,
    entityType,
    entityId,
    limit = 50,
    offset = 0,
    dateRange,
  } = filter;

  let query = `
    SELECT DISTINCT
      ne.id,
      ne.article_id,
      ne.event_type,
      ne.title,
      ne.summary,
      ne.importance_score,
      ne.importance_level,
      ne.event_date,
      ne.why_it_matters,
      ne.recommended_action,
      ne.source_url,
      ne.created_at,
      ne.updated_at
    FROM news_events ne
  `;

  const params: any[] = [];
  const conditions: string[] = [];

  if (entityType && entityId) {
    query += `
      LEFT JOIN news_event_entities nee ON ne.id = nee.news_event_id
    `;
    conditions.push(`(nee.entity_type = $${params.length + 1} AND nee.entity_id = $${params.length + 2})`);
    params.push(entityType, entityId);
  }

  if (eventTypes && eventTypes.length > 0) {
    conditions.push(`ne.event_type = ANY($${params.length + 1})`);
    params.push(eventTypes);
  }

  if (importanceLevels && importanceLevels.length > 0) {
    conditions.push(`ne.importance_level = ANY($${params.length + 1})`);
    params.push(importanceLevels);
  }

  if (dateRange) {
    conditions.push(`ne.event_date >= $${params.length + 1} AND ne.event_date <= $${params.length + 2}`);
    params.push(dateRange.from, dateRange.to);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY ne.event_date DESC, ne.importance_score DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await db.query(query, params);

  // Fetch entities for each event
  const events: NewsEvent[] = [];
  for (const row of result.rows) {
    const entitiesResult = await db.query(
      `SELECT id, entity_type, entity_id, entity_name FROM news_event_entities WHERE news_event_id = $1`,
      [row.id]
    );

    events.push({
      id: row.id,
      articleId: row.article_id ?? null,
      eventType: row.event_type as EventType,
      title: row.title,
      summary: row.summary,
      importanceScore: row.importance_score,
      importanceLevel: row.importance_level as ImportanceLevel,
      eventDate: row.event_date?.toISOString() ?? null,
      whyItMatters: row.why_it_matters ?? null,
      recommendedAction: row.recommended_action ?? null,
      sourceUrl: row.source_url ?? null,
      entities: entitiesResult.rows.map((e: any) => ({
        id: e.id,
        entityType: e.entity_type as EntityType,
        entityId: e.entity_id,
        entityName: e.entity_name ?? null,
      })),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }

  return events;
}

export async function getNewsEventById(id: string): Promise<NewsEvent | null> {
  const result = await db.query(
    `SELECT * FROM news_events WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const entitiesResult = await db.query(
    `SELECT id, entity_type, entity_id, entity_name FROM news_event_entities WHERE news_event_id = $1`,
    [row.id]
  );

  return {
    id: row.id,
    articleId: row.article_id ?? null,
    eventType: row.event_type as EventType,
    title: row.title,
    summary: row.summary,
    importanceScore: row.importance_score,
    importanceLevel: row.importance_level as ImportanceLevel,
    eventDate: row.event_date?.toISOString() ?? null,
    whyItMatters: row.why_it_matters ?? null,
    recommendedAction: row.recommended_action ?? null,
    sourceUrl: row.source_url ?? null,
    entities: entitiesResult.rows.map((e: any) => ({
      id: e.id,
      entityType: e.entity_type as EntityType,
      entityId: e.entity_id,
      entityName: e.entity_name ?? null,
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createNewsEvent(event: {
  articleId?: string | null;
  eventType: EventType;
  title: string;
  summary: string;
  importanceScore?: number;
  eventDate?: string | null;
  whyItMatters?: string | null;
  recommendedAction?: string | null;
  sourceUrl?: string | null;
  entities?: Array<{
    entityType: EntityType;
    entityId: string;
    entityName?: string | null;
  }>;
}): Promise<string> {
  const result = await db.query(
    `INSERT INTO news_events
       (article_id, event_type, title, summary, importance_score, event_date, why_it_matters, recommended_action, source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      event.articleId ?? null,
      event.eventType,
      event.title,
      event.summary,
      event.importanceScore ?? 50,
      event.eventDate ?? null,
      event.whyItMatters ?? null,
      event.recommendedAction ?? null,
      event.sourceUrl ?? null,
    ]
  );

  const eventId = result.rows[0].id;

  // Insert entities if provided
  if (event.entities && event.entities.length > 0) {
    for (const entity of event.entities) {
      await db.query(
        `INSERT INTO news_event_entities (news_event_id, entity_type, entity_id, entity_name)
         VALUES ($1, $2, $3, $4)`,
        [eventId, entity.entityType, entity.entityId, entity.entityName ?? null]
      );
    }
  }

  return eventId;
}
