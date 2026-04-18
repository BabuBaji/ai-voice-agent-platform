package com.voiceagent.crm.controller;

import com.voiceagent.crm.entity.Contact;
import com.voiceagent.crm.service.ContactService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/contacts")
@RequiredArgsConstructor
public class ContactController {

    private final ContactService contactService;

    @GetMapping
    public ResponseEntity<Page<Contact>> listContacts(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(contactService.listContacts(tenantId,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"))));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Contact> getContact(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        return ResponseEntity.ok(contactService.getContact(tenantId, id));
    }

    @PostMapping
    public ResponseEntity<Contact> createContact(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @RequestBody Contact contact) {
        return ResponseEntity.ok(contactService.createContact(tenantId, contact));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Contact> updateContact(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id,
            @RequestBody Contact updates) {
        return ResponseEntity.ok(contactService.updateContact(tenantId, id, updates));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteContact(
            @RequestHeader("X-Tenant-Id") UUID tenantId,
            @PathVariable UUID id) {
        contactService.deleteContact(tenantId, id);
        return ResponseEntity.ok(Map.of("message", "Contact deleted successfully"));
    }
}
