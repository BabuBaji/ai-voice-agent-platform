import { RabbitMQClient } from './rabbitmq.client';

const EXCHANGE = 'voice_agent_events';

export class EventBus {
  constructor(private mq: RabbitMQClient) {}

  async emit(routingKey: string, data: unknown): Promise<void> {
    this.mq.publish(EXCHANGE, routingKey, {
      event: routingKey,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  async on(
    queue: string,
    routingKey: string,
    handler: (data: unknown) => Promise<void>,
  ): Promise<void> {
    await this.mq.subscribe(EXCHANGE, queue, routingKey, handler);
  }
}
