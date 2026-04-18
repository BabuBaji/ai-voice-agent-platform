package com.voiceagent.crm.repository;

import com.voiceagent.crm.entity.Appointment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {

    Page<Appointment> findByTenantId(UUID tenantId, Pageable pageable);

    Optional<Appointment> findByIdAndTenantId(UUID id, UUID tenantId);
}
