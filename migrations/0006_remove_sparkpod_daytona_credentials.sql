-- Daytona credentials are runtime-only Cloudflare Production Secrets.
-- Remove the legacy table and any credential material it may contain.
DROP TABLE IF EXISTS sparkpod_daytona_credentials;
