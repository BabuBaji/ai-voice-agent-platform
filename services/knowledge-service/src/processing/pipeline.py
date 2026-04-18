from common import get_logger
from .chunker import RecursiveChunker
from .embedder import Embedder
from ..storage.s3_client import S3Client
from ..storage.vector_store import VectorStore
from ..config import settings

logger = get_logger("processing-pipeline")


class ProcessingPipeline:
    """Orchestrates: upload -> parse -> chunk -> embed -> store."""

    def __init__(self):
        self.chunker = RecursiveChunker(
            target_tokens=settings.chunk_size_tokens,
            overlap_tokens=settings.chunk_overlap_tokens,
        )
        self.embedder = Embedder()
        self.s3 = S3Client()
        self.vector_store = VectorStore()

    async def process_document(
        self,
        document_id: str,
        filename: str,
        content: bytes,
        knowledge_base_id: str,
    ) -> dict:
        """Process a document through the full pipeline.

        1. Store raw file in S3
        2. Parse file to text
        3. Chunk text
        4. Generate embeddings
        5. Store chunks + embeddings in vector store
        """
        logger.info("processing_start", document_id=document_id, filename=filename)

        # 1. Store raw file
        s3_key = f"documents/{knowledge_base_id}/{document_id}/{filename}"
        await self.s3.upload(s3_key, content)

        # 2. Parse file to text
        text = await self._parse(filename, content)

        # 3. Chunk
        chunks = self.chunker.chunk(text)
        logger.info("chunking_complete", document_id=document_id, chunk_count=len(chunks))

        # 4. Embed
        chunk_texts = [c["content"] for c in chunks]
        embeddings = await self.embedder.embed(chunk_texts)

        # 5. Store in vector store
        await self.vector_store.insert_chunks(
            document_id=document_id,
            knowledge_base_id=knowledge_base_id,
            chunks=chunks,
            embeddings=embeddings,
        )

        logger.info("processing_complete", document_id=document_id, chunk_count=len(chunks))
        return {"document_id": document_id, "chunk_count": len(chunks), "status": "completed"}

    async def _parse(self, filename: str, content: bytes) -> str:
        """Route to appropriate parser based on file extension."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext == "pdf":
            from .parsers.pdf_parser import parse_pdf
            return await parse_pdf(content)
        elif ext == "docx":
            from .parsers.docx_parser import parse_docx
            return await parse_docx(content)
        elif ext in ("txt", "md", "csv"):
            from .parsers.txt_parser import parse_txt
            return await parse_txt(content)
        else:
            # Fallback: try as plain text
            from .parsers.txt_parser import parse_txt
            return await parse_txt(content)
