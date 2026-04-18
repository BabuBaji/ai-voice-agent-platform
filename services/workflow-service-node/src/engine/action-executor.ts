import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export type ActionType =
  | 'SEND_EMAIL'
  | 'SEND_SMS'
  | 'UPDATE_LEAD'
  | 'CREATE_TASK'
  | 'WEBHOOK'
  | 'WAIT';

export interface ActionDefinition {
  id: string;
  workflow_id: string;
  type: ActionType;
  config: Record<string, any>;
  position: number;
}

export interface ActionResult {
  actionId: string;
  type: string;
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * Executes a single workflow action.
 */
export async function executeAction(
  action: ActionDefinition,
  eventData: Record<string, any>,
  tenantId: string
): Promise<ActionResult> {
  logger.info({ actionId: action.id, type: action.type }, 'Executing action');

  try {
    switch (action.type) {
      case 'SEND_EMAIL':
        return await executeSendEmail(action, eventData, tenantId);
      case 'SEND_SMS':
        return await executeSendSMS(action, eventData, tenantId);
      case 'UPDATE_LEAD':
        return await executeUpdateLead(action, eventData, tenantId);
      case 'CREATE_TASK':
        return await executeCreateTask(action, eventData, tenantId);
      case 'WEBHOOK':
        return await executeWebhook(action, eventData, tenantId);
      case 'WAIT':
        return await executeWait(action);
      default:
        return {
          actionId: action.id,
          type: action.type,
          success: false,
          error: `Unknown action type: ${action.type}`,
        };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ actionId: action.id, error: errorMessage }, 'Action execution failed');
    return {
      actionId: action.id,
      type: action.type,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Interpolates template variables in a string using event data.
 * e.g. "Hello {{contact.name}}" with { contact: { name: "John" } } => "Hello John"
 */
function interpolate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\S+?)\}\}/g, (_match, path: string) => {
    const value = path.split('.').reduce((obj: any, key: string) => {
      if (obj === undefined || obj === null) return '';
      return obj[key];
    }, data);
    return value !== undefined && value !== null ? String(value) : '';
  });
}

async function executeSendEmail(
  action: ActionDefinition,
  eventData: Record<string, any>,
  tenantId: string
): Promise<ActionResult> {
  const { recipient, subject, body, templateId } = action.config;

  const resolvedRecipient = interpolate(recipient || '', eventData);
  const resolvedSubject = interpolate(subject || '', eventData);
  const resolvedBody = interpolate(body || '', eventData);

  const payload: Record<string, any> = {
    type: 'email',
    recipient: resolvedRecipient,
    subject: resolvedSubject,
    body: resolvedBody,
  };
  if (templateId) payload.templateId = templateId;

  const response = await fetch(`${config.notificationServiceUrl}/api/v1/notifications/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notification service returned ${response.status}: ${text}`);
  }

  const result = await response.json();
  return { actionId: action.id, type: 'SEND_EMAIL', success: true, result };
}

async function executeSendSMS(
  action: ActionDefinition,
  eventData: Record<string, any>,
  tenantId: string
): Promise<ActionResult> {
  const { recipient, body } = action.config;

  const resolvedRecipient = interpolate(recipient || '', eventData);
  const resolvedBody = interpolate(body || '', eventData);

  const response = await fetch(`${config.notificationServiceUrl}/api/v1/notifications/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({
      type: 'sms',
      recipient: resolvedRecipient,
      body: resolvedBody,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notification service returned ${response.status}: ${text}`);
  }

  const result = await response.json();
  return { actionId: action.id, type: 'SEND_SMS', success: true, result };
}

async function executeUpdateLead(
  action: ActionDefinition,
  eventData: Record<string, any>,
  tenantId: string
): Promise<ActionResult> {
  const { leadIdField, updates } = action.config;

  // Resolve the lead ID from event data
  const leadId = leadIdField
    ? leadIdField.split('.').reduce((obj: any, key: string) => obj?.[key], eventData)
    : eventData.leadId || eventData.lead_id;

  if (!leadId) {
    throw new Error('Could not resolve lead ID from event data');
  }

  // Interpolate update values
  const resolvedUpdates: Record<string, any> = {};
  for (const [key, value] of Object.entries(updates || {})) {
    resolvedUpdates[key] = typeof value === 'string' ? interpolate(value, eventData) : value;
  }

  const response = await fetch(`${config.crmServiceUrl}/leads/${leadId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(resolvedUpdates),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CRM service returned ${response.status}: ${text}`);
  }

  const result = await response.json();
  return { actionId: action.id, type: 'UPDATE_LEAD', success: true, result };
}

async function executeCreateTask(
  action: ActionDefinition,
  eventData: Record<string, any>,
  tenantId: string
): Promise<ActionResult> {
  const { title, description, priority, dueInHours, assignedTo } = action.config;

  const resolvedTitle = interpolate(title || 'Follow-up task', eventData);
  const resolvedDescription = interpolate(description || '', eventData);

  const dueDate = dueInHours
    ? new Date(Date.now() + Number(dueInHours) * 3600_000).toISOString()
    : undefined;

  const payload: Record<string, any> = {
    title: resolvedTitle,
    description: resolvedDescription,
    priority: priority || 'MEDIUM',
    status: 'TODO',
  };
  if (dueDate) payload.due_date = dueDate;
  if (assignedTo) payload.assigned_to = assignedTo;

  // Link to lead/deal if available in event data
  if (eventData.leadId || eventData.lead_id) {
    payload.lead_id = eventData.leadId || eventData.lead_id;
  }
  if (eventData.dealId || eventData.deal_id) {
    payload.deal_id = eventData.dealId || eventData.deal_id;
  }

  const response = await fetch(`${config.crmServiceUrl}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CRM service returned ${response.status}: ${text}`);
  }

  const result = await response.json();
  return { actionId: action.id, type: 'CREATE_TASK', success: true, result };
}

async function executeWebhook(
  action: ActionDefinition,
  eventData: Record<string, any>,
  tenantId: string
): Promise<ActionResult> {
  const { url, method, headers, bodyTemplate } = action.config;

  if (!url) {
    throw new Error('Webhook URL is required');
  }

  const resolvedUrl = interpolate(url, eventData);
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
    'X-Webhook-Source': 'workflow-service',
    ...(headers || {}),
  };

  const requestBody = bodyTemplate
    ? JSON.parse(interpolate(JSON.stringify(bodyTemplate), eventData))
    : { event: eventData, tenantId, timestamp: new Date().toISOString() };

  const response = await fetch(resolvedUrl, {
    method: method || 'POST',
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30_000), // 30 second timeout
  });

  return {
    actionId: action.id,
    type: 'WEBHOOK',
    success: response.ok,
    result: {
      statusCode: response.status,
      statusText: response.statusText,
    },
  };
}

async function executeWait(action: ActionDefinition): Promise<ActionResult> {
  const { durationSeconds } = action.config;
  const seconds = Math.min(Number(durationSeconds) || 5, 300); // Cap at 5 minutes

  logger.info({ actionId: action.id, seconds }, 'Waiting');
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  return { actionId: action.id, type: 'WAIT', success: true, result: { waitedSeconds: seconds } };
}
