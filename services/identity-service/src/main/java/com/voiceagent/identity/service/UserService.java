package com.voiceagent.identity.service;

import com.voiceagent.identity.dto.UserDTO;
import com.voiceagent.identity.entity.User;
import com.voiceagent.identity.enums.UserStatus;
import com.voiceagent.identity.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public List<UserDTO> listUsers(UUID tenantId) {
        return userRepository.findByTenantId(tenantId).stream()
                .map(this::toDTO)
                .toList();
    }

    @Transactional
    public UserDTO createUser(UUID tenantId, User user) {
        user.setTenantId(tenantId);
        user.setPasswordHash(passwordEncoder.encode(user.getPasswordHash()));
        user.setStatus(UserStatus.INVITED);
        user.setEmailVerified(false);
        return toDTO(userRepository.save(user));
    }

    @Transactional
    public UserDTO updateUser(UUID tenantId, UUID userId, User updates) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        if (!user.getTenantId().equals(tenantId)) {
            throw new RuntimeException("User does not belong to tenant");
        }
        if (updates.getFirstName() != null) user.setFirstName(updates.getFirstName());
        if (updates.getLastName() != null) user.setLastName(updates.getLastName());
        if (updates.getStatus() != null) user.setStatus(updates.getStatus());
        return toDTO(userRepository.save(user));
    }

    @Transactional
    public void deleteUser(UUID tenantId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        if (!user.getTenantId().equals(tenantId)) {
            throw new RuntimeException("User does not belong to tenant");
        }
        user.setStatus(UserStatus.DISABLED);
        userRepository.save(user);
    }

    private UserDTO toDTO(User user) {
        return UserDTO.builder()
                .id(user.getId())
                .tenantId(user.getTenantId())
                .email(user.getEmail())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .avatarUrl(user.getAvatarUrl())
                .status(user.getStatus())
                .emailVerified(user.getEmailVerified())
                .lastLoginAt(user.getLastLoginAt())
                .createdAt(user.getCreatedAt())
                .build();
    }
}
