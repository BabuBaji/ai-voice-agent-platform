import { pool } from '../db/init';
import { evaluateTrigger, routingKeyToTriggerType, Trigger } from './trigger-evaluator';
import { executeAction, ActionDefinition, ActionResult } from './action-executor';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface WorkflowEvent {
  type: string;       // routing key, e.g. "call.ended"
  tenantId: string;
  data: Record<string, any>;
}

export interface ExecutionResult {
  executionId: string;
  workflowId: string;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL';
  actionResults: ActionResult[];
  error?: string;
}

class WorkflowEngine {
  /**
   * Process an incoming event by matching it against active workflows,
   * evaluating triggers, and executing actions in order.
   */
  async processEvent(event: WorkflowEvent): Promise<ExecutionResult[]> {
    const triggerType = routingKeyToTriggerType(event.type);
    if (!triggerType) {
      logger.debug({ eventType: event.type }, 'No trigger type mapped for event');
      return [];
    }

    logger.info({ eventType: event.type, triggerType, tenantId: event.tenantId }, 'Processing event');

    // 1. Find all active workflows for this tenant that have triggers of the matching type
    const workflowRows = await pool.query(
      `SELECT DISTINCT w.id, w.name
       FROM workflows w
       INNER JOIN triggers t ON t.workflow_id = w.id
       WHERE w.tenant_id = $1
         AND w.is_active = TRUE
         AND t.type = $2`,
      [event.tenantId, triggerType]
    );

    if (workflowRows.rows.length === 0) {
      logger.debug({ tenantId: event.tenantId, triggerType }, 'No matching workflows found');
      return [];
    }

    const results: ExecutionResult[] = [];

    for (const workflow of workflowRows.rows) {
      try {
        const result = await this.executeWorkflow(workflow.id, workflow.name, triggerType, event);
        results.push(result);
      } catch (err) {
        logger.error({ workflowId: workflow.id, error: (err as Error).message }, 'Workflow execution failed');
      }
    }

    return results;
  }

  /**
   * Execute a single workflow: evaluate its triggers, then run actions in order.
   */
  private async executeWorkflow(
    workflowId: string,
    workflowName: string,
    triggerType: string,
    event: WorkflowEvent
  ): Promise<ExecutionResult> {
    // 2. Get triggers for this workflow
    const triggerRows = await pool.query(
      `SELECT id, workflow_id, type, conditions FROM triggers WHERE workflow_id = $1 AND type = $2`,
      [workflowId, triggerType]
    );

    const triggers: Trigger[] = triggerRows.rows.map((r) => ({
      id: r.id,
      workflow_id: r.workflow_id,
      type: r.type,
      conditions: r.conditions || {},
    }));

    // 3. Check if any trigger matches
    const matched = triggers.some((trigger) => evaluateTrigger(trigger, triggerType, event.data));
    if (!matched) {
      logger.debug({ workflowId, triggerType }, 'No trigger conditions matched');
      return {
        executionId: '',
        workflowId,
        status: 'COMPLETED',
        actionResults: [],
      };
    }

    // 4. Create execution record
    const execResult = await pool.query(
      `INSERT INTO workflow_executions (workflow_id, tenant_id, triggered_by, status)
       VALUES ($1, $2, $3, 'RUNNING')
       RETURNING id`,
      [workflowId, event.tenantId, event.type]
    );
    const executionId = execResult.rows[0].id;

    logger.info({ executionId, workflowId, workflowName }, 'Workflow execution started');

    // 5. Get actions in order
    const actionRows = await pool.query(
      `SELECT id, workflow_id, type, config, position
       FROM actions
       WHERE workflow_id = $1
       ORDER BY position ASC`,
      [workflowId]
    );

    const actions: ActionDefinition[] = actionRows.rows.map((r) => ({
      id: r.id,
      workflow_id: r.workflow_id,
      type: r.type,
      config: r.config || {},
      position: r.position,
    }));

    // 6. Execute actions sequentially
    const actionResults: ActionResult[] = [];
    let hasError = false;

    for (const action of actions) {
      const result = await executeAction(action, event.data, event.tenantId);
      actionResults.push(result);

      if (!result.success) {
        hasError = true;
        logger.warn(
          { executionId, actionId: action.id, error: result.error },
          'Action failed, continuing with next action'
        );
        // Continue executing remaining actions (non-fatal)
      }
    }

    // 7. Update execution record
    const status = hasError ? 'PARTIAL' : 'COMPLETED';
    await pool.query(
      `UPDATE workflow_executions
       SET status = $1, completed_at = NOW(), result = $2
       WHERE id = $3`,
      [status, JSON.stringify({ actions: actionResults }), executionId]
    );

    logger.info({ executionId, workflowId, status, actionsRun: actions.length }, 'Workflow execution completed');

    return { executionId, workflowId, status, actionResults };
  }

  /**
   * Manually execute a workflow (for testing / manual trigger).
   */
  async executeManual(workflowId: string, tenantId: string, data: Record<string, any> = {}): Promise<ExecutionResult> {
    // Verify workflow exists and belongs to tenant
    const wfResult = await pool.query(
      `SELECT id, name FROM workflows WHERE id = $1 AND tenant_id = $2`,
      [workflowId, tenantId]
    );

    if (wfResult.rows.length === 0) {
      throw new Error('Workflow not found');
    }

    const workflow = wfResult.rows[0];

    // Create execution record
    const execResult = await pool.query(
      `INSERT INTO workflow_executions (workflow_id, tenant_id, triggered_by, status)
       VALUES ($1, $2, 'MANUAL', 'RUNNING')
       RETURNING id`,
      [workflowId, tenantId]
    );
    const executionId = execResult.rows[0].id;

    // Get actions
    const actionRows = await pool.query(
      `SELECT id, workflow_id, type, config, position
       FROM actions
       WHERE workflow_id = $1
       ORDER BY position ASC`,
      [workflowId]
    );

    const actions: ActionDefinition[] = actionRows.rows.map((r) => ({
      id: r.id,
      workflow_id: r.workflow_id,
      type: r.type,
      config: r.config || {},
      position: r.position,
    }));

    const actionResults: ActionResult[] = [];
    let hasError = false;

    for (const action of actions) {
      const result = await executeAction(action, data, tenantId);
      actionResults.push(result);
      if (!result.success) hasError = true;
    }

    const status = hasError ? 'PARTIAL' : 'COMPLETED';
    await pool.query(
      `UPDATE workflow_executions
       SET status = $1, completed_at = NOW(), result = $2
       WHERE id = $3`,
      [status, JSON.stringify({ actions: actionResults }), executionId]
    );

    return { executionId, workflowId, status, actionResults };
  }
}

export const workflowEngine = new WorkflowEngine();
