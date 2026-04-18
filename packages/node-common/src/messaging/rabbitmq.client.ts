import amqplib from 'amqplib';
import { logger } from '../utils/logger';

export interface RabbitMQClient {
  connection: Awaited<ReturnType<typeof amqplib.connect>>;
  channel: Awaited<ReturnType<Awaited<ReturnType<typeof amqplib.connect>>['createChannel']>>;
  publish(exchange: string, routingKey: string, data: unknown): void;
  subscribe(
    exchange: string,
    queue: string,
    routingKey: string,
    handler: (data: unknown) => Promise<void>,
  ): Promise<void>;
  close(): Promise<void>;
}

const EXCHANGE = 'voice_agent_events';

export async function createRabbitMQClient(url: string): Promise<RabbitMQClient> {
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  logger.info('RabbitMQ connected');

  connection.on('error', (err) => {
    logger.error({ err }, 'RabbitMQ connection error');
  });

  return {
    connection,
    channel,

    publish(exchange: string, routingKey: string, data: unknown) {
      const message = Buffer.from(JSON.stringify(data));
      channel.publish(exchange, routingKey, message, { persistent: true });
      logger.debug({ exchange, routingKey }, 'Message published');
    },

    async subscribe(exchange, queue, routingKey, handler) {
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);

      channel.consume(queue, async (msg) => {
        if (!msg) return;
        try {
          const data = JSON.parse(msg.content.toString());
          await handler(data);
          channel.ack(msg);
        } catch (err) {
          logger.error({ err, queue, routingKey }, 'Message processing failed');
          channel.nack(msg, false, false);
        }
      });

      logger.info({ queue, routingKey }, 'Subscribed to queue');
    },

    async close() {
      await channel.close();
      await connection.close();
    },
  };
}
