import asyncio

from common import get_logger, get_db_pool
from .chunker import RecursiveChunker
from .embedder import Embedder
from ..storage.s3_client import S3Client
from ..storage.vector_store import VectorStore
from ..config import settings

logger = get_logger("processing-pipeline")


class ProcessingPipeline:
    """Orchestrates: upload -> parse -> chunk -> embed -> store.

    Handles the full document processing lifecycle with proper
    status tracking in the database.
    """

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

        1. Update status to 'processing'
        2. Store raw file in S3
        3. Parse file to text
        4. Chunk text
        5. Generate embeddings
        6. Store chunks + embeddings in vector store
        7. Update status to 'completed' (or 'failed')
        """
        logger.info("processing_start", document_id=document_id, filename=filename)

        try:
            # Update status to processing
            await self._update_document_status(document_id, "processing")

            # 1. Store raw file in S3
            s3_key = f"documents/{knowledge_base_id}/{document_id}/{filename}"
            await self.s3.upload(s3_key, content, content_type=self._get_content_type(filename))

            # 2. Parse file to text
            text = await self._parse(filename, content)
            if not text.strip():
                logger.warning("empty_document", document_id=document_id)
                await self._update_document_status(document_id, "completed", chunk_count=0)
                return {"document_id": document_id, "chunk_count": 0, "status": "completed"}

            # 3. Chunk
            chunks = self.chunker.chunk(text)
            logger.info("chunking_complete", document_id=document_id, chunk_count=len(chunks))

            if not chunks:
                await self._update_document_status(document_id, "completed", chunk_count=0)
                return {"document_id": document_id, "chunk_count": 0, "status": "completed"}

            # 4. Embed (best-effort — if the embeddings provider is down or out
            # of quota we still want the file to be viewable / downloadable in
            # the UI. We mark the doc `completed` with an error_message noting
            # that semantic search will be unavailable until embeddings are
            # backfilled.)
            chunk_texts = [c["content"] for c in chunks]
            try:
                embeddings = await self.embedder.embed(chunk_texts)
            except Exception as embed_err:
                logger.warning(
                    "embedding_failed_keeping_file",
                    document_id=document_id,
                    error=str(embed_err),
                )
                await self._update_document_status(
                    document_id,
                    "completed",
                    chunk_count=len(chunks),
                    error=f"Embeddings unavailable: {str(embed_err)[:200]}. File is stored and viewable; semantic search disabled.",
                )
                return {
                    "document_id": document_id,
                    "chunk_count": len(chunks),
                    "status": "completed",
                    "embedding_skipped": True,
                    "error": str(embed_err),
                }

            # 5. Store in vector store
            try:
                await self.vector_store.insert_chunks(
                    document_id=document_id,
                    knowledge_base_id=knowledge_base_id,
                    chunks=chunks,
                    embeddings=embeddings,
                )
            except Exception as store_err:
                logger.warning("vector_store_failed", document_id=document_id, error=str(store_err))
                await self._update_document_status(
                    document_id,
                    "completed",
                    chunk_count=len(chunks),
                    error=f"Vector store unavailable: {str(store_err)[:200]}. File is stored; semantic search disabled.",
                )
                return {"document_id": document_id, "chunk_count": len(chunks), "status": "completed"}

            # 6. Update status
            await self._update_document_status(document_id, "completed", chunk_count=len(chunks))

            logger.info("processing_complete", document_id=document_id, chunk_count=len(chunks))
            return {"document_id": document_id, "chunk_count": len(chunks), "status": "completed"}

        except Exception as e:
            # Hard failure (parsing crashed or S3 upload failed). The file may
            # not be retrievable so we honestly mark it failed.
            logger.error("processing_failed", document_id=document_id, error=str(e))
            await self._update_document_status(document_id, "failed", error=str(e))
            return {"document_id": document_id, "chunk_count": 0, "status": "failed", "error": str(e)}

    async def _parse(self, filename: str, content: bytes) -> str:
        """Route to appropriate parser based on file extension."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext == "pdf":
            from .parsers.pdf_parser import parse_pdf
            return await parse_pdf(content)
        elif ext == "docx":
            from .parsers.docx_parser import parse_docx
            return await parse_docx(content)
        elif ext in ("txt", "md", "csv", "json", "yaml", "yml"):
            from .parsers.txt_parser import parse_txt
            return await parse_txt(content)
        else:
            from .parsers.txt_parser import parse_txt
            return await parse_txt(content)

    async def _update_document_status(
        self,
        document_id: str,
        status: str,
        chunk_count: int = 0,
        error: str = "",
    ):
        """Update document status in the database."""
        try:
            pool = await get_db_pool(settings.database_url)
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE documents
                    SET status = $1, chunk_count = $2, error_message = $3,
                        updated_at = NOW()
                    WHERE id = $4
                    """,
                    status,
                    chunk_count,
                    error,
                    document_id,
                )
        except Exception as e:
            logger.warning("status_update_failed", document_id=document_id, error=str(e))

    @staticmethod
    def _get_content_type(filename: str) -> str:
        """Determine content type from filename."""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        content_types = {
            "pdf": "application/pdf",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "txt": "text/plain",
            "md": "text/markdown",
            "csv": "text/csv",
            "json": "application/json",
        }
        return content_types.get(ext, "application/octet-stream")
