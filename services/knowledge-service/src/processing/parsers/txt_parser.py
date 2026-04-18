async def parse_txt(content: bytes) -> str:
    """Parse plain text content."""
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode("latin-1")
