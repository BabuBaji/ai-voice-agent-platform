package com.voiceagent.identity.dto;

import com.voiceagent.identity.enums.UserStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserDTO {

    private UUID id;
    private UUID tenantId;
    private String email;
    private String firstName;
    private String lastName;
    private String avatarUrl;
    private UserStatus status;
    private Boolean emailVerified;
    private List<String> roles;
    private Instant lastLoginAt;
    private Instant createdAt;
}
