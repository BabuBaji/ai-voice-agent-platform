package com.voiceagent.identity.service;

import com.voiceagent.identity.entity.Tenant;
import com.voiceagent.identity.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class TenantService {

    private final TenantRepository tenantRepository;

    public Tenant getTenant(UUID tenantId) {
        return tenantRepository.findById(tenantId)
                .orElseThrow(() -> new RuntimeException("Tenant not found"));
    }

    @Transactional
    public Tenant updateTenant(UUID tenantId, Tenant updates) {
        Tenant tenant = getTenant(tenantId);
        if (updates.getName() != null) tenant.setName(updates.getName());
        if (updates.getSettings() != null) tenant.setSettings(updates.getSettings());
        return tenantRepository.save(tenant);
    }
}
