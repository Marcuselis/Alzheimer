-- Persona Recommendations
-- Migration: 006_persona_recommendations

CREATE TABLE IF NOT EXISTS persona_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    pain_owner_persona TEXT NOT NULL,
    decision_owner_persona TEXT NOT NULL,
    urgency_score INTEGER NOT NULL CHECK (urgency_score >= 0 AND urgency_score <= 100),
    why_now_text TEXT NOT NULL,
    pitch_angle TEXT NOT NULL,
    avoid_angle TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
    drivers_json JSONB NOT NULL,
    evidence_json JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sponsor_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_persona_recommendations_market ON persona_recommendations(market_id);
CREATE INDEX IF NOT EXISTS idx_persona_recommendations_sponsor ON persona_recommendations(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_persona_recommendations_urgency ON persona_recommendations(market_id, urgency_score DESC);
