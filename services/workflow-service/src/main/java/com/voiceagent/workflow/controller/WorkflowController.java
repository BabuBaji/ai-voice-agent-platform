package com.voiceagent.workflow.controller;

import com.voiceagent.workflow.entity.Workflow;
import com.voiceagent.workflow.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/workflows")
@RequiredArgsConstructor
public class WorkflowController {

    private final WorkflowService workflowService;

    @GetMapping
    public ResponseEntity<List<Workflow>> listWorkflows(
            @RequestHeader("X-Tenant-Id") UUID tenantId) {
        return ResponseEntity.ok(workflowService.listWorkflows(tenantId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Workflow> getWorkflow(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(workflowService.getWorkflow(tenantId, id));
    }

    @PostMapping
    public ResponseEntity<Workflow> createWorkflow(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Workflow workflow) {
        return ResponseEntity.ok(workflowService.createWorkflow(tenantId, workflow));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Workflow> updateWorkflow(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Workflow updates) {
        return ResponseEntity.ok(workflowService.updateWorkflow(tenantId, id, updates));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteWorkflow(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        workflowService.deleteWorkflow(tenantId, id);
        return ResponseEntity.ok(Map.of("message", "Workflow deleted successfully"));
    }
}
