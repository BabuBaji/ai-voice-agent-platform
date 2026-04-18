#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE identity_db;
    CREATE DATABASE agent_db;
    CREATE DATABASE conversation_db;
    CREATE DATABASE crm_db;
    CREATE DATABASE knowledge_db;
    CREATE DATABASE analytics_db;
    CREATE DATABASE workflow_db;
    CREATE DATABASE notification_db;

    \c knowledge_db
    CREATE EXTENSION IF NOT EXISTS vector;

    \c conversation_db
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
