-- Run once in Supabase SQL editor (or via prisma db push on direct connection).
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS timezone_configured BOOLEAN NOT NULL DEFAULT false;
