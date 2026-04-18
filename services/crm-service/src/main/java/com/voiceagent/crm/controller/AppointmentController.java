package com.voiceagent.crm.controller;

import com.voiceagent.crm.entity.Appointment;
import com.voiceagent.crm.repository.AppointmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/appointments")
@RequiredArgsConstructor
public class AppointmentController {

    private final AppointmentRepository appointmentRepository;

    @GetMapping
    public ResponseEntity<Page<Appointment>> listAppointments(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(appointmentRepository.findByTenantId(tenantId,
                PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "scheduledAt"))));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Appointment> getAppointment(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(appointmentRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Appointment not found")));
    }

    @PostMapping
    public ResponseEntity<Appointment> createAppointment(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Appointment appointment) {
        appointment.setTenantId(tenantId);
        return ResponseEntity.ok(appointmentRepository.save(appointment));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Appointment> updateAppointment(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Appointment updates) {
        Appointment appointment = appointmentRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Appointment not found"));
        if (updates.getTitle() != null) appointment.setTitle(updates.getTitle());
        if (updates.getScheduledAt() != null) appointment.setScheduledAt(updates.getScheduledAt());
        if (updates.getDurationMinutes() != null) appointment.setDurationMinutes(updates.getDurationMinutes());
        if (updates.getLocation() != null) appointment.setLocation(updates.getLocation());
        if (updates.getNotes() != null) appointment.setNotes(updates.getNotes());
        if (updates.getStatus() != null) appointment.setStatus(updates.getStatus());
        return ResponseEntity.ok(appointmentRepository.save(appointment));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteAppointment(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        Appointment appointment = appointmentRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new RuntimeException("Appointment not found"));
        appointmentRepository.delete(appointment);
        return ResponseEntity.ok(Map.of("message", "Appointment deleted successfully"));
    }
}
