CREATE TABLE pipelines (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID         NOT NULL,
    name       VARCHAR(255) NOT NULL,
    is_default BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipelines_tenant_id ON pipelines (tenant_id);

CREATE TABLE pipeline_stages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID         NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    position    INTEGER      NOT NULL,
    color       VARCHAR(20)
);

CREATE INDEX idx_pipeline_stages_pipeline_id ON pipeline_stages (pipeline_id);
