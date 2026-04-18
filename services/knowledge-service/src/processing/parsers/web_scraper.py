import httpx


async def scrape_url(url: str) -> str:
    """Scrape text content from a web page.

    Stub implementation - TODO: use BeautifulSoup or similar for proper HTML parsing.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(url, follow_redirects=True, timeout=30)
        response.raise_for_status()
        # Naive: return raw text (should strip HTML tags)
        return response.text
