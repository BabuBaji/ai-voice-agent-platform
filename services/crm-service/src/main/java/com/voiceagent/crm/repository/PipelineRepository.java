package com.voiceagent.crm.repository;

import com.voiceagent.crm.entity.Pipeline;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PipelineRepository extends JpaRepository<Pipeline, UUID> {

    List<Pipeline> findByTenantId(UUID tenantId);

    Optional<Pipeline> findByIdAndTenantId(UUID id, UUID tenantId);
}
