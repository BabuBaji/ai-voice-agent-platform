import io


async def parse_pdf(content: bytes) -> str:
    """Extract text from a PDF file using PyPDF2."""
    # TODO: implement with PyPDF2
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages)
    except ImportError:
        return "[PDF parsing requires PyPDF2]"
