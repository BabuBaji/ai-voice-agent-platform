package com.voiceagent.crm.repository;

import com.voiceagent.crm.entity.Deal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DealRepository extends JpaRepository<Deal, UUID> {

    Page<Deal> findByTenantId(UUID tenantId, Pageable pageable);

    Optional<Deal> findByIdAndTenantId(UUID id, UUID tenantId);

    List<Deal> findByPipelineIdAndTenantId(UUID pipelineId, UUID tenantId);
}
