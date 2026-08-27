-- Explicit PostGIS bootstrap for the containerized database.
-- The postgis/postgis image also auto-enables PostGIS on POSTGRES_DB,
-- this file makes the dependency explicit for the compose stack.
CREATE EXTENSION IF NOT EXISTS postgis;
