package com.voiceagent.crm.entity;

import com.voiceagent.crm.enums.AppointmentStatus;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "appointments")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Appointment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private UUID tenantId;

    private UUID leadId;
    private UUID contactId;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private Instant scheduledAt;

    @Column(nullable = false)
    private Integer durationMinutes;

    private String location;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AppointmentStatus status;

    private UUID bookedBy;

    private UUID conversationId;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
        if (status == null) status = AppointmentStatus.SCHEDULED;
        if (durationMinutes == null) durationMinutes = 30;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
