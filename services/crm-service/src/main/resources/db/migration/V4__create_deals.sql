CREATE TABLE deals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID           NOT NULL,
    pipeline_id         UUID           NOT NULL REFERENCES pipelines(id),
    stage_id            UUID           NOT NULL REFERENCES pipeline_stages(id),
    lead_id             UUID           REFERENCES leads(id),
    contact_id          UUID           REFERENCES contacts(id),
    title               VARCHAR(255)   NOT NULL,
    value               NUMERIC(15, 2),
    currency            VARCHAR(3)     DEFAULT 'USD',
    expected_close_date DATE,
    assigned_to         UUID,
    status              VARCHAR(50)    NOT NULL DEFAULT 'OPEN',
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_tenant_id ON deals (tenant_id);
CREATE INDEX idx_deals_pipeline_id ON deals (pipeline_id);
CREATE INDEX idx_deals_stage_id ON deals (stage_id);
CREATE INDEX idx_deals_status ON deals (tenant_id, status);
