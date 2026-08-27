#!/usr/bin/env bash
# Postgres local que EMULA lo que packages/db necesita de Supabase para poder
# correr migraciones y el test de RLS cruzado sin B2 (proyecto Supabase) ni Docker.
#
# Emula SOLO tres cosas, y son las tres de las que dependen las policies:
#   1. los roles  anon / authenticated / service_role
#   2. el schema  auth  con  auth.jwt() / auth.uid() / auth.role()
#   3. la convencion de claims:  set_config('request.jwt.claims', '<json>', true)
#
# NO emula: GoTrue, Storage, Realtime, el Custom Access Token Hook, ni pgvector.
# La paridad que importa (RLS) es exacta porque auth.jwt() aca tiene el mismo
# cuerpo que en Supabase: lee current_setting('request.jwt.claims').
set -euo pipefail

DB="${ISTOCK_DB:-istock_dev}"
PSQL=(psql -v ON_ERROR_STOP=1 -q)

if [ "${1:-}" = "--drop" ]; then
  "${PSQL[@]}" -d postgres -c "drop database if exists ${DB} with (force);"
  echo "dropped ${DB}"
fi

if ! psql -d postgres -tAc "select 1 from pg_database where datname='${DB}'" | grep -q 1; then
  "${PSQL[@]}" -d postgres -c "create database ${DB};"
  echo "created ${DB}"
fi

"${PSQL[@]}" -d "${DB}" <<'SQL'
create extension if not exists pgcrypto;

-- Roles de Supabase. NOLOGIN: se entra por SET ROLE desde el test.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Mismo cuerpo que en Supabase.
create or replace function auth.jwt() returns jsonb
  language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim',  true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$fn$;

create or replace function auth.uid() returns uuid
  language sql stable as $fn$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$fn$;

create or replace function auth.role() returns text
  language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$fn$;

-- auth.users minima: las FK de memberships apuntan aca, igual que en Supabase.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
SQL

echo "OK  ${DB}  (roles anon/authenticated/service_role · auth.jwt/uid/role · auth.users)"
echo "    DATABASE_URL=postgresql://$(whoami)@localhost:5432/${DB}"
echo "    pgvector NO disponible en este Postgres: la migracion de embeddings queda aparte."
