import asyncpg
from typing import Optional

_pool: Optional[asyncpg.Pool] = None


async def get_db_pool(database_url: str, min_size: int = 5, max_size: int = 20) -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            database_url,
            min_size=min_size,
            max_size=max_size,
        )
    return _pool


async def close_db_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
