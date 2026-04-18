package com.voiceagent.workflow.repository;

import com.voiceagent.workflow.entity.Trigger;
import com.voiceagent.workflow.enums.TriggerType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface TriggerRepository extends JpaRepository<Trigger, UUID> {

    List<Trigger> findByWorkflowId(UUID workflowId);

    @Query("SELECT t FROM Trigger t JOIN t.workflow w WHERE w.tenantId = :tenantId AND w.isActive = true AND t.type = :type")
    List<Trigger> findActiveByTenantIdAndType(UUID tenantId, TriggerType type);
}
