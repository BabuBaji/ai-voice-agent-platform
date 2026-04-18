from ..models import RAGChunk


class ContextBuilder:
    """Builds LLM context from retrieved document chunks."""

    def build(self, chunks: list[RAGChunk]) -> str:
        if not chunks:
            return ""

        sections = []
        for i, chunk in enumerate(chunks, 1):
            sections.append(
                f"[Source {i}: {chunk.source} (relevance: {chunk.score:.2f})]\n{chunk.content}"
            )

        context = (
            "Use the following context to answer the user's question. "
            "If the context does not contain relevant information, say so.\n\n"
            + "\n\n".join(sections)
        )
        return context
