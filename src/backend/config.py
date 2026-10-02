from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    database_url: str | None = None
    postgres_db: str = "methane_tracker"
    postgres_user: str = "methane_app"
    postgres_password: str = "methane_dev_password"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def async_database_url(self) -> str | URL:
        if self.database_url:
            if self.database_url.startswith("postgresql://"):
                return self.database_url.replace(
                    "postgresql://", "postgresql+asyncpg://", 1
                )
            return self.database_url

        return URL.create(
            drivername="postgresql+asyncpg",
            username=self.postgres_user,
            password=self.postgres_password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

