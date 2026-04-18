package com.voiceagent.crm.controller;

import com.voiceagent.crm.entity.Lead;
import com.voiceagent.crm.enums.LeadSource;
import com.voiceagent.crm.enums.LeadStatus;
import com.voiceagent.crm.service.LeadService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/leads")
@RequiredArgsConstructor
public class LeadController {

    private final LeadService leadService;

    @GetMapping
    public ResponseEntity<Page<Lead>> listLeads(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam(required = false) LeadStatus status,
            @RequestParam(required = false) LeadSource source,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(leadService.listLeads(tenantId, status, source,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Lead> getLead(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(leadService.getLead(tenantId, id));
    }

    @PostMapping
    public ResponseEntity<Lead> createLead(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Lead lead) {
        return ResponseEntity.ok(leadService.createLead(tenantId, lead));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Lead> updateLead(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Lead updates) {
        return ResponseEntity.ok(leadService.updateLead(tenantId, id, updates));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteLead(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        leadService.deleteLead(tenantId, id);
        return ResponseEntity.ok(Map.of("message", "Lead deleted successfully"));
    }
}
