package com.voiceagent.crm.service;

import com.voiceagent.crm.entity.Deal;
import com.voiceagent.crm.repository.DealRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class DealService {

    private final DealRepository dealRepository;

    public Page<Deal> listDeals(UUID tenantId, Pageable pageable) {
        return dealRepository.findByTenantId(tenantId, pageable);
    }

    public Deal getDeal(UUID tenantId, UUID dealId) {
        return dealRepository.findByIdAndTenantId(dealId, tenantId)
                .orElseThrow(() -> new RuntimeException("Deal not found"));
    }

    @Transactional
    public Deal createDeal(UUID tenantId, Deal deal) {
        deal.setTenantId(tenantId);
        return dealRepository.save(deal);
    }

    @Transactional
    public Deal updateDeal(UUID tenantId, UUID dealId, Deal updates) {
        Deal deal = getDeal(tenantId, dealId);
        if (updates.getTitle() != null) deal.setTitle(updates.getTitle());
        if (updates.getValue() != null) deal.setValue(updates.getValue());
        if (updates.getExpectedCloseDate() != null) deal.setExpectedCloseDate(updates.getExpectedCloseDate());
        if (updates.getAssignedTo() != null) deal.setAssignedTo(updates.getAssignedTo());
        if (updates.getStatus() != null) deal.setStatus(updates.getStatus());
        return dealRepository.save(deal);
    }

    @Transactional
    public Deal moveDeal(UUID tenantId, UUID dealId, UUID stageId) {
        Deal deal = getDeal(tenantId, dealId);
        deal.setStageId(stageId);
        return dealRepository.save(deal);
    }

    @Transactional
    public void deleteDeal(UUID tenantId, UUID dealId) {
        Deal deal = getDeal(tenantId, dealId);
        dealRepository.delete(deal);
    }
}
