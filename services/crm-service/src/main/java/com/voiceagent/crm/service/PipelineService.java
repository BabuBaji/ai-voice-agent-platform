package com.voiceagent.crm.service;

import com.voiceagent.crm.entity.Deal;
import com.voiceagent.crm.entity.Pipeline;
import com.voiceagent.crm.entity.PipelineStage;
import com.voiceagent.crm.repository.DealRepository;
import com.voiceagent.crm.repository.PipelineRepository;
import com.voiceagent.crm.repository.PipelineStageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class PipelineService {

    private final PipelineRepository pipelineRepository;
    private final PipelineStageRepository pipelineStageRepository;
    private final DealRepository dealRepository;

    public List<Pipeline> listPipelines(UUID tenantId) {
        return pipelineRepository.findByTenantId(tenantId);
    }

    public Pipeline getPipeline(UUID tenantId, UUID pipelineId) {
        return pipelineRepository.findByIdAndTenantId(pipelineId, tenantId)
                .orElseThrow(() -> new RuntimeException("Pipeline not found"));
    }

    @Transactional
    public Pipeline createPipeline(UUID tenantId, Pipeline pipeline) {
        pipeline.setTenantId(tenantId);
        return pipelineRepository.save(pipeline);
    }

    @Transactional
    public Pipeline updatePipeline(UUID tenantId, UUID pipelineId, Pipeline updates) {
        Pipeline pipeline = getPipeline(tenantId, pipelineId);
        if (updates.getName() != null) pipeline.setName(updates.getName());
        return pipelineRepository.save(pipeline);
    }

    @Transactional
    public void deletePipeline(UUID tenantId, UUID pipelineId) {
        Pipeline pipeline = getPipeline(tenantId, pipelineId);
        pipelineRepository.delete(pipeline);
    }

    public Map<String, Object> getBoardData(UUID tenantId, UUID pipelineId) {
        Pipeline pipeline = getPipeline(tenantId, pipelineId);
        List<PipelineStage> stages = pipelineStageRepository.findByPipelineIdOrderByPositionAsc(pipelineId);
        List<Deal> deals = dealRepository.findByPipelineIdAndTenantId(pipelineId, tenantId);

        Map<UUID, List<Deal>> dealsByStage = deals.stream()
                .collect(Collectors.groupingBy(Deal::getStageId));

        List<Map<String, Object>> columns = stages.stream().map(stage -> {
            Map<String, Object> column = new LinkedHashMap<>();
            column.put("stage", stage);
            column.put("deals", dealsByStage.getOrDefault(stage.getId(), List.of()));
            return column;
        }).toList();

        Map<String, Object> board = new LinkedHashMap<>();
        board.put("pipeline", pipeline);
        board.put("columns", columns);
        return board;
    }
}
