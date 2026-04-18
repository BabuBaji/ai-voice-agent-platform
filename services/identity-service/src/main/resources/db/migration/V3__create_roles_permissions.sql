CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL REFERENCES tenants(id),
    name        VARCHAR(100) NOT NULL,
    permissions JSONB        NOT NULL DEFAULT '[]',
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_roles_tenant_id ON roles (tenant_id);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id),
    role_id UUID NOT NULL REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);
