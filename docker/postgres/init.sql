SELECT 'CREATE DATABASE authentik'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authentik')\gexec
