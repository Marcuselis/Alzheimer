/**
 * User watchlists and prospect funnel integration
 */

import { db } from './db/client';

export interface Watchlist {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  enabled: boolean;
  alertOnEvents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProspectAction {
  id: string;
  userId: string;
  newsEventId: string;
  actionType: string;
  funnelStage?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
}

// ── Watchlists ──────────────────────────────────────────────────────────────

export async function getWatchlists(userId: string): Promise<Watchlist[]> {
  const result = await db.query(
    `SELECT * FROM news_user_watchlists
     WHERE user_id = $1 AND enabled = TRUE
     ORDER BY updated_at DESC`,
    [userId]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityName: r.entity_name ?? null,
    enabled: r.enabled,
    alertOnEvents: r.alert_on_events ?? [],
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function addWatchlist(
  userId: string,
  entityType: string,
  entityId: string,
  entityName?: string | null,
  alertOnEvents?: string[]
): Promise<string> {
  const result = await db.query(
    `INSERT INTO news_user_watchlists (user_id, entity_type, entity_id, entity_name, alert_on_events)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
       SET enabled = TRUE, updated_at = NOW()
     RETURNING id`,
    [
      userId,
      entityType,
      entityId,
      entityName ?? null,
      alertOnEvents ?? ['trial_launched', 'trial_status_changed', 'publication_published'],
    ]
  );

  return result.rows[0].id;
}

export async function removeWatchlist(userId: string, watchlistId: string): Promise<void> {
  await db.query(
    `UPDATE news_user_watchlists
     SET enabled = FALSE, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [watchlistId, userId]
  );
}

export async function updateWatchlistAlerts(
  userId: string,
  watchlistId: string,
  alertOnEvents: string[]
): Promise<void> {
  await db.query(
    `UPDATE news_user_watchlists
     SET alert_on_events = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [watchlistId, userId, alertOnEvents]
  );
}

// ── Prospect Funnel Integration ─────────────────────────────────────────────

export async function addNewsEventToProspectFunnel(
  userId: string,
  newsEventId: string,
  funnelStage: string = 'lead',
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, any>
): Promise<string> {
  const result = await db.query(
    `INSERT INTO news_prospect_actions (user_id, news_event_id, action_type, funnel_stage, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      userId,
      newsEventId,
      'add_to_funnel',
      funnelStage,
      entityType ?? null,
      entityId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  return result.rows[0].id;
}

export async function getProspectActions(userId: string, limit: number = 50): Promise<ProspectAction[]> {
  const result = await db.query(
    `SELECT * FROM news_prospect_actions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    newsEventId: r.news_event_id,
    actionType: r.action_type,
    funnelStage: r.funnel_stage ?? null,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    metadata: r.metadata ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function recordProspectAction(
  userId: string,
  newsEventId: string,
  actionType: string,
  funnelStage?: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, any>
): Promise<string> {
  const result = await db.query(
    `INSERT INTO news_prospect_actions
       (user_id, news_event_id, action_type, funnel_stage, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      userId,
      newsEventId,
      actionType,
      funnelStage ?? null,
      entityType ?? null,
      entityId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  return result.rows[0].id;
}

// ── Alert notifications ─────────────────────────────────────────────────────

export async function createAlert(
  userId: string,
  newsEventId: string,
  alertType: string = 'in_app'
): Promise<string> {
  const result = await db.query(
    `INSERT INTO news_user_alerts (user_id, news_event_id, alert_type)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, newsEventId, alertType]
  );

  return result.rows[0].id;
}

export async function getAlerts(userId: string, status: string = 'pending'): Promise<any[]> {
  const result = await db.query(
    `SELECT
       ua.id, ua.user_id, ua.news_event_id, ua.alert_type, ua.status,
       ua.sent_at, ua.read_at, ua.created_at,
       ne.title, ne.summary, ne.event_type, ne.importance_level
     FROM news_user_alerts ua
     LEFT JOIN news_events ne ON ua.news_event_id = ne.id
     WHERE ua.user_id = $1 AND ua.status = $2
     ORDER BY ua.created_at DESC`,
    [userId, status]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    newsEventId: r.news_event_id,
    alertType: r.alert_type,
    status: r.status,
    sentAt: r.sent_at?.toISOString() ?? null,
    readAt: r.read_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    event: {
      title: r.title,
      summary: r.summary,
      eventType: r.event_type,
      importanceLevel: r.importance_level,
    },
  }));
}

export async function markAlertAsRead(alertId: string): Promise<void> {
  await db.query(
    `UPDATE news_user_alerts SET status = 'read', read_at = NOW() WHERE id = $1`,
    [alertId]
  );
}

export async function dismissAlert(alertId: string): Promise<void> {
  await db.query(
    `UPDATE news_user_alerts SET status = 'dismissed' WHERE id = $1`,
    [alertId]
  );
}
