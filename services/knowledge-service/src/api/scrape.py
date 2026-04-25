import asyncio
from collections import deque
from datetime import datetime, timezone
from typing import Set
from urllib.parse import urljoin, urlparse
from uuid import uuid4

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, HttpUrl

from common import get_db_pool, get_logger
from ..processing.pipeline import ProcessingPipeline
from ..config import settings

router = APIRouter()
logger = get_logger("scrape-api")
pipeline = ProcessingPipeline()


class ScrapeRequest(BaseModel):
    knowledge_base_id: str
    url: HttpUrl
    max_pages: int = Field(10, ge=1, le=50, description="Max pages to crawl from the root (1 = just that page)")
    same_domain_only: bool = Field(True, description="Only follow links on the same host")


class ScrapedPage(BaseModel):
    url: str
    title: str
    status: str  # "queued", "fetch_failed"
    document_id: str | None = None
    bytes: int = 0
    error: str | None = None


class ScrapeResponse(BaseModel):
    knowledge_base_id: str
    root_url: str
    pages: list[ScrapedPage]
    total_pages: int
    total_bytes: int


HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; VoiceAgentKB/1.0; +https://voiceagent.local/kb-bot)"
}
STRIP_TAGS = ["script", "style", "noscript", "iframe", "svg", "nav", "footer", "header", "aside", "form"]


def _extract_clean_text(html: str) -> tuple[str, str]:
    """Return (title, clean_text). Strips nav/footer/scripts, collapses whitespace."""
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string.strip() if soup.title and soup.title.string else "").strip()

    for tag in soup(STRIP_TAGS):
        tag.decompose()

    # Prefer <main> / <article> if present (content-focused)
    content_root = soup.find("main") or soup.find("article") or soup.body or soup

    text = content_root.get_text(separator="\n", strip=True)
    # Collapse runs of blank lines
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    clean = "\n".join(lines)
    return title, clean


def _extract_links(html: str, base_url: str, same_domain_only: bool) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    base_host = urlparse(base_url).netloc
    links: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:") or href.startswith("javascript:"):
            continue
        abs_url = urljoin(base_url, href)
        # Strip fragments
        abs_url = abs_url.split("#")[0]
        parsed = urlparse(abs_url)
        if parsed.scheme not in ("http", "https"):
            continue
        if same_domain_only and parsed.netloc != base_host:
            continue
        # Skip common junk file types
        if parsed.path.lower().endswith((".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".mp4", ".mp3", ".css", ".js")):
            continue
        links.append(abs_url)
    return links


async def _ingest_page(
    knowledge_base_id: str, url: str, title: str, text: str
) -> str:
    """Create a documents row and fire the processing pipeline for scraped text."""
    document_id = str(uuid4())
    filename = f"{title or urlparse(url).path or 'page'}.txt"
    # Keep filename manageable
    filename = filename[:200].replace("\n", " ").replace("\r", " ")
    content = text.encode("utf-8")
    now = datetime.now(timezone.utc)

    pool = await get_db_pool(settings.database_url)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO documents (id, filename, knowledge_base_id, status, chunk_count, file_size, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            document_id,
            filename,
            knowledge_base_id,
            "pending",
            0,
            len(content),
            now,
            now,
        )

    asyncio.create_task(
        pipeline.process_document(
            document_id=document_id,
            filename=filename,
            content=content,
            knowledge_base_id=knowledge_base_id,
        )
    )
    return document_id


@router.post("/scrape", response_model=ScrapeResponse)
async def scrape_website(req: ScrapeRequest) -> ScrapeResponse:
    """Crawl a website and ingest each page's text into the knowledge base.

    - Starts from `url`, BFS up to `max_pages`
    - Only follows same-domain links if `same_domain_only`
    - Strips nav/footer/scripts; keeps main/article text
    - Each page becomes a `documents` row and is chunked+embedded via the standard pipeline
    """
    root = str(req.url)
    queue: deque[str] = deque([root])
    visited: Set[str] = set()
    pages: list[ScrapedPage] = []
    total_bytes = 0

    async with httpx.AsyncClient(
        headers=HEADERS, timeout=15.0, follow_redirects=True
    ) as client:
        while queue and len(pages) < req.max_pages:
            current = queue.popleft()
            if current in visited:
                continue
            visited.add(current)

            try:
                r = await client.get(current)
                if r.status_code >= 400:
                    pages.append(ScrapedPage(url=current, title="", status="fetch_failed", error=f"HTTP {r.status_code}"))
                    continue
                html = r.text
            except Exception as e:
                pages.append(ScrapedPage(url=current, title="", status="fetch_failed", error=str(e)[:200]))
                continue

            title, text = _extract_clean_text(html)
            if not text or len(text) < 100:
                pages.append(
                    ScrapedPage(url=current, title=title, status="fetch_failed", error="Empty or too-short page")
                )
                continue

            # Attach the URL at the top of the document body so retrieval can cite it
            body_with_src = f"Source URL: {current}\nTitle: {title}\n\n{text}"

            try:
                doc_id = await _ingest_page(req.knowledge_base_id, current, title, body_with_src)
                size = len(body_with_src.encode("utf-8"))
                total_bytes += size
                pages.append(
                    ScrapedPage(
                        url=current, title=title, status="queued", document_id=doc_id, bytes=size
                    )
                )
                logger.info("scrape_page_queued", url=current, doc_id=doc_id, bytes=size)
            except Exception as e:
                pages.append(ScrapedPage(url=current, title=title, status="fetch_failed", error=f"ingest error: {e}"))
                continue

            # Enqueue further links for BFS
            if len(pages) < req.max_pages:
                for link in _extract_links(html, current, req.same_domain_only):
                    if link not in visited and link not in queue:
                        queue.append(link)

    return ScrapeResponse(
        knowledge_base_id=req.knowledge_base_id,
        root_url=root,
        pages=pages,
        total_pages=sum(1 for p in pages if p.status == "queued"),
        total_bytes=total_bytes,
    )
