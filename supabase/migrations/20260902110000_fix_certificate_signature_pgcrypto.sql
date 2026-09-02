-- Fix: POST /v1/certificates has failed unconditionally since 2026-08-21
-- with "PostgresError: function digest(text, unknown) does not exist"
-- (confirmed via Sentry, LEARNINGCOACHBACKEND-E) — root-caused to
-- certificates_set_code() (20260705155924_...sql), a BEFORE INSERT trigger
-- that computes `signature` via pgcrypto's digest(). No migration in this
-- project ever ran `CREATE EXTENSION pgcrypto` — this app used to run on
-- Supabase, which pre-installs pgcrypto into an `extensions` schema on every
-- project, but this backend has since moved to a self-hosted Postgres VPS
-- (see 20260706000001_own_auth_users.sql) with no such default. The trigger
-- still worked for gen_random_bytes()/verification_code because that call
-- happens to also be reachable here; digest() is not, under this function's
-- own `SET search_path = public`.
--
-- Both parts below are independently idempotent and address the two ways
-- this can be missing: the extension not existing anywhere yet, or existing
-- in a schema (conventionally `extensions`) this function's pinned
-- search_path doesn't look at.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER FUNCTION public.certificates_set_code() SET search_path = public, extensions;
