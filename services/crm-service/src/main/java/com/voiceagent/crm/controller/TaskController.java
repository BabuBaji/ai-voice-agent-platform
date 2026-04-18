package com.voiceagent.crm.controller;

import com.voiceagent.crm.entity.Task;
import com.voiceagent.crm.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskRepository taskRepository;

    @GetMapping
    public ResponseEntity<Page<Task>> listTasks(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(taskRepository.findByTenantId(tenantId,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Task> getTask(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(taskRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Task not found")));
    }

    @PostMapping
    public ResponseEntity<Task> createTask(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Task task) {
        task.setTenantId(tenantId);
        return ResponseEntity.ok(taskRepository.save(task));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Task> updateTask(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Task updates) {
        Task task = taskRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Task not found"));
        if (updates.getTitle() != null) task.setTitle(updates.getTitle());
        if (updates.getDescription() != null) task.setDescription(updates.getDescription());
        if (updates.getDueDate() != null) task.setDueDate(updates.getDueDate());
        if (updates.getPriority() != null) task.setPriority(updates.getPriority());
        if (updates.getStatus() != null) task.setStatus(updates.getStatus());
        if (updates.getAssignedTo() != null) task.setAssignedTo(updates.getAssignedTo());
        return ResponseEntity.ok(taskRepository.save(task));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteTask(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        Task task = taskRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Task not found"));
        taskRepository.delete(task);
        return ResponseEntity.ok(Map.of("message", "Task deleted successfully"));
    }
}
