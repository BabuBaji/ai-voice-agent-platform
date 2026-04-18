package com.voiceagent.crm.repository;

import com.voiceagent.crm.entity.Lead;
import com.voiceagent.crm.enums.LeadSource;
import com.voiceagent.crm.enums.LeadStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface LeadRepository extends JpaRepository<Lead, UUID> {

    Page<Lead> findByTenantId(UUID tenantId, Pageable pageable);

    @Query("SELECT l FROM Lead l WHERE l.tenantId = :tenantId " +
           "AND (:status IS NULL OR l.status = :status) " +
           "AND (:source IS NULL OR l.source = :source)")
    Page<Lead> findByTenantIdAndFilters(UUID tenantId, LeadStatus status, LeadSource source, Pageable pageable);

    Optional<Lead> findByIdAndTenantId(UUID id, UUID tenantId);
}
