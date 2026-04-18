from pydantic import BaseModel, Field
from typing import Optional


class Message(BaseModel):
    role: str
    content: str


class ChatContext(BaseModel):
    agent_config: dict = Field(default_factory=dict)
    knowledge_base_ids: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class ChatCompletionRequest(BaseModel):
    agent_id: str
    conversation_id: str
    messages: list[Message]
    context: ChatContext = Field(default_factory=ChatContext)


class ToolExecuteRequest(BaseModel):
    tool_name: str
    parameters: dict = Field(default_factory=dict)
    conversation_id: str


class ToolExecuteResponse(BaseModel):
    tool_name: str
    result: dict
    success: bool
    error: Optional[str] = None


class RAGQueryRequest(BaseModel):
    query: str
    knowledge_base_ids: list[str] = Field(default_factory=list)
    top_k: int = 5


class RAGChunk(BaseModel):
    content: str
    source: str
    score: float
    metadata: dict = Field(default_factory=dict)


class RAGQueryResponse(BaseModel):
    chunks: list[RAGChunk]
    query: str
