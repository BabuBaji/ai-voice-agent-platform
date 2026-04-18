import { config } from '../config';
import pino from 'pino';

const logger = pino({
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

const QUEUE_NAME = 'notification.workflow';

/**
 * RabbitMQ consumer for workflow-triggered notifications.
 *
 * Listens on the 'notification.workflow' queue for messages from the
 * workflow service and dispatches them to the appropriate provider.
 */
export async function startConsumer(): Promise<void> {
  // TODO: Replace with actual amqplib connection in production
  // const amqp = await import('amqplib');
  // const connection = await amqp.connect(config.rabbitmqUrl);
  // const channel = await connection.createChannel();
  // await channel.assertQueue(QUEUE_NAME, { durable: true });

  logger.info({ queue: QUEUE_NAME }, 'RabbitMQ consumer starting...');

  // Stub: log that consumer would be running
  // In production:
  // channel.consume(QUEUE_NAME, async (msg) => {
  //   if (!msg) return;
  //   try {
  //     const payload = JSON.parse(msg.content.toString());
  //     await dispatchNotification(payload);
  //     channel.ack(msg);
  //   } catch (err) {
  //     logger.error({ err }, 'Failed to process notification message');
  //     channel.nack(msg, false, true);
  //   }
  // });

  logger.info({ queue: QUEUE_NAME }, 'RabbitMQ consumer ready (stub mode - not connected)');
}

interface NotificationPayload {
  tenantId: string;
  channel: 'email' | 'sms' | 'whatsapp' | 'push';
  recipient: string;
  templateId?: string;
  subject?: string;
  body?: string;
  data?: Record<string, unknown>;
}

async function dispatchNotification(payload: NotificationPayload): Promise<void> {
  logger.info({ channel: payload.channel, recipient: payload.recipient }, 'Dispatching notification');

  switch (payload.channel) {
    case 'email':
      // await emailProvider.send({ ... });
      break;
    case 'sms':
      // await smsProvider.send({ ... });
      break;
    case 'whatsapp':
      // await whatsappProvider.send({ ... });
      break;
    case 'push':
      // await pushProvider.send({ ... });
      break;
    default:
      logger.warn({ channel: payload.channel }, 'Unknown notification channel');
  }
}
