import amqplib from 'amqplib';
import { config } from '../config';
import { dispatchNotification } from '../routes/notifications';
import pino from 'pino';

const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

const EXCHANGE_NAME = 'voice_agent_events';
const QUEUE_NAME = 'notification.send';
const ROUTING_KEY = 'notification.send';

let connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
let channel: Awaited<ReturnType<Awaited<ReturnType<typeof amqplib.connect>>['createChannel']>> | null = null;

export async function startConsumer(): Promise<void> {
  try {
    connection = await amqplib.connect(config.rabbitmqUrl);
    channel = await connection.createChannel();

    // Declare exchange
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    // Declare queue
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // Bind queue
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
    // Also listen for specific notification types
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'notification.*');

    // Prefetch 5 messages for throughput
    await channel.prefetch(5);

    // Start consuming
    await channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      try {
        const payload = JSON.parse(msg.content.toString());
        const data = payload.data || payload;

        logger.info(
          { type: data.type || data.channel, recipient: data.recipient },
          'Received notification event'
        );

        const tenantId = data.tenantId || data.tenant_id || '';
        const type = data.type || data.channel || 'email';
        const recipient = data.recipient || '';
        const subject = data.subject || '';
        const body = data.body || '';
        const metadata = data.metadata || {};

        if (!tenantId || !recipient) {
          logger.warn({ payload: data }, 'Notification event missing tenantId or recipient');
          channel!.ack(msg);
          return;
        }

        await dispatchNotification(tenantId, type, recipient, subject, body, metadata);
        logger.info({ type, recipient }, 'Notification dispatched successfully');
        channel!.ack(msg);
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to process notification message');

        if (msg.fields.redelivered) {
          // Already retried once, dead-letter it
          channel!.nack(msg, false, false);
        } else {
          // Requeue for one retry
          channel!.nack(msg, false, true);
        }
      }
    });

    logger.info({ queue: QUEUE_NAME }, 'Notification consumer started');

    // Reconnect on close
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, reconnecting in 5s...');
      setTimeout(() => startConsumer().catch(() => {}), 5000);
    });

    connection.on('error', (err) => {
      logger.error({ error: err.message }, 'RabbitMQ connection error');
    });
  } catch (err: any) {
    logger.error({ error: err.message }, 'Failed to start notification consumer');
    throw err;
  }
}

export async function stopConsumer(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('Notification consumer stopped');
  } catch (err: any) {
    logger.error({ error: err.message }, 'Error stopping consumer');
  }
}
