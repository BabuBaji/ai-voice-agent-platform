package com.voiceagent.workflow.engine;

import com.voiceagent.workflow.entity.Action;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

@Slf4j
@Component
public class ActionExecutor {

    /**
     * Executes an action based on its type and configuration.
     * This is a stub implementation - each action type will be implemented with actual integrations.
     */
    public void execute(Action action, Map<String, Object> context) {
        log.info("Executing action: type={}, position={}", action.getType(), action.getPosition());

        switch (action.getType()) {
            case SEND_EMAIL -> executeSendEmail(action.getConfig(), context);
            case SEND_SMS -> executeSendSms(action.getConfig(), context);
            case SEND_WHATSAPP -> executeSendWhatsapp(action.getConfig(), context);
            case UPDATE_LEAD -> executeUpdateLead(action.getConfig(), context);
            case CREATE_TASK -> executeCreateTask(action.getConfig(), context);
            case WEBHOOK -> executeWebhook(action.getConfig(), context);
            case TRANSFER_CALL -> executeTransferCall(action.getConfig(), context);
        }
    }

    private void executeSendEmail(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Sending email with config: {}", config);
        // TODO: Integrate with notification service
    }

    private void executeSendSms(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Sending SMS with config: {}", config);
        // TODO: Integrate with notification service
    }

    private void executeSendWhatsapp(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Sending WhatsApp message with config: {}", config);
        // TODO: Integrate with notification service
    }

    private void executeUpdateLead(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Updating lead with config: {}", config);
        // TODO: Call CRM service to update lead
    }

    private void executeCreateTask(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Creating task with config: {}", config);
        // TODO: Call CRM service to create task
    }

    private void executeWebhook(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Calling webhook with config: {}", config);
        // TODO: Make HTTP call to configured URL
    }

    private void executeTransferCall(Map<String, Object> config, Map<String, Object> context) {
        log.info("Stub: Transferring call with config: {}", config);
        // TODO: Call telephony service to transfer
    }
}
