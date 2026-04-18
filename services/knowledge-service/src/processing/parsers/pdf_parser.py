import io

from common import get_logger

logger = get_logger("pdf-parser")


async def parse_pdf(content: bytes) -> str:
    """Extract text from a PDF file using PyPDF2.

    Processes each page and joins them with double newlines.
    Handles common PDF extraction issues like missing text layers.
    """
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        logger.error("pypdf2_not_installed")
        raise ImportError("PDF parsing requires PyPDF2: pip install PyPDF2")

    logger.info("parsing_pdf", size=len(content))

    reader = PdfReader(io.BytesIO(content))
    pages: list[str] = []

    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text()
            if text:
                pages.append(text.strip())
        except Exception as e:
            logger.warning("page_extraction_failed", page=i, error=str(e))
            continue

    full_text = "\n\n".join(pages)
    logger.info("pdf_parsed", pages=len(reader.pages), text_length=len(full_text))

    return full_text
