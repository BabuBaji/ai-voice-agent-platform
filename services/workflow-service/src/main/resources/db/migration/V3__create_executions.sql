CREATE TABLE workflow_executions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id  UUID        NOT NULL REFERENCES workflows(id),
    triggered_by VARCHAR(100),
    status       VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    result       JSONB
);

CREATE INDEX idx_executions_workflow_id ON workflow_executions (workflow_id);
CREATE INDEX idx_executions_status ON workflow_executions (status);
