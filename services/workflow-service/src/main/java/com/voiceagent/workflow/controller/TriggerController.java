package com.voiceagent.workflow.controller;

import com.voiceagent.workflow.entity.Trigger;
import com.voiceagent.workflow.repository.TriggerRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/triggers")
@RequiredArgsConstructor
public class TriggerController {

    private final TriggerRepository triggerRepository;

    @GetMapping
    public ResponseEntity<List<Trigger>> listTriggers(
            @RequestParam UUID workflowId) {
        return ResponseEntity.ok(triggerRepository.findByWorkflowId(workflowId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Trigger> getTrigger(@PathVariable UUID id) {
        return ResponseEntity.ok(triggerRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Trigger not found")));
    }

    @PostMapping
    public ResponseEntity<Trigger> createTrigger(@RequestBody Trigger trigger) {
        return ResponseEntity.ok(triggerRepository.save(trigger));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Trigger> updateTrigger(@PathVariable UUID id,
                                                  @RequestBody Trigger updates) {
        Trigger trigger = triggerRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Trigger not found"));
        if (updates.getType() != null) trigger.setType(updates.getType());
        if (updates.getConditions() != null) trigger.setConditions(updates.getConditions());
        return ResponseEntity.ok(triggerRepository.save(trigger));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteTrigger(@PathVariable UUID id) {
        triggerRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "Trigger deleted successfully"));
    }
}
