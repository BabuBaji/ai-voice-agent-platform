package com.voiceagent.identity.controller;

import com.voiceagent.identity.dto.UserDTO;
import com.voiceagent.identity.entity.User;
import com.voiceagent.identity.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @GetMapping
    public ResponseEntity<List<UserDTO>> listUsers(Authentication authentication) {
        // TODO: Extract tenantId from JWT claims
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        return ResponseEntity.ok(userService.listUsers(tenantId));
    }

    @PostMapping
    public ResponseEntity<UserDTO> createUser(Authentication authentication,
                                               @RequestBody User user) {
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        return ResponseEntity.ok(userService.createUser(tenantId, user));
    }

    @PutMapping("/{id}")
    public ResponseEntity<UserDTO> updateUser(Authentication authentication,
                                               @PathVariable UUID id,
                                               @RequestBody User updates) {
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        return ResponseEntity.ok(userService.updateUser(tenantId, id, updates));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteUser(Authentication authentication,
                                                           @PathVariable UUID id) {
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000000");
        userService.deleteUser(tenantId, id);
        return ResponseEntity.ok(Map.of("message", "User disabled successfully"));
    }
}
