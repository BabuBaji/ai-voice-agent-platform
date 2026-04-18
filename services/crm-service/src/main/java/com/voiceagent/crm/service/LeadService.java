package com.voiceagent.crm.service;

import com.voiceagent.crm.entity.Lead;
import com.voiceagent.crm.enums.LeadSource;
import com.voiceagent.crm.enums.LeadStatus;
import com.voiceagent.crm.repository.LeadRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class LeadService {

    private final LeadRepository leadRepository;

    public Page<Lead> listLeads(UUID tenantId, LeadStatus status, LeadSource source, Pageable pageable) {
        return leadRepository.findByTenantIdAndFilters(tenantId, status, source, pageable);
    }

    public Lead getLead(UUID tenantId, UUID leadId) {
        return leadRepository.findByIdAndTenantId(leadId, tenantId)
                .orElseThrow(() -> new RuntimeException("Lead not found"));
    }

    @Transactional
    public Lead createLead(UUID tenantId, Lead lead) {
        lead.setTenantId(tenantId);
        return leadRepository.save(lead);
    }

    @Transactional
    public Lead updateLead(UUID tenantId, UUID leadId, Lead updates) {
        Lead lead = getLead(tenantId, leadId);
        if (updates.getFirstName() != null) lead.setFirstName(updates.getFirstName());
        if (updates.getLastName() != null) lead.setLastName(updates.getLastName());
        if (updates.getEmail() != null) lead.setEmail(updates.getEmail());
        if (updates.getPhone() != null) lead.setPhone(updates.getPhone());
        if (updates.getCompany() != null) lead.setCompany(updates.getCompany());
        if (updates.getSource() != null) lead.setSource(updates.getSource());
        if (updates.getStatus() != null) lead.setStatus(updates.getStatus());
        if (updates.getScore() != null) lead.setScore(updates.getScore());
        if (updates.getAssignedTo() != null) lead.setAssignedTo(updates.getAssignedTo());
        if (updates.getCustomFields() != null) lead.setCustomFields(updates.getCustomFields());
        return leadRepository.save(lead);
    }

    @Transactional
    public void deleteLead(UUID tenantId, UUID leadId) {
        Lead lead = getLead(tenantId, leadId);
        leadRepository.delete(lead);
    }
}
