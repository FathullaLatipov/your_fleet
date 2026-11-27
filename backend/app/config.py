from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/yourfleet_dev"
    jwt_secret: str = "dev-only-insecure-secret"
    jwt_expires_minutes: int = 1440
    # Key for encrypting stored integration tokens (Samsara, …). Falls back to
    # jwt_secret when unset; set a dedicated value in production.
    integrations_secret: str = ""
    cors_origins: str = "http://localhost:3000"
    environment: str = "development"
    media_dir: str = "media"
    google_places_api_key: str = ""
    resend_api_key: str = ""
    email_from: str = "YourFleet <onboarding@resend.dev>"
    # SMTP sender (e.g. a Gmail address with an app password) — used instead
    # of Resend when configured. Fine for small installs.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    frontend_url: str = "https://your-fleet.vercel.app"
    # Shared Telegram bot for driver PTI (one bot for all carriers; drivers
    # link with a per-company code). Create it in @BotFather.
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""  # without @, for deep links (t.me/<username>)
    # Gemini vision for suggesting defects from inspection photos (optional).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
