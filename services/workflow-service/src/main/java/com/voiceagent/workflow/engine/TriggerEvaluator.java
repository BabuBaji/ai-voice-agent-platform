package com.voiceagent.workflow.engine;

import com.voiceagent.workflow.entity.Trigger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class TriggerEvaluator {

    private final ConditionEvaluator conditionEvaluator;

    public boolean evaluate(Trigger trigger, Map<String, Object> eventData) {
        if (trigger.getConditions() == null || trigger.getConditions().isEmpty()) {
            return true;
        }

        try {
            return conditionEvaluator.evaluate(trigger.getConditions(), eventData);
        } catch (Exception e) {
            log.error("Failed to evaluate trigger conditions: triggerId={}", trigger.getId(), e);
            return false;
        }
    }
}
