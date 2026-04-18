package com.voiceagent.workflow.engine;

import com.voiceagent.workflow.entity.Action;
import com.voiceagent.workflow.entity.Trigger;
import com.voiceagent.workflow.entity.WorkflowExecution;
import com.voiceagent.workflow.enums.ExecutionStatus;
import com.voiceagent.workflow.enums.TriggerType;
import com.voiceagent.workflow.repository.ActionRepository;
import com.voiceagent.workflow.repository.TriggerRepository;
import com.voiceagent.workflow.repository.WorkflowExecutionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class WorkflowEngine {

    private final TriggerRepository triggerRepository;
    private final ActionRepository actionRepository;
    private final WorkflowExecutionRepository executionRepository;
    private final TriggerEvaluator triggerEvaluator;
    private final ActionExecutor actionExecutor;

    public void processEvent(UUID tenantId, TriggerType triggerType, Map<String, Object> eventData) {
        log.info("Processing event: tenantId={}, triggerType={}", tenantId, triggerType);

        List<Trigger> matchingTriggers = triggerRepository.findActiveByTenantIdAndType(tenantId, triggerType);

        for (Trigger trigger : matchingTriggers) {
            if (triggerEvaluator.evaluate(trigger, eventData)) {
                executeWorkflow(trigger.getWorkflow().getId(), triggerType.name(), eventData);
            }
        }
    }

    private void executeWorkflow(UUID workflowId, String triggeredBy, Map<String, Object> eventData) {
        WorkflowExecution execution = WorkflowExecution.builder()
                .workflowId(workflowId)
                .triggeredBy(triggeredBy)
                .status(ExecutionStatus.RUNNING)
                .startedAt(Instant.now())
                .build();
        execution = executionRepository.save(execution);

        try {
            List<Action> actions = actionRepository.findByWorkflowIdOrderByPositionAsc(workflowId);
            Map<String, Object> context = new java.util.HashMap<>(eventData);

            for (Action action : actions) {
                actionExecutor.execute(action, context);
            }

            execution.setStatus(ExecutionStatus.COMPLETED);
            execution.setCompletedAt(Instant.now());
            execution.setResult(Map.of("actionsExecuted", actions.size()));
        } catch (Exception e) {
            log.error("Workflow execution failed: workflowId={}", workflowId, e);
            execution.setStatus(ExecutionStatus.FAILED);
            execution.setCompletedAt(Instant.now());
            execution.setResult(Map.of("error", e.getMessage()));
        }

        executionRepository.save(execution);
    }
}
