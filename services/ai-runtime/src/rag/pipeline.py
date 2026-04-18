from ..models import RAGQueryResponse, RAGChunk
from .retriever import VectorRetriever
from .context_builder import ContextBuilder


class RAGPipeline:
    """Orchestrates retrieval-augmented generation: retrieve chunks then build context."""

    def __init__(self):
        self.retriever = VectorRetriever()
        self.context_builder = ContextBuilder()

    async def query(
        self,
        query: str,
        knowledge_base_ids: list[str],
        top_k: int = 5,
    ) -> RAGQueryResponse:
        raw_chunks = await self.retriever.search(
            query=query,
            knowledge_base_ids=knowledge_base_ids,
            top_k=top_k,
        )

        chunks = [
            RAGChunk(
                content=c["content"],
                source=c["source"],
                score=c["score"],
                metadata=c.get("metadata", {}),
            )
            for c in raw_chunks
        ]

        return RAGQueryResponse(chunks=chunks, query=query)

    async def build_context(self, query: str, knowledge_base_ids: list[str], top_k: int = 5) -> str:
        response = await self.query(query, knowledge_base_ids, top_k)
        return self.context_builder.build(response.chunks)
