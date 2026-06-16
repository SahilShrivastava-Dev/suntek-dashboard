"""Service configuration, loaded from environment / .env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str = ""
    supabase_service_key: str = ""

    analytics_demo_mode: bool = True
    scan_interval_seconds: int = 600

    # Decision values (doc §8) — defaults are indicative, tune per Suntek.
    min_margin_pct: float = 10.0
    offspec_tolerance_pct: float = 3.0
    recon_noise_pct: float = 4.0
    throughput_sigma: float = 2.5

    whatsapp_api_url: str = ""
    whatsapp_api_token: str = ""
    alert_email_webhook: str = ""

    @property
    def supabase_ready(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)


settings = Settings()
