package com.voiceagent.workflow.engine;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Objects;

@Slf4j
@Component
public class ConditionEvaluator {

    /**
     * Evaluates JSON conditions against event data.
     * Supports simple field matching for now.
     * Example conditions: {"field": "status", "operator": "equals", "value": "QUALIFIED"}
     */
    public boolean evaluate(Map<String, Object> conditions, Map<String, Object> eventData) {
        if (conditions == null || conditions.isEmpty()) {
            return true;
        }

        String field = (String) conditions.get("field");
        String operator = (String) conditions.get("operator");
        Object expectedValue = conditions.get("value");

        if (field == null || operator == null) {
            log.warn("Condition missing field or operator, defaulting to true");
            return true;
        }

        Object actualValue = eventData.get(field);

        return switch (operator) {
            case "equals" -> Objects.equals(actualValue, expectedValue);
            case "not_equals" -> !Objects.equals(actualValue, expectedValue);
            case "contains" -> actualValue != null && actualValue.toString().contains(expectedValue.toString());
            case "exists" -> actualValue != null;
            case "not_exists" -> actualValue == null;
            default -> {
                log.warn("Unknown operator: {}", operator);
                yield false;
            }
        };
    }
}
