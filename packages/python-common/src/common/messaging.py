import json
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

import aio_pika
from aio_pika import ExchangeType

from .logger import get_logger

logger = get_logger("messaging")

EXCHANGE_NAME = "voice_agent_events"


class RabbitMQClient:
    def __init__(self):
        self.connection = None
        self.channel = None
        self.exchange = None

    async def connect(self, url: str):
        self.connection = await aio_pika.connect_robust(url)
        self.channel = await self.connection.channel()
        self.exchange = await self.channel.declare_exchange(
            EXCHANGE_NAME, ExchangeType.TOPIC, durable=True
        )
        logger.info("RabbitMQ connected")

    async def publish(self, routing_key: str, data: Any):
        if not self.exchange:
            raise RuntimeError("RabbitMQ not connected")
        message = aio_pika.Message(
            body=json.dumps(data).encode(),
            content_type="application/json",
        )
        await self.exchange.publish(message, routing_key=routing_key)

    async def subscribe(
        self,
        queue_name: str,
        routing_key: str,
        handler: Callable[[Any], Awaitable[None]],
    ):
        if not self.channel or not self.exchange:
            raise RuntimeError("RabbitMQ not connected")
        queue = await self.channel.declare_queue(queue_name, durable=True)
        await queue.bind(self.exchange, routing_key=routing_key)

        async def on_message(message: aio_pika.IncomingMessage):
            async with message.process():
                data = json.loads(message.body.decode())
                await handler(data)

        await queue.consume(on_message)
        logger.info("subscribed", queue=queue_name, routing_key=routing_key)

    async def close(self):
        if self.connection:
            await self.connection.close()


class EventBus:
    def __init__(self, mq: RabbitMQClient):
        self.mq = mq

    async def emit(self, routing_key: str, data: Any):
        await self.mq.publish(routing_key, {
            "event": routing_key,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        })

    async def on(
        self,
        queue_name: str,
        routing_key: str,
        handler: Callable[[Any], Awaitable[None]],
    ):
        await self.mq.subscribe(queue_name, routing_key, handler)
