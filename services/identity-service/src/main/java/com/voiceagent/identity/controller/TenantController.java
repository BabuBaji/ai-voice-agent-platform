package com.voiceagent.identity.controller;

import com.voiceagent.identity.entity.Tenant;
import com.voiceagent.identity.service.TenantService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/tenants")
@RequiredArgsConstructor
public class TenantController {

    private final TenantService tenantService;

    @GetMapping("/me")
    public ResponseEntity<Tenant> getCurrentTenant(Authentication authentication) {
        // TODO: Extract tenantId from JWT claims
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        return ResponseEntity.ok(tenantService.getTenant(tenantId));
    }

    @PutMapping("/me")
    public ResponseEntity<Tenant> updateCurrentTenant(Authentication authentication,
                                                       @RequestBody Tenant updates) {
        // TODO: Extract tenantId from JWT claims
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        return ResponseEntity.ok(tenantService.updateTenant(tenantId, updates));
    }
}
