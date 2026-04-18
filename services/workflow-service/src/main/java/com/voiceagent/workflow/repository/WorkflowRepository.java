package com.voiceagent.workflow.repository;

import com.voiceagent.workflow.entity.Workflow;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkflowRepository extends JpaRepository<Workflow, UUID> {

    List<Workflow> findByTenantId(UUID tenantId);

    List<Workflow> findByTenantIdAndIsActiveTrue(UUID tenantId);

    Optional<Workflow> findByIdAndTenantId(UUID id, UUID tenantId);
}
