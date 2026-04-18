import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/** Supported trigger event types */
export type TriggerType =
  | 'CALL_ENDED'
  | 'LEAD_CAPTURED'
  | 'DEAL_STAGE_CHANGED'
  | 'APPOINTMENT_BOOKED';

/** Maps RabbitMQ routing keys to trigger types */
const ROUTING_KEY_TO_TRIGGER: Record<string, TriggerType> = {
  'call.ended': 'CALL_ENDED',
  'lead.captured': 'LEAD_CAPTURED',
  'deal.stage_changed': 'DEAL_STAGE_CHANGED',
  'appointment.booked': 'APPOINTMENT_BOOKED',
};

export interface TriggerCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'exists' | 'not_exists';
  value: any;
}

export interface Trigger {
  id: string;
  workflow_id: string;
  type: string;
  conditions: {
    all?: TriggerCondition[];
    any?: TriggerCondition[];
  };
}

/**
 * Resolves a RabbitMQ routing key to a TriggerType.
 */
export function routingKeyToTriggerType(routingKey: string): TriggerType | null {
  return ROUTING_KEY_TO_TRIGGER[routingKey] || null;
}

/**
 * Evaluates whether an event matches a trigger definition.
 */
export function evaluateTrigger(
  trigger: Trigger,
  eventType: string,
  eventData: Record<string, any>
): boolean {
  // 1. Check type match
  if (trigger.type !== eventType) {
    return false;
  }

  // 2. Evaluate conditions
  const conditions = trigger.conditions;

  // If no conditions, trigger matches on type alone
  if (!conditions || ((!conditions.all || conditions.all.length === 0) && (!conditions.any || conditions.any.length === 0))) {
    return true;
  }

  // ALL conditions must pass
  if (conditions.all && conditions.all.length > 0) {
    const allPass = conditions.all.every((cond) => evaluateCondition(cond, eventData));
    if (!allPass) return false;
  }

  // ANY condition must pass (if specified)
  if (conditions.any && conditions.any.length > 0) {
    const anyPass = conditions.any.some((cond) => evaluateCondition(cond, eventData));
    if (!anyPass) return false;
  }

  return true;
}

/**
 * Evaluates a single condition against event data.
 * Supports nested field access via dot notation (e.g. "call.duration").
 */
function evaluateCondition(condition: TriggerCondition, data: Record<string, any>): boolean {
  const fieldValue = getNestedValue(data, condition.field);

  try {
    switch (condition.operator) {
      case 'equals':
        return fieldValue == condition.value; // loose equality for type coercion
      case 'not_equals':
        return fieldValue != condition.value;
      case 'contains':
        if (typeof fieldValue === 'string') {
          return fieldValue.toLowerCase().includes(String(condition.value).toLowerCase());
        }
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(condition.value);
        }
        return false;
      case 'greater_than':
        return Number(fieldValue) > Number(condition.value);
      case 'less_than':
        return Number(fieldValue) < Number(condition.value);
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;
      default:
        logger.warn({ operator: condition.operator }, 'Unknown condition operator');
        return false;
    }
  } catch (err) {
    logger.warn({ condition, error: (err as Error).message }, 'Error evaluating condition');
    return false;
  }
}

/**
 * Gets a nested value from an object using dot notation.
 * e.g. getNestedValue({ call: { duration: 120 } }, "call.duration") => 120
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, obj as any);
}
