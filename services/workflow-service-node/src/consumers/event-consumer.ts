import amqplib from 'amqplib';
import { config } from '../config';
import { workflowEngine, WorkflowEvent } from '../engine/workflow-engine';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

const EXCHANGE_NAME = 'voice_agent_events';
const QUEUE_NAME = 'workflow.events';
const ROUTING_KEYS = [
  'call.ended',
  'lead.captured',
  'deal.stage_changed',
  'appointment.booked',
];

let connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
let channel: Awaited<ReturnType<Awaited<ReturnType<typeof amqplib.connect>>['createChannel']>> | null = null;

/**
 * Start the RabbitMQ consumer that listens for platform events
 * and feeds them into the WorkflowEngine.
 */
export async function startEventConsumer(): Promise<void> {
  try {
    connection = await amqplib.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();

    // Declare exchange (topic type for routing key matching)
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    // Declare queue
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // Bind queue to all relevant routing keys
    for (const key of ROUTING_KEYS) {
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, key);
      logger.info({ routingKey: key }, 'Bound routing key');
    }

    // Set prefetch to 1 for fair dispatch
    await channel.prefetch(1);

    // Start consuming
    await channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString());

        const event: WorkflowEvent = {
          type: msg.fields.routingKey,
          tenantId: payload.data?.tenantId || payload.tenantId || '',
          data: payload.data || payload,
        };

        if (!event.tenantId) {
          logger.warn({ routingKey: msg.fields.routingKey }, 'Event missing tenantId, skipping');
          channel!.ack(msg);
          return;
        }

        logger.info(
          { routingKey: msg.fields.routingKey, tenantId: event.tenantId },
          'Received event'
        );

        const results = await workflowEngine.processEvent(event);

        logger.info(
          { routingKey: msg.fields.routingKey, workflowsTriggered: results.length },
          'Event processed'
        );

        channel!.ack(msg);
      } catch (err) {
        logger.error({ error: (err as Error).message }, 'Failed to process event');
        // Requeue on failure (with redelivery flag check to avoid infinite loop)
        if (msg.fields.redelivered) {
          logger.warn('Message already redelivered, sending to dead letter');
          channel!.nack(msg, false, false);
        } else {
          channel!.nack(msg, false, true);
        }
      }
    });

    logger.info({ queue: QUEUE_NAME }, 'Event consumer started');

    // Handle connection close
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, will attempt reconnect');
      setTimeout(() => startEventConsumer().catch(() => {}), 5000);
    });

    connection.on('error', (err) => {
      logger.error({ error: err.message }, 'RabbitMQ connection error');
    });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to start event consumer');
    throw err;
  }
}

/**
 * Gracefully close the RabbitMQ connection.
 */
export async function stopEventConsumer(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('Event consumer stopped');
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Error stopping event consumer');
  }
}
