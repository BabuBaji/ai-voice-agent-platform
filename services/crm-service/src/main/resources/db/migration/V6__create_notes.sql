CREATE TABLE notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    entity_type VARCHAR(50)  NOT NULL,
    entity_id   UUID         NOT NULL,
    content     TEXT         NOT NULL,
    created_by  UUID,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_entity ON notes (entity_type, entity_id);
CREATE INDEX idx_notes_tenant_id ON notes (tenant_id);

CREATE TABLE tags (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID         NOT NULL,
    name      VARCHAR(100) NOT NULL,
    color     VARCHAR(20)
);

CREATE INDEX idx_tags_tenant_id ON tags (tenant_id);
