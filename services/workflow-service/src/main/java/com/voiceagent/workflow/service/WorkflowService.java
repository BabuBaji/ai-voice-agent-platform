package com.voiceagent.workflow.service;

import com.voiceagent.workflow.entity.Workflow;
import com.voiceagent.workflow.repository.WorkflowRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class WorkflowService {

    private final WorkflowRepository workflowRepository;

    public List<Workflow> listWorkflows(UUID tenantId) {
        return workflowRepository.findByTenantId(tenantId);
    }

    public Workflow getWorkflow(UUID tenantId, UUID workflowId) {
        return workflowRepository.findByIdAndTenantId(workflowId, tenantId)
                .orElseThrow(() -> new RuntimeException("Workflow not found"));
    }

    @Transactional
    public Workflow createWorkflow(UUID tenantId, Workflow workflow) {
        workflow.setTenantId(tenantId);
        return workflowRepository.save(workflow);
    }

    @Transactional
    public Workflow updateWorkflow(UUID tenantId, UUID workflowId, Workflow updates) {
        Workflow workflow = getWorkflow(tenantId, workflowId);
        if (updates.getName() != null) workflow.setName(updates.getName());
        if (updates.getDescription() != null) workflow.setDescription(updates.getDescription());
        if (updates.getIsActive() != null) workflow.setIsActive(updates.getIsActive());
        return workflowRepository.save(workflow);
    }

    @Transactional
    public void deleteWorkflow(UUID tenantId, UUID workflowId) {
        Workflow workflow = getWorkflow(tenantId, workflowId);
        workflowRepository.delete(workflow);
    }
}
