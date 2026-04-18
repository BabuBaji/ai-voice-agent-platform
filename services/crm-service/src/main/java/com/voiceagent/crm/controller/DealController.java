package com.voiceagent.crm.controller;

import com.voiceagent.crm.entity.Deal;
import com.voiceagent.crm.service.DealService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/deals")
@RequiredArgsConstructor
public class DealController {

    private final DealService dealService;

    @GetMapping
    public ResponseEntity<Page<Deal>> listDeals(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(dealService.listDeals(tenantId,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Deal> getDeal(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(dealService.getDeal(tenantId, id));
    }

    @PostMapping
    public ResponseEntity<Deal> createDeal(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Deal deal) {
        return ResponseEntity.ok(dealService.createDeal(tenantId, deal));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Deal> updateDeal(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Deal updates) {
        return ResponseEntity.ok(dealService.updateDeal(tenantId, id, updates));
    }

    @PutMapping("/{id}/move")
    public ResponseEntity<Deal> moveDeal(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Map<String, UUID> body) {
        return ResponseEntity.ok(dealService.moveDeal(tenantId, id, body.get("stageId")));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteDeal(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        dealService.deleteDeal(tenantId, id);
        return ResponseEntity.ok(Map.of("message", "Deal deleted successfully"));
    }
}
