# Social profiles migration

Apply before deploying the API with social/profile routes.

## Option A — Prisma (local / CI)

```bash
DATABASE_URL="your-supabase-direct-url" pnpm db:migrate
```

## Option B — Supabase SQL editor

Run the SQL file:

`packages/db/prisma/migrations/20260531120000_social_profiles/migration.sql`

Then regenerate the client if needed: `pnpm db:generate`

## After migration

1. Redeploy **Render** (`apps/api`) so Prisma client and routes match the schema.
2. Redeploy **Vercel** (`apps/web`) for UI routes.

Existing users receive auto-generated `user_<id-prefix>` usernames. New signups get usernames from email via `generateUniqueUsername`.
