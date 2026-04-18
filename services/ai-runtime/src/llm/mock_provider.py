import asyncio
import random
from typing import Any, AsyncGenerator, Optional

from .base import LLMProvider
from common import get_logger

logger = get_logger("mock-provider")

# Contextual responses based on keywords in the conversation
RESPONSE_MAP = {
    "hello": "Hello! Thank you for reaching out. I'm your AI assistant. How can I help you today?",
    "hi": "Hi there! Welcome. What can I assist you with today?",
    "pricing": "Great question! We have three plans: Starter at $29/month for small teams, Professional at $99/month with advanced features, and Enterprise with custom pricing. Which one interests you?",
    "price": "Our pricing starts at $29/month for the Starter plan. For teams, we recommend our Professional plan at $99/month. Would you like me to go into more detail?",
    "demo": "I'd love to schedule a demo for you! We have availability this week. Could you share your preferred day and time? Our demos typically run 30 minutes.",
    "schedule": "Absolutely! Let me help you schedule that. What day works best for you? We have openings on Wednesday at 2 PM and Thursday at 10 AM.",
    "appointment": "I can book that appointment for you right away. Could you please provide your preferred date and time?",
    "book": "Sure! I'll get that booked for you. What date and time work best?",
    "interested": "That's wonderful to hear! Let me tell you more about how we can help your business. What specific challenges are you looking to solve?",
    "product": "Our platform is an AI-powered voice agent system that can handle inbound and outbound calls, qualify leads, book appointments, and integrate with your CRM — all automatically. What aspect interests you most?",
    "feature": "Key features include: AI voice agents with 1000+ voices in 90+ languages, CRM integration, automated lead qualification, appointment booking, real-time analytics, and workflow automation. What would you like to know more about?",
    "company": "Could you tell me a bit about your company? What industry are you in, and how large is your team? This will help me recommend the right solution.",
    "team": "That's a great team size! Our Professional plan would be perfect for you. It supports up to 10 agents with unlimited calls. Shall I set up a trial?",
    "trial": "Absolutely! I can set up a free 14-day trial for you right now. All I need is your name, email, and company name. Would you like to proceed?",
    "email": "Thank you! I've noted your email. You'll receive a welcome message with your login credentials and a getting-started guide shortly.",
    "name": "Nice to meet you! Let me pull up the best options for you based on your needs.",
    "help": "Of course! I'm here to help. You can ask me about our products, pricing, scheduling a demo, or anything else. What would you like to know?",
    "thank": "You're very welcome! Is there anything else I can help you with today?",
    "bye": "Thank you for your time! It was great speaking with you. Don't hesitate to reach out if you need anything. Have a wonderful day!",
    "support": "For support, we offer 24/7 email support on all plans, priority chat support on Professional, and dedicated account managers on Enterprise. How can I help you today?",
    "integrate": "We integrate with popular CRMs like Salesforce, HubSpot, and Zoho, plus calendar tools like Google Calendar and Cal.com. We also support Zapier and Make for custom workflows. Which integrations matter most to you?",
    "call": "Our AI agents can handle both inbound and outbound calls. They use natural-sounding voices and can qualify leads, answer FAQs, and even transfer to a human agent when needed. Want to see it in action?",
    "how": "Here's how it works: You create an AI agent with a system prompt, assign it a phone number, and it starts handling calls automatically. The agent uses your knowledge base to answer questions accurately. Would you like a walkthrough?",
}

FALLBACK_RESPONSES = [
    "That's a great point! Let me provide you with more details on that. Our platform is designed to handle exactly these kinds of use cases. Would you like me to explain how?",
    "I understand. Based on what you've shared, I think our solution would be a great fit. Let me walk you through the key benefits that would apply to your situation.",
    "Excellent question! Many of our clients have asked the same thing. The short answer is yes, we can absolutely help with that. Would you like to discuss the specifics?",
    "Thank you for sharing that. I want to make sure I recommend the right solution for you. Could you tell me a bit more about your current setup and what challenges you're facing?",
    "That makes sense. Based on your needs, I'd recommend starting with our Professional plan which includes everything you've mentioned. Shall I set up a quick demo to show you how it all works together?",
]


class MockProvider(LLMProvider):
    """Mock LLM provider for testing without API keys.
    Returns contextually relevant responses based on keyword matching.
    """

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "mock-v1",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        logger.info("mock_chat_start", model=model, message_count=len(messages))

        # Get the last user message
        user_message = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content", "").lower()
                break

        # Find best matching response
        response = None
        for keyword, reply in RESPONSE_MAP.items():
            if keyword in user_message:
                response = reply
                break

        if not response:
            response = random.choice(FALLBACK_RESPONSES)

        # Simulate streaming delay (word by word)
        words = response.split()
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield {"type": "content", "content": chunk}
            await asyncio.sleep(0.03)  # 30ms per word ≈ natural typing speed

        yield {"type": "finish", "finish_reason": "stop"}
        logger.info("mock_chat_end", model=model)
