CREATE TABLE leads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID         NOT NULL,
    first_name        VARCHAR(255),
    last_name         VARCHAR(255),
    email             VARCHAR(255),
    phone             VARCHAR(50),
    company           VARCHAR(255),
    source            VARCHAR(50),
    status            VARCHAR(50)  NOT NULL DEFAULT 'NEW',
    score             INTEGER      DEFAULT 0,
    assigned_to       UUID,
    tags              TEXT,
    custom_fields     JSONB,
    last_contacted_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_tenant_id ON leads (tenant_id);
CREATE INDEX idx_leads_status ON leads (tenant_id, status);
CREATE INDEX idx_leads_source ON leads (tenant_id, source);
CREATE INDEX idx_leads_assigned_to ON leads (assigned_to);
CREATE INDEX idx_leads_email ON leads (tenant_id, email);
