package com.voiceagent.workflow.repository;

import com.voiceagent.workflow.entity.WorkflowExecution;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface WorkflowExecutionRepository extends JpaRepository<WorkflowExecution, UUID> {

    Page<WorkflowExecution> findByWorkflowId(UUID workflowId, Pageable pageable);
}
