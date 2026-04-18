package com.voiceagent.workflow.listener;

import com.voiceagent.workflow.engine.WorkflowEngine;
import com.voiceagent.workflow.enums.TriggerType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class EventListener {

    private final WorkflowEngine workflowEngine;

    @RabbitListener(queues = "workflow.events")
    public void handleEvent(Map<String, Object> event) {
        log.info("Received event: {}", event);

        try {
            UUID tenantId = UUID.fromString((String) event.get("tenantId"));
            TriggerType triggerType = TriggerType.valueOf((String) event.get("eventType"));

            @SuppressWarnings("unchecked")
            Map<String, Object> eventData = (Map<String, Object>) event.getOrDefault("data", Map.of());

            workflowEngine.processEvent(tenantId, triggerType, eventData);
        } catch (Exception e) {
            log.error("Failed to process event: {}", event, e);
        }
    }
}
