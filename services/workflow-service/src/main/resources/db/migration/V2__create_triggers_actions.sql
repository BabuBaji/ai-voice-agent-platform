CREATE TABLE triggers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL,
    conditions  JSONB
);

CREATE INDEX idx_triggers_workflow_id ON triggers (workflow_id);
CREATE INDEX idx_triggers_type ON triggers (type);

CREATE TABLE actions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL,
    config      JSONB,
    position    INTEGER     NOT NULL
);

CREATE INDEX idx_actions_workflow_id ON actions (workflow_id);
