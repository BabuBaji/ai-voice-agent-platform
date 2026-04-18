package com.voiceagent.crm.controller;

import com.voiceagent.crm.entity.Pipeline;
import com.voiceagent.crm.service.PipelineService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/pipelines")
@RequiredArgsConstructor
public class PipelineController {

    private final PipelineService pipelineService;

    @GetMapping
    public ResponseEntity<List<Pipeline>> listPipelines(
            @RequestHeader("X-Tenant-Id") UUID tenantId) {
        return ResponseEntity.ok(pipelineService.listPipelines(tenantId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Pipeline> getPipeline(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(pipelineService.getPipeline(tenantId, id));
    }

    @GetMapping("/{id}/board")
    public ResponseEntity<Map<String, Object>> getBoardData(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(pipelineService.getBoardData(tenantId, id));
    }

    @PostMapping
    public ResponseEntity<Pipeline> createPipeline(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Pipeline pipeline) {
        return ResponseEntity.ok(pipelineService.createPipeline(tenantId, pipeline));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Pipeline> updatePipeline(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Pipeline updates) {
        return ResponseEntity.ok(pipelineService.updatePipeline(tenantId, id, updates));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deletePipeline(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        pipelineService.deletePipeline(tenantId, id);
        return ResponseEntity.ok(Map.of("message", "Pipeline deleted successfully"));
    }
}
