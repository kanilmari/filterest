#!/bin/bash
# ==============================================================================
# 01_init_extensions.sh: Initialize PostgreSQL extensions for Easelect
# This script runs automatically when the database container starts
# ==============================================================================

set -e

echo "Initializing PostgreSQL extensions for Easelect..."

# Create vector extension (pgvector)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Enable pgvector extension for AI embeddings
    CREATE EXTENSION IF NOT EXISTS vector;
    
    -- Enable PostGIS if available (optional, for geospatial features)
    DO \$\$
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
            EXECUTE 'CREATE SCHEMA IF NOT EXISTS postgis';
            EXECUTE 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis';
            RAISE NOTICE 'PostGIS extension enabled';
        ELSE
            RAISE NOTICE 'PostGIS not available, skipping...';
        END IF;
    END
    \$\$;
    
    -- Enable uuid-ossp for UUID generation
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    
    -- Enable pg_trgm for trigram similarity searches
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    
    -- Verify extensions
    SELECT extname, extversion FROM pg_extension ORDER BY extname;
EOSQL

echo "PostgreSQL extensions initialized successfully!"
