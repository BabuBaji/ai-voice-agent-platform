package com.voiceagent.crm.service;

import com.voiceagent.crm.entity.Contact;
import com.voiceagent.crm.repository.ContactRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ContactService {

    private final ContactRepository contactRepository;

    public Page<Contact> listContacts(UUID tenantId, Pageable pageable) {
        return contactRepository.findByTenantId(tenantId, pageable);
    }

    public Contact getContact(UUID tenantId, UUID contactId) {
        return contactRepository.findByIdAndTenantId(contactId, tenantId)
                .orElseThrow(() -> new RuntimeException("Contact not found"));
    }

    @Transactional
    public Contact createContact(UUID tenantId, Contact contact) {
        contact.setTenantId(tenantId);
        return contactRepository.save(contact);
    }

    @Transactional
    public Contact updateContact(UUID tenantId, UUID contactId, Contact updates) {
        Contact contact = getContact(tenantId, contactId);
        if (updates.getFirstName() != null) contact.setFirstName(updates.getFirstName());
        if (updates.getLastName() != null) contact.setLastName(updates.getLastName());
        if (updates.getEmail() != null) contact.setEmail(updates.getEmail());
        if (updates.getPhone() != null) contact.setPhone(updates.getPhone());
        if (updates.getCompany() != null) contact.setCompany(updates.getCompany());
        if (updates.getJobTitle() != null) contact.setJobTitle(updates.getJobTitle());
        if (updates.getCustomFields() != null) contact.setCustomFields(updates.getCustomFields());
        return contactRepository.save(contact);
    }

    @Transactional
    public void deleteContact(UUID tenantId, UUID contactId) {
        Contact contact = getContact(tenantId, contactId);
        contactRepository.delete(contact);
    }
}
