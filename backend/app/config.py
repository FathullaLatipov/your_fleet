from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/yourfleet_dev"
    jwt_secret: str = "dev-only-insecure-secret"
    jwt_expires_minutes: int = 1440
    cors_origins: str = "http://localhost:3000"
    environment: str = "development"
    media_dir: str = "media"
    google_places_api_key: str = ""
    resend_api_key: str = ""
    email_from: str = "YourFleet <onboarding@resend.dev>"
    frontend_url: str = "https://your-fleet.vercel.app"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
