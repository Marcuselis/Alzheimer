-- Migration: 015_watchlists_alerts
-- User watchlists and news alert system for Phase 3

CREATE TABLE IF NOT EXISTS news_user_watchlists (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL,
    entity_type       TEXT NOT NULL CHECK (entity_type IN (
        'trial', 'sponsor', 'investigator', 'institution', 'molecule'
    )),
    entity_id         TEXT NOT NULL,
    entity_name       TEXT,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    alert_on_events   TEXT[] DEFAULT ARRAY['trial_launched', 'trial_status_changed', 'publication_published'],
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watchlists ON news_user_watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_entity_watchlists ON news_user_watchlists(entity_type, entity_id);

-- User alert subscriptions
CREATE TABLE IF NOT EXISTS news_user_alerts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL,
    news_event_id     UUID NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
    alert_type        TEXT NOT NULL CHECK (alert_type IN ('email', 'in_app', 'digest')),
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'read', 'dismissed')),
    sent_at           TIMESTAMPTZ,
    read_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts ON news_user_alerts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_alert_event ON news_user_alerts(news_event_id);

-- Prospect funnel integration (link news to prospect pipeline)
CREATE TABLE IF NOT EXISTS news_prospect_actions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL,
    news_event_id     UUID NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
    action_type       TEXT NOT NULL CHECK (action_type IN (
        'add_to_funnel', 'email_saved', 'contact_added', 'meeting_scheduled'
    )),
    funnel_stage      TEXT, -- 'lead', 'qualified', 'active', 'closed'
    entity_type       TEXT,
    entity_id         TEXT,
    metadata          JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_user ON news_prospect_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_prospect_event ON news_prospect_actions(news_event_id);
CREATE INDEX IF NOT EXISTS idx_prospect_action ON news_prospect_actions(action_type);
