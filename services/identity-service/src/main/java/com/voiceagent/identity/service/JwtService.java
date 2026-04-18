package com.voiceagent.identity.service;

import com.voiceagent.identity.security.JwtTokenProvider;
import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class JwtService {

    private final JwtTokenProvider jwtTokenProvider;

    public String generateAccessToken(UUID userId, UUID tenantId, String email, List<String> roles) {
        return jwtTokenProvider.generateAccessToken(userId, tenantId, email, roles);
    }

    public String generateRefreshToken(UUID userId) {
        return jwtTokenProvider.generateRefreshToken(userId);
    }

    public boolean validateToken(String token) {
        return jwtTokenProvider.validateToken(token);
    }

    public Claims extractClaims(String token) {
        return jwtTokenProvider.extractClaims(token);
    }
}
