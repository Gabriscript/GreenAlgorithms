from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from src.backend.config import get_settings


settings = get_settings()

engine = create_async_engine(
    settings.async_database_url,
    pool_pre_ping=True,
)


async def get_connection() -> AsyncIterator[AsyncConnection]:
    async with engine.connect() as connection:
        yield connection

