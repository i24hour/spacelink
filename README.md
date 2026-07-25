# DeadlineAI

**AI memory system for internet opportunities.**

Save any webpage, and DeadlineAI extracts deadlines, scores urgency, and sends smart reminders over **Telegram** and **Email** so you never miss an opportunity again.

---

## Architecture

```
DeadlineAI/
├── apps/
│   ├── api/           # Express + BullMQ + Bedrock (Kimi K2.5) AI pipeline
│   ├── web/           # Next.js 15 SaaS dashboard (shadcn/ui)
│   └── extension/     # Plasmo browser extension (Google Auth + Telegram)
├── packages/
│   ├── db/            # Prisma schema + PostgreSQL client
│   └── shared/        # Shared TypeScript types
```

---

## Stack

- **Dashboard:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion
- **Extension:** Plasmo, React, Google Sign-In, Telegram deep-link connect
- **API:** Node.js, Express, BullMQ, Upstash Redis
- **AI:** Amazon Bedrock Mantle → Moonshot **Kimi K2.5** (`moonshotai.kimi-k2.5`)
- **Scraping:** Firecrawl
- **DB:** PostgreSQL (Supabase)
- **Queue:** Upstash Redis + BullMQ
- **Email:** Resend (branded dark-theme templates)
- **Telegram:** Bot API with webhook + deep-link auth

---

## Quick Start

### 1) Install dependencies

```bash
pnpm install
```

### 2) Configure environment variables

Copy `.env.example` files in each app and fill in your keys:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/extension/.env.example apps/extension/.env
```

### 3) Setup the database

```bash
# Generate Prisma client
pnpm db:generate

# Create and run migrations
pnpm db:migrate
```

### 4) Run dev servers

```bash
# Run everything in parallel (Turbo)
pnpm dev
```

Or individually:

```bash
# API
cd apps/api && pnpm dev

# Dashboard
cd apps/web && pnpm dev

# Extension
cd apps/extension && pnpm dev
```

### 5) Setup Telegram Bot Webhook

After deploying or running the API:

```bash
curl -X POST https://your-api.com/api/webhooks/telegram/setup \
  -H "Authorization: Bearer YOUR_TELEGRAM_WEBHOOK_SECRET"
```

Or set it manually:

```bash
curl -X GET "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-api.com/api/webhooks/telegram"
```

### 6) Load the browser extension

1. Build: `cd apps/extension && pnpm build`
2. Chrome/Edge → Extensions → Developer mode → **Load unpacked**
3. Select `apps/extension/build/chrome-mv3-dev`
4. Click **Sign in with Google** in the popup
5. Click **Connect Telegram** → opens bot → click **Start** → done!

---

## Authentication

DeadlineAI supports **two** auth methods simultaneously:

### Google Sign-In (Primary — Extension + Web)

- Users sign in with Google (OAuth 2.0 implicit flow)
- Backend verifies the Google ID token and issues a DeadlineAI JWT
- JWT is used for all API calls
- Works in both extension and web dashboard

**Setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials (Web application type)
3. Add authorized redirect URIs:
   - `http://localhost:3000/auth` (for local dev)
   - `https://yourdomain.com/auth` (for production)
4. Copy **Client ID** to `.env` files

```bash
# apps/web/.env
NEXT_PUBLIC_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"

# apps/api/.env
GOOGLE_CLIENT_IDS="your-client-id.apps.googleusercontent.com"
JWT_SECRET="a-long-random-secret-string"
```

### Clerk (Secondary — Web Dashboard)

- Still works for the web dashboard if you prefer Clerk
- Our universal auth middleware accepts **both** DeadlineAI JWTs and Clerk JWTs

---

## Telegram Setup

### 1. Create a Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Save the **API Token** and **Bot Username**

### 2. Set Environment Variables

```bash
# apps/api/.env
TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
TELEGRAM_BOT_NAME="DeadlineAIBot"
TELEGRAM_WEBHOOK_URL="https://your-api.com/api/webhooks/telegram"

# apps/web/.env
NEXT_PUBLIC_TELEGRAM_BOT_NAME="DeadlineAIBot"
```

### 3. Set Webhook

```bash
curl -X POST https://your-api.com/api/webhooks/telegram/setup \
  -H "Authorization: Bearer YOUR_TELEGRAM_WEBHOOK_SECRET"
```

### 4. User Flow (Zero Friction)

1. User clicks **Connect Telegram** in the extension or dashboard
2. Backend generates a short-lived token
3. Opens `https://t.me/DeadlineAIBot?start=TOKEN`
4. User clicks **Start** in Telegram
5. Bot automatically links the Telegram Chat ID to their account
6. Done! No manual Chat ID copy-paste needed

### 5. Bot Commands

Users can use these commands in Telegram anytime:

- `/start` — Welcome + account connection
- `/deadlines` — Show all upcoming deadlines
- `/help` — List all commands

---

## Email Setup (Google SMTP)

1. Use any Gmail / Google Workspace account
2. Generate an **App Password** at https://myaccount.google.com/apppasswords
   - Requires 2FA enabled on the Google account
   - Select "Mail" + "Other (Custom name)" → name it "DeadlineAI"
3. Copy the 16-character password → `SMTP_PASS`
4. Set `SMTP_USER` to your Gmail address
5. Set `EMAIL_FROM` (e.g. `DeadlineAI <your-email@gmail.com>`)

No additional user setup needed — emails go to the user's registered email address automatically.

**Test before go-live:**
- Click **Send test email** in Settings
- Branded dark-theme email arrives instantly

---

## AI Extraction Pipeline

When a link is saved:

1. `POST /api/links` creates a `SavedLink` and enqueues a BullMQ job
2. The **link-processor worker** enriches with Firecrawl if needed
3. Page content sent to **Amazon Bedrock (Kimi K2.5)** with JSON-mode prompt
4. Extracted fields stored: deadline, timezone, category, urgency, etc.
5. **Reminder engine** schedules smart reminders based on urgency:
   - **High (≥7):** 7d, 3d, 1d, 6h, 1h before
   - **Medium (4–6):** 3d, 1d before
   - **Low (<4):** 1d before
   - **Rolling:** Weekly for 12 weeks
6. Delayed BullMQ jobs dispatched at reminder times
7. **Dispatcher worker** generates contextual AI message and sends via configured channels

---

## Monorepo Scripts

| Command              | Description                              |
|----------------------|------------------------------------------|
| `pnpm dev`           | Start all apps in dev mode               |
| `pnpm build`         | Build all apps for production            |
| `pnpm db:generate`   | Generate Prisma client                   |
| `pnpm db:migrate`    | Run Prisma migrations                    |
| `pnpm db:studio`     | Open Prisma Studio                       |

---

## Extension Auth Flow

1. User clicks **Sign in with Google** in extension popup
2. Popup window opens to web dashboard `/auth` page
3. User completes Google OAuth
4. Page extracts Google ID token from URL hash
5. PostMessage sends token to extension
6. Extension POSTs token to `/api/auth/google`
7. Backend verifies, creates/updates user, returns DeadlineAI JWT
8. Extension stores JWT in `chrome.storage.local`

**Telegram Connect Flow:**
1. Signed-in user clicks **Connect Telegram**
2. Extension/dashboard calls `POST /api/auth/telegram-link`
3. Backend generates temporary token and returns `t.me/Bot?start=TOKEN` URL
4. Opens Telegram bot with the token
5. User clicks **Start** → bot calls webhook → backend links `telegramId`
6. User sees "Telegram connected" badge instantly

---

## Deployment

### Dashboard (Vercel)

```bash
cd apps/web && vercel --prod
```

### API (Docker / Railway / Render)

```bash
pnpm build
cd packages/db && pnpm build
cd apps/api && pnpm build && node dist/index.js
```

### Database (Supabase)

1. Create PostgreSQL project
2. Copy connection string to `DATABASE_URL`
3. Run `pnpm db:migrate`

### Redis (Upstash)

1. Create Redis database
2. Copy URL to `UPSTASH_REDIS_URL`
3. BullMQ connects automatically

### Amazon Bedrock (Kimi K2.5)

The API talks to Bedrock Mantle’s OpenAI-compatible endpoint:

```bash
# apps/api/.env
BEDROCK_API_KEY="your-bedrock-long-term-api-key"
BEDROCK_REGION="us-east-2"
BEDROCK_MODEL="moonshotai.kimi-k2.5"
```

Create the key in the [Bedrock console](https://console.aws.amazon.com/bedrock/home#/api-keys/long-term/create) and enable **Kimi K2.5** model access in that region.

Smoke-test after deploy:

```bash
curl "https://deadlineai-api.onrender.com/health/llm"
curl "https://deadlineai-api.onrender.com/health/llm?ping=1"
```

---

## Product Limits

- **Free:** 10 active reminders (enforced in API)
- **Pro:** Unlimited reminders, advanced analytics, AI prioritization

Toggle plans by updating the `plan` column in the `User` table.

---

## Roadmap

- AI weekly digest
- AI opportunity scoring
- Calendar integrations (Google/Outlook)
- Team/shared workspaces
- WhatsApp re-enablement with business verification

---

## License

MIT
