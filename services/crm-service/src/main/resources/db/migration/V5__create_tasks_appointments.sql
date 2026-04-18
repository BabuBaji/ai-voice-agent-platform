CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    lead_id     UUID         REFERENCES leads(id),
    deal_id     UUID         REFERENCES deals(id),
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    due_date    DATE,
    priority    VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',
    status      VARCHAR(20)  NOT NULL DEFAULT 'TODO',
    assigned_to UUID,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_tenant_id ON tasks (tenant_id);
CREATE INDEX idx_tasks_assigned_to ON tasks (assigned_to);
CREATE INDEX idx_tasks_status ON tasks (tenant_id, status);

CREATE TABLE appointments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL,
    lead_id          UUID         REFERENCES leads(id),
    contact_id       UUID         REFERENCES contacts(id),
    title            VARCHAR(255) NOT NULL,
    scheduled_at     TIMESTAMPTZ  NOT NULL,
    duration_minutes INTEGER      NOT NULL DEFAULT 30,
    location         VARCHAR(500),
    notes            TEXT,
    status           VARCHAR(50)  NOT NULL DEFAULT 'SCHEDULED',
    booked_by        UUID,
    conversation_id  UUID,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_tenant_id ON appointments (tenant_id);
CREATE INDEX idx_appointments_scheduled_at ON appointments (tenant_id, scheduled_at);
