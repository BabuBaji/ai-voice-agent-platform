CREATE TABLE contacts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    lead_id       UUID         REFERENCES leads(id),
    first_name    VARCHAR(255),
    last_name     VARCHAR(255),
    email         VARCHAR(255),
    phone         VARCHAR(50),
    company       VARCHAR(255),
    job_title     VARCHAR(255),
    custom_fields JSONB,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_tenant_id ON contacts (tenant_id);
CREATE INDEX idx_contacts_lead_id ON contacts (lead_id);
CREATE INDEX idx_contacts_email ON contacts (tenant_id, email);
