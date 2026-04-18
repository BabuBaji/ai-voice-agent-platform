package com.voiceagent.identity.service;

import com.voiceagent.identity.dto.*;
import com.voiceagent.identity.entity.RefreshToken;
import com.voiceagent.identity.entity.Role;
import com.voiceagent.identity.entity.Tenant;
import com.voiceagent.identity.entity.User;
import com.voiceagent.identity.enums.TenantPlan;
import com.voiceagent.identity.enums.UserStatus;
import com.voiceagent.identity.repository.RefreshTokenRepository;
import com.voiceagent.identity.repository.RoleRepository;
import com.voiceagent.identity.repository.TenantRepository;
import com.voiceagent.identity.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final RoleRepository roleRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public TokenResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new RuntimeException("Email already registered");
        }

        String slug = request.getCompanyName().toLowerCase().replaceAll("[^a-z0-9]+", "-");
        if (tenantRepository.existsBySlug(slug)) {
            slug = slug + "-" + UUID.randomUUID().toString().substring(0, 8);
        }

        Tenant tenant = Tenant.builder()
                .name(request.getCompanyName())
                .slug(slug)
                .plan(TenantPlan.FREE)
                .isActive(true)
                .build();
        tenant = tenantRepository.save(tenant);

        User user = User.builder()
                .tenantId(tenant.getId())
                .email(request.getEmail())
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .firstName(request.getFirstName())
                .lastName(request.getLastName())
                .status(UserStatus.ACTIVE)
                .emailVerified(false)
                .build();
        user = userRepository.save(user);

        createDefaultRoles(tenant.getId());

        List<String> roles = List.of("ADMIN");
        String accessToken = jwtService.generateAccessToken(user.getId(), tenant.getId(), user.getEmail(), roles);
        String refreshToken = jwtService.generateRefreshToken(user.getId());

        saveRefreshToken(user.getId(), refreshToken);

        return TokenResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .expiresIn(900)
                .user(toUserDTO(user, roles))
                .build();
    }

    @Transactional
    public TokenResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new RuntimeException("Invalid credentials"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new RuntimeException("Invalid credentials");
        }

        user.setLastLoginAt(Instant.now());
        userRepository.save(user);

        List<String> roles = List.of("ADMIN"); // TODO: resolve actual roles

        String accessToken = jwtService.generateAccessToken(user.getId(), user.getTenantId(), user.getEmail(), roles);
        String refreshToken = jwtService.generateRefreshToken(user.getId());

        saveRefreshToken(user.getId(), refreshToken);

        return TokenResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .expiresIn(900)
                .user(toUserDTO(user, roles))
                .build();
    }

    @Transactional
    public TokenResponse refresh(String refreshTokenValue) {
        if (!jwtService.validateToken(refreshTokenValue)) {
            throw new RuntimeException("Invalid refresh token");
        }

        String tokenHash = hashToken(refreshTokenValue);
        RefreshToken stored = refreshTokenRepository.findByTokenHash(tokenHash)
                .orElseThrow(() -> new RuntimeException("Refresh token not found"));

        if (stored.getRevoked()) {
            throw new RuntimeException("Refresh token has been revoked");
        }

        stored.setRevoked(true);
        refreshTokenRepository.save(stored);

        UUID userId = UUID.fromString(jwtService.extractClaims(refreshTokenValue).getSubject());
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        List<String> roles = List.of("ADMIN"); // TODO: resolve actual roles

        String newAccessToken = jwtService.generateAccessToken(user.getId(), user.getTenantId(), user.getEmail(), roles);
        String newRefreshToken = jwtService.generateRefreshToken(user.getId());

        saveRefreshToken(user.getId(), newRefreshToken);

        return TokenResponse.builder()
                .accessToken(newAccessToken)
                .refreshToken(newRefreshToken)
                .tokenType("Bearer")
                .expiresIn(900)
                .user(toUserDTO(user, roles))
                .build();
    }

    @Transactional
    public void logout(String refreshTokenValue) {
        String tokenHash = hashToken(refreshTokenValue);
        refreshTokenRepository.findByTokenHash(tokenHash).ifPresent(token -> {
            token.setRevoked(true);
            refreshTokenRepository.save(token);
        });
    }

    private void createDefaultRoles(UUID tenantId) {
        roleRepository.save(Role.builder()
                .tenantId(tenantId)
                .name("ADMIN")
                .permissions(List.of("*"))
                .isSystem(true)
                .build());
        roleRepository.save(Role.builder()
                .tenantId(tenantId)
                .name("AGENT")
                .permissions(List.of("leads:read", "leads:write", "contacts:read", "contacts:write"))
                .isSystem(true)
                .build());
        roleRepository.save(Role.builder()
                .tenantId(tenantId)
                .name("VIEWER")
                .permissions(List.of("leads:read", "contacts:read", "deals:read"))
                .isSystem(true)
                .build());
    }

    private void saveRefreshToken(UUID userId, String refreshTokenValue) {
        refreshTokenRepository.save(RefreshToken.builder()
                .userId(userId)
                .tokenHash(hashToken(refreshTokenValue))
                .expiresAt(Instant.now().plusMillis(604800000))
                .revoked(false)
                .build());
    }

    private String hashToken(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes());
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    private UserDTO toUserDTO(User user, List<String> roles) {
        return UserDTO.builder()
                .id(user.getId())
                .tenantId(user.getTenantId())
                .email(user.getEmail())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .avatarUrl(user.getAvatarUrl())
                .status(user.getStatus())
                .emailVerified(user.getEmailVerified())
                .roles(roles)
                .lastLoginAt(user.getLastLoginAt())
                .createdAt(user.getCreatedAt())
                .build();
    }
}
