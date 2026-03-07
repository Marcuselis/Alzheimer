-- Migration: 014_news_system
-- Signals-based news feed system
-- Ties external events to internal trial/sponsor/investigator graph

CREATE TABLE IF NOT EXISTS news_sources (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL UNIQUE,
    kind              TEXT NOT NULL CHECK (kind IN ('rss', 'api', 'site', 'pubmed', 'clinicaltrials', 'manual')),
    base_url          TEXT,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    trust_score       INTEGER DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news_articles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id         UUID NOT NULL REFERENCES news_sources(id),
    title             TEXT NOT NULL,
    url               TEXT NOT NULL,
    published_at      TIMESTAMPTZ,
    raw_text          TEXT,
    summary           TEXT,
    hash              TEXT UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_articles_source ON news_articles(source_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles(published_at DESC);

CREATE TABLE IF NOT EXISTS news_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id        UUID REFERENCES news_articles(id),
    event_type        TEXT NOT NULL CHECK (event_type IN (
        'trial_launched', 'trial_status_changed', 'publication_published',
        'sponsor_update', 'regulatory_update', 'investigator_signal'
    )),
    title             TEXT NOT NULL,
    summary           TEXT NOT NULL,
    importance_score  INTEGER DEFAULT 50 CHECK (importance_score BETWEEN 0 AND 100),
    importance_level  TEXT GENERATED ALWAYS AS (
        CASE
            WHEN importance_score >= 75 THEN 'high'
            WHEN importance_score >= 50 THEN 'medium'
            ELSE 'low'
        END
    ) STORED,
    event_date        TIMESTAMPTZ,
    why_it_matters    TEXT,
    recommended_action TEXT,
    source_url        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_events_type ON news_events(event_type);
CREATE INDEX IF NOT EXISTS idx_news_events_importance ON news_events(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_date ON news_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_article ON news_events(article_id);

CREATE TABLE IF NOT EXISTS news_event_entities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    news_event_id     UUID NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
    entity_type       TEXT NOT NULL CHECK (entity_type IN (
        'trial', 'sponsor', 'investigator', 'institution', 'molecule', 'paper'
    )),
    entity_id         TEXT NOT NULL,
    entity_name       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_event_entities_event ON news_event_entities(news_event_id);
CREATE INDEX IF NOT EXISTS idx_news_event_entities_type_id ON news_event_entities(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS news_user_subscriptions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL,
    entity_type       TEXT NOT NULL,
    entity_id         TEXT NOT NULL,
    notification_channel TEXT DEFAULT 'in_app',
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, entity_type, entity_id)
);

-- Insert default sources (Tier 1)
INSERT INTO news_sources (name, kind, trust_score, enabled) VALUES
    ('ClinicalTrials.gov', 'api', 95, TRUE),
    ('PubMed', 'api', 90, TRUE)
ON CONFLICT DO NOTHING;
