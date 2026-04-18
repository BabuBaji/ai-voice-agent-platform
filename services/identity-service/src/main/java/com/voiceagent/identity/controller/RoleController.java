package com.voiceagent.identity.controller;

import com.voiceagent.identity.entity.Role;
import com.voiceagent.identity.repository.RoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/roles")
@RequiredArgsConstructor
public class RoleController {

    private final RoleRepository roleRepository;

    @GetMapping
    public ResponseEntity<List<Role>> listRoles(Authentication authentication) {
        // TODO: Extract tenantId from JWT claims
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        return ResponseEntity.ok(roleRepository.findByTenantId(tenantId));
    }

    @PostMapping
    public ResponseEntity<Role> createRole(Authentication authentication,
                                            @RequestBody Role role) {
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        role.setTenantId(tenantId);
        role.setIsSystem(false);
        return ResponseEntity.ok(roleRepository.save(role));
    }
}
