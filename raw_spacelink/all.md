# DeadlineAI - Complete Project Reference

## Overview
DeadlineAI is an AI-powered deadline tracking system for internet opportunities. Users save webpages through a browser extension, and the AI extracts deadlines, categorizes opportunities, scores urgency, and sends smart reminders via **Telegram** and **Email**.

## Core Features

### 1. Browser Extension
- Save current page with one click
- Captures URL, title, page content, and metadata
- Auto-detects duplicates before saving
- Shows recent saved opportunities in popup
- **Google Sign-In** for authentication
- **One-click Telegram connect** via deep-link bot auth
- Shows connection status badges (Telegram connected/disconnected)

### 2. Authentication (Dual Support)
- **Google Sign-In** (Primary): Extension + Web dashboard
  - OAuth 2.0 implicit flow via popup window
  - Backend verifies Google ID token with `google-auth-library`
  - Issues DeadlineAI JWT for all API calls
- **Clerk** (Secondary): Web dashboard fallback
  - Universal auth middleware accepts both token types
- JWT stored in `chrome.storage.local` for extension

### 3. Telegram Bot & Deep-Link Auth
- Dedicated bot with webhook support
- **Zero-friction connection**: user clicks "Connect Telegram" → opens bot with unique token → clicks Start → auto-linked
- No manual Chat ID copy-paste needed
- Bot commands:
  - `/start TOKEN` — Deep-link account connection
  - `/start` — Welcome message
  - `/deadlines` — List upcoming deadlines with days left
  - `/help` — Show all commands
- HTML formatting support for rich messages
- Auto-fallback to plain text if HTML parse fails

### 4. AI Extraction Pipeline
- Reads webpage content (raw text or Firecrawl enrichment)
- Extracts via LiteLLM Proxy (OpenAI-compatible):
  - Exact deadline date and timezone
  - Event/program name
  - Category (hackathon, grant, internship, visa, accelerator, etc.)
  - Urgency score (1-10)
  - Confidence score (0-1)
  - Rolling application detection
  - Estimated completion time in minutes
- Supports multiple deadlines on same page
- Handles missing/ambiguous deadlines gracefully
- Allows manual editing after extraction

### 5. Smart Reminder Engine
- Dynamic scheduling based on urgency:
  - High (≥7): 7 days, 3 days, 1 day, 6 hours, 1 hour before
  - Medium (4–6): 3 days, 1 day before
  - Low (<4): 1 day before
  - Rolling: Weekly reminders for 12 weeks
- Automatic queue management via BullMQ
- Delayed job dispatch for reliability
- Cron sweep every 60 seconds for missed reminders

### 6. AI Message Generation
- Context-aware reminders (not generic alerts)
- Includes: days since saved, exact deadline time, timezone, estimated completion
- Tone: intelligent, concise, motivating
- Generated via LiteLLM at send-time
- Telegram messages use HTML formatting

### 7. Notification System

**Email (Resend)**
- Premium branded dark-theme HTML email template
- Responsive mobile/desktop design with DeadlineAI branding
- Plain text auto-fallback
- "Manage notifications" footer link
- Test send button in Settings

**Telegram (Bot API)**
- Deep-link authentication (no manual Chat ID entry)
- HTML message formatting
- Auto-fallback to plain text on parse errors
- Bot commands for interactive deadline queries
- Test send button in Settings

**Shared Features**
- User-selectable channels per account
- Failed delivery retry with exponential backoff
- Full notification logging with delivery status

### 8. SaaS Dashboard
- Upcoming deadlines view
- Missed deadlines tracking
- High urgency alerts
- Search and filter saved opportunities
- Category tags and countdown timers
- Settings: channels, timezone, test notifications
- Plan-based limits (free = 10 active reminders)

---

## Tech Stack

### Frontend (Dashboard)
- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Framer Motion (animations)
- Clerk authentication (optional fallback)
- Google Sign-In (primary)
- next-themes (dark/light mode)

### Browser Extension
- Plasmo framework
- React + TypeScript
- Chrome Manifest V3
- Google OAuth via popup window
- PostMessage token relay from popup to extension
- Background service worker for JWT storage

### Backend API
- Node.js + Express
- TypeScript (compiled via tsc)
- tsx for development
- Zod validation
- **DeadlineAI JWT auth** (jsonwebtoken)
- **Google ID token verification** (google-auth-library)
- **Universal auth middleware** (accepts both JWT and Clerk tokens)
- BullMQ + Upstash Redis (queue system)
- LiteLLM Proxy for AI (OpenAI SDK compatible)
- Firecrawl for page scraping enrichment
- Resend for email
- Telegram Bot API with webhook

### Database
- PostgreSQL (Supabase-compatible)
- Prisma ORM
- Schema: Users, SavedLinks, Reminders, NotificationLogs

### Queue/Cron
- Upstash Redis (BullMQ backend)
- BullMQ workers for async processing
- Custom interval cron (60s)

### Deployment
- Dashboard: Vercel
- API: Docker/Railway/Render (Node.js server)
- Database: Supabase PostgreSQL
- Redis: Upstash
- CDN/Static: Vercel Edge

---

## Complete Folder Structure

```
spacelink/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── prisma.ts
│   │   │   │   │   # Re-exports Prisma client from packages/db
│   │   │   │   │   # Provides database connection singleton
│   │   │   │   │
│   │   │   │   ├── redis.ts
│   │   │   │   │   # Configures ioredis with Upstash Redis URL
│   │   │   │   │   # Exports redis and redisPub instances for BullMQ
│   │   │   │   │
│   │   │   │   ├── clerk.ts
│   │   │   │   │   # Clerk auth middleware (kept as fallback)
│   │   │   │   │   # Restricts tokens to authorized frontend URLs
│   │   │   │   │   # Exports clerkClient for user management
│   │   │   │   │
│   │   │   │   ├── auth.ts
│   │   │   │   │   # DeadlineAI JWT auth system
│   │   │   │   │   # generateToken() / verifyToken() for JWT lifecycle
│   │   │   │   │   # verifyGoogleToken() using google-auth-library
│   │   │   │   │   # upsertUserFromGoogle() creates User from Google profile
│   │   │   │   │   # createTelegramLinkToken() / consumeTelegramLinkToken()
│   │   │   │   │   #   for deep-link auth with 10-min expiry
│   │   │   │   │   # requireAuth() middleware for protected routes
│   │   │   │   │   # AuthRequest interface with userId property
│   │   │   │   │
│   │   │   │   ├── universal-auth.ts
│   │   │   │   │   # universalAuth() middleware
│   │   │   │   │   # Tries DeadlineAI JWT first, then Clerk JWT fallback
│   │   │   │   │   # Allows smooth transition and dual auth support
│   │   │   │   │
│   │   │   │   ├── llm.ts
│   │   │   │   │   # OpenAI SDK configured for LiteLLM Proxy
│   │   │   │   │   # Base URL points to LiteLLM proxy endpoint
│   │   │   │   │   # extractWithLLM() helper for JSON-mode extraction
│   │   │   │   │
│   │   │   │   └── firecrawl.ts
│   │   │   │       # Firecrawl API integration for page scraping
│   │   │   │       # Extracts markdown, HTML, and metadata from URLs
│   │   │   │       # Falls back gracefully on errors
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── extraction.ts
│   │   │   │   │   # Main AI extraction pipeline
│   │   │   │   │   # Builds structured prompt for deadline extraction
│   │   │   │   │   # Calls LiteLLM with JSON response format
│   │   │   │   │   # Enriches thin content via Firecrawl
│   │   │   │   │   # Updates SavedLink with extracted fields
│   │   │   │   │   # Triggers reminder scheduling after extraction
│   │   │   │   │
│   │   │   │   ├── reminders.ts
│   │   │   │   │   # Smart reminder scheduling logic
│   │   │   │   │   # Calculates reminder times based on urgency score
│   │   │   │   │   # Handles rolling applications (weekly)
│   │   │   │   │   # Respects user's preferred channels
│   │   │   │   │   # Creates reminder records and BullMQ delayed jobs
│   │   │   │   │
│   │   │   │   ├── ai-message.ts
│   │   │   │   │   # Generates contextual reminder messages
│   │   │   │   │   # Calls LiteLLM with opportunity context
│   │   │   │   │   # Returns human-like, motivating reminder text
│   │   │   │   │
│   │   │   │   └── notifications/
│   │   │   │       ├── email.ts
│   │   │   │       │   # Resend email integration
│   │   │   │       │   # Branded dark-theme HTML email template
│   │   │   │       │   # buildEmailTemplate() for reusable layout
│   │   │   │       │   # Includes DeadlineAI logo, responsive styles
│   │   │   │       │   # Plain text fallback
│   │   │   │       │
│   │   │   │       ├── telegram.ts
│   │   │   │       │   # Telegram Bot API integration
│   │   │   │       │   # sendTelegramRaw() supports Markdown and HTML
│   │   │   │       │   # Auto-fallback to plain text on parse errors
│   │   │   │       │   # setTelegramWebhook() / deleteTelegramWebhook()
│   │   │   │       │   # Webhook setup helper for bot configuration
│   │   │   │       │
│   │   │   │       └── whatsapp.ts
│   │   │   │           # Meta WhatsApp Cloud API integration
│   │   │   │           # Paused — ready when business number is acquired
│   │   │   │
│   │   │   ├── queues/
│   │   │   │   ├── processor.ts
│   │   │   │   │   # BullMQ queue and worker for link processing
│   │   │   │   │   # Queue: link-processor
│   │   │   │   │   # Handles AI extraction asynchronously
│   │   │   │   │   # Retries with exponential backoff
│   │   │   │   │
│   │   │   │   └── dispatcher.ts
│   │   │   │       # BullMQ queue and worker for reminder dispatch
│   │   │   │       # Queue: reminder-dispatch
│   │   │   │       # Generates AI message at send-time
│   │   │   │       # Routes to correct channel (email/telegram)
│   │   │   │       # Uses HTML format for Telegram messages
│   │   │   │       # Logs delivery status to NotificationLog
│   │   │   │       # Retries failed deliveries
│   │   │   │
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   │   # POST /api/auth/google
│   │   │   │   │   #   Verifies Google ID token via google-auth-library
│   │   │   │   │   #   Creates/updates User record
│   │   │   │   │   #   Returns DeadlineAI JWT + user info
│   │   │   │   │   # GET /api/auth/me
│   │   │   │   │   #   Returns current user with telegramConnected flag
│   │   │   │   │   # POST /api/auth/telegram-link
│   │   │   │   │   #   Generates deep-link token for Telegram bot
│   │   │   │   │   #   Returns t.me/Bot?start=TOKEN URL
│   │   │   │   │
│   │   │   │   ├── links.ts
│   │   │   │   │   # POST /api/links - Save new link
│   │   │   │   │   # Validates URL, title, content with Zod
│   │   │   │   │   # Enforces free plan limit (10 active)
│   │   │   │   │   # Enqueues link for AI extraction
│   │   │   │   │   # GET /api/links - List user's saved links
│   │   │   │   │   # PATCH /api/links/:id - Update deadline/metadata
│   │   │   │   │   # DELETE /api/links/:id - Remove link
│   │   │   │   │
│   │   │   │   ├── reminders.ts
│   │   │   │   │   # GET /api/reminders - All reminders with link data
│   │   │   │   │   # GET /api/reminders/upcoming - Pending future reminders
│   │   │   │   │
│   │   │   │   ├── users.ts
│   │   │   │   │   # GET /api/users/me - Current user profile
│   │   │   │   │   # PATCH /api/users/me - Update settings
│   │   │   │   │   #   timezone, preferredChannels
│   │   │   │   │   # Returns telegramConnected boolean
│   │   │   │   │
│   │   │   │   ├── notifications.ts
│   │   │   │   │   # POST /api/notifications/test-email
│   │   │   │   │   #   Sends test email to registered email
│   │   │   │   │   # POST /api/notifications/test-telegram
│   │   │   │   │   #   Sends test message if Telegram connected
│   │   │   │   │   #   Returns delivery status
│   │   │   │   │
│   │   │   │   ├── telegram-webhook.ts
│   │   │   │   │   # POST /api/webhooks/telegram
│   │   │   │   │   #   Receives Telegram Bot webhook updates
│   │   │   │   │   #   /start TOKEN -> deep-link auth
│   │   │   │   │   #     Links telegramId, sets preferredChannels=[telegram]
│   │   │   │   │   #     Sends confirmation message with HTML formatting
│   │   │   │   │   #   /start (no token) -> welcome message
│   │   │   │   │   #   /deadlines -> queries DB, shows upcoming links
│   │   │   │   │   #   /help -> command list
│   │   │   │   │   #   Unknown -> friendly error with command hints
│   │   │   │   │   # POST /api/webhooks/telegram/setup
│   │   │   │   │   #   Helper endpoint to set Telegram webhook URL
│   │   │   │   │
│   │   │   │   └── webhooks.ts
│   │   │   │       # POST /api/webhooks/clerk
│   │   │   │       # Handles Clerk webhook events
│   │   │   │       # user.created -> creates User record
│   │   │   │       # user.updated -> syncs email
│   │   │   │       # user.deleted -> removes User record
│   │   │   │       # Raw body parser used for Svix signature verification
│   │   │   │
│   │   │   ├── cron/
│   │   │   │   └── reminders.ts
│   │   │   │       # Periodic cron job (runs every 60s)
│   │   │   │       # Scans for pending reminders past due
│   │   │   │       # Enqueues them to dispatcher queue
│   │   │   │       # Prevents stuck/missed reminders
│   │   │   │
│   │   │   └── index.ts
│   │   │       # Express application entry point
│   │   │       # Configures CORS, JSON parsing, cookie parser
│   │   │       # Mounts all route handlers
│   │   │       #   /api/auth, /api/links, /api/reminders
│   │   │       #   /api/users, /api/notifications
│   │   │       #   /api/webhooks (Clerk), /api/webhooks/telegram
│   │   │       # Initializes cron and BullMQ workers
│   │   │       # Graceful shutdown on SIGTERM
│   │   │
│   │   ├── .env.example
│   │   │   # Template for all API environment variables
│   │   │   # Database, Redis, JWT_SECRET, GOOGLE_CLIENT_IDS
│   │   │   # Clerk keys (optional fallback), FRONTEND_URL
│   │   │   # LiteLLM, Firecrawl, Resend
│   │   │   # Telegram: BOT_TOKEN, BOT_NAME, WEBHOOK_URL
│   │   │   # WhatsApp credentials (paused)
│   │   │
│   │   ├── package.json
│   │   │   # Dependencies: Express, BullMQ, ioredis, OpenAI SDK
│   │   │   # jsonwebtoken, google-auth-library, resend
│   │   │   # Dev: tsx, TypeScript, @types/express
│   │   │
│   │   └── tsconfig.json
│   │       # TypeScript config for Node.js/Express
│   │       # Path aliases for workspace packages
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── globals.css
│   │   │   │   │   # Tailwind base imports
│   │   │   │   │   # CSS variables for shadcn/ui theming
│   │   │   │   │   # Light and dark mode color definitions
│   │   │   │   │
│   │   │   │   ├── layout.tsx
│   │   │   │   │   # Root layout with ClerkProvider (fallback)
│   │   │   │   │   # ThemeProvider for dark/light mode
│   │   │   │   │   # Navbar component wrapper
│   │   │   │   │   # Global metadata for SEO
│   │   │   │   │
│   │   │   │   ├── page.tsx
│   │   │   │   │   # Landing page
│   │   │   │   │   # Hero section with value proposition
│   │   │   │   │   # Link to dashboard
│   │   │   │   │
│   │   │   │   ├── auth/
│   │   │   │   │   └── page.tsx
│   │   │   │   │       # Google Sign-In page for extension + web
│   │   │   │   │       # Handles OAuth redirect with id_token in URL hash
│   │   │   │   │       # PostMessages token to parent (extension popup)
│   │   │   │   │       # Or exchanges token directly for web users
│   │   │   │   │       # Uses NEXT_PUBLIC_GOOGLE_CLIENT_ID
│   │   │   │   │
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx
│   │   │   │   │       # Main dashboard (client component)
│   │   │   │   │       # Statistics cards (total, active, urgent, missed)
│   │   │   │   │       # Search bar for filtering opportunities
│   │   │   │   │       # Saved links list with cards
│   │   │   │   │       # Urgency badges, category tags, countdowns
│   │   │   │   │       # Archive and delete actions
│   │   │   │   │       # Loading skeletons and empty states
│   │   │   │   │
│   │   │   │   ├── settings/
│   │   │   │   │   └── page.tsx
│   │   │   │   │       # User settings page (client component)
│   │   │   │   │       # Toggle notification channels (email/telegram)
│   │   │   │   │       # Timezone selection dropdown
│   │   │   │   │       # Telegram connection status + Connect button
│   │   │   │   │       # Deep-link Telegram auth (no manual Chat ID)
│   │   │   │   │       # Test email send button
│   │   │   │   │       # Test Telegram send button (when connected)
│   │   │   │   │       # Plan info card
│   │   │   │   │       # Save changes to API
│   │   │   │   │
│   │   │   │   └── extension-connect/
│   │   │   │       └── page.tsx
│   │   │   │           # Legacy Clerk token relay page
│   │   │   │           # Kept for backward compatibility
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── navbar.tsx
│   │   │   │   │   # Top navigation bar
│   │   │   │   │   # DeadlineAI branding
│   │   │   │   │   # Navigation links (Dashboard, Settings)
│   │   │   │   │   # Active link highlighting
│   │   │   │   │   # Clerk UserButton for auth actions
│   │   │   │   │
│   │   │   │   └── ui/
│   │   │   │       ├── button.tsx
│   │   │   │       │   # shadcn/ui Button component
│   │   │   │       │
│   │   │   │       ├── card.tsx
│   │   │   │       │   # Card, CardHeader, CardTitle, CardContent
│   │   │   │       │
│   │   │   │       ├── badge.tsx
│   │   │   │       │   # Status and category badges
│   │   │   │       │
│   │   │   │       ├── input.tsx
│   │   │   │       │   # Form input component
│   │   │   │       │
│   │   │   │       ├── skeleton.tsx
│   │   │   │       │   # Loading placeholder animation
│   │   │   │       │
│   │   │   │       ├── dialog.tsx
│   │   │   │       │   # Modal dialog component (Radix Dialog)
│   │   │   │       │
│   │   │   │       └── select.tsx
│   │   │   │           # Dropdown select component (Radix Select)
│   │   │   │
│   │   │   ├── lib/
│   │   │   │   ├── utils.ts
│   │   │   │   │   # cn() utility for Tailwind class merging
│   │   │   │   │   # formatDistanceToNow() for countdown display
│   │   │   │   │
│   │   │   │   ├── api.ts
│   │   │   │   │   # Server-side API fetch utility (Clerk-based)
│   │   │   │   │
│   │   │   │   └── api-client.ts
│   │   │   │       # Client-side API hook (useApi)
│   │   │   │       # Gets Clerk token via useAuth()
│   │   │   │       # Used by React components for API calls
│   │   │   │
│   │   │   └── middleware.ts
│   │   │       # Next.js middleware with Clerk
│   │   │       # Protects /dashboard and /settings routes
│   │   │
│   │   ├── .env.example
│   │   │   # NEXT_PUBLIC_API_URL (backend endpoint)
│   │   │   # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (optional fallback)
│   │   │   # NEXT_PUBLIC_TELEGRAM_BOT_NAME (for deep links)
│   │   │   # NEXT_PUBLIC_GOOGLE_CLIENT_ID (for OAuth)
│   │   │
│   │   ├── components.json
│   │   │   # shadcn/ui configuration
│   │   │
│   │   ├── next.config.ts
│   │   │   # Next.js 15 configuration
│   │   │
│   │   ├── tailwind.config.ts
│   │   │   # Tailwind CSS config
│   │   │
│   │   ├── postcss.config.mjs
│   │   │   # PostCSS with Tailwind and autoprefixer
│   │   │
│   │   ├── package.json
│   │   │   # Dependencies: Next.js 15, React 19 RC, Clerk
│   │   │   # Tailwind, shadcn components, Framer Motion
│   │   │
│   │   └── tsconfig.json
│   │       # Next.js TypeScript configuration
│   │
│   └── extension/
│       ├── src/
│       │   ├── popup.tsx
│       │   │   # Main extension popup UI (React)
│       │   │   # COMPLETE REWRITE with Google Sign-In
│       │   │   #
│       │   │   # Unauthenticated state:
│       │   │   #   Shows DeadlineAI branding + value prop
│       │   │   #   "Sign in with Google" button (opens /auth popup)
│       │   │   #   Listens for PostMessage with Google ID token
│       │   │   #   Exchanges token with /api/auth/google
│       │   │   #   Stores DeadlineAI JWT in chrome.storage.local
│       │   │   #
│       │   │   # Authenticated state:
│       │   │   #   Shows user email + Disconnect button
│       │   │   #   Telegram connection status badge
│       │   │   #     "Connect Telegram" button (if disconnected)
│       │   │   #     "Telegram connected" badge (if linked)
│       │   │   #   Current page info with Save Deadline button
│       │   │   #   Duplicate detection highlight
│       │   │   #   Recent opportunities list with urgency badges
│       │   │   #
│       │   │   # Telegram connect flow:
│       │   │   #   Calls POST /api/auth/telegram-link
│       │   │   #   Opens returned t.me URL in new tab
│       │   │   #   User clicks Start -> bot auto-links
│       │   │   #
│       │   │   # Save flow:
│       │   │   #   Scrapes page content via chrome.scripting
│       │   │   #   POST /api/links with JWT auth header
│       │   │   #   Shows success/error message
│       │   │
│       │   ├── content.ts
│       │   │   # Content script (minimal now)
│       │   │   # Kept for any future page-level interactions
│       │   │   # Token relay now handled via popup PostMessage
│       │   │
│       │   ├── background.ts
│       │   │   # Service worker for extension
│       │   │   # Manages chrome.storage.local for JWT token
│       │   │   # Handles messages: storeToken, getToken, clearToken
│       │   │
│       │   └── style.css
│       │       # Extension popup styles
│       │       # Dark theme, card layouts, badges
│       │       # Button styles (primary/secondary)
│       │       # Responsive 360px popup width
│       │
│       ├── .env.example
│       │   # PLASMO_PUBLIC_API_URL (backend endpoint)
│       │   # PLASMO_PUBLIC_WEB_URL (dashboard URL for auth)
│       │
│       ├── package.json
│       │   # Plasmo framework dependencies
│       │   # React 18, TypeScript
│       │   # Chrome manifest permissions (activeTab, storage, scripting, tabs)
│       │
│       └── tsconfig.json
│           # Plasmo TypeScript config
│           # Path alias ~* for root imports
│
├── packages/
│   ├── db/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   │       # Database schema
│   │   │       # User model: id (google prefixed), email, telegramId
│   │   │       #   preferredChannels, timezone, plan
│   │   │       # SavedLink model: URL, content, extraction fields
│   │   │       # Reminder model: scheduled times, channels, status
│   │   │       # NotificationLog: delivery tracking
│   │   │
│   │   ├── src/
│   │   │   └── client.ts
│   │   │       # Prisma client singleton
│   │   │
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/
│       ├── src/
│       │   └── index.ts
│       │       # Shared TypeScript interfaces
│       │
│       ├── package.json
│       └── tsconfig.json
│
├── raw_spacelink/
│   └── all.md
│       # This file - complete project reference
│
├── package.json
│   # Root package with Turbo scripts
│
├── pnpm-workspace.yaml
│   # PNPM workspace definition
│
├── turbo.json
│   # Turbo pipeline configuration
│
├── .gitignore
│   # Exclusions: node_modules, .env, builds
│
└── README.md
    # Complete setup guide
    # Auth setup (Google + Clerk)
    # Telegram bot instructions
    # Email setup
    # Deployment guides
```

---

## Authentication Flows

### Google Sign-In (Extension)

1. User clicks "Sign in with Google" in extension popup
2. Popup window opens to dashboard `/auth` page
3. `/auth` page redirects to Google OAuth with client_id
4. Google redirects back to `/auth#id_token=...`
5. `/auth` extracts id_token from URL hash
6. PostMessage sends `DEADLINEAI_GOOGLE_ID_TOKEN` to extension
7. Extension receives message
8. Extension POSTs `{ idToken }` to `/api/auth/google`
9. Backend verifies Google token via `google-auth-library`
10. Backend creates/updates User, issues DeadlineAI JWT
11. Extension stores JWT in `chrome.storage.local`
12. Extension reloads UI with authenticated state

### Telegram Deep-Link Auth (Extension or Web)

1. Signed-in user clicks "Connect Telegram"
2. Frontend calls `POST /api/auth/telegram-link`
3. Backend generates temporary link token (10-min expiry)
4. Returns `https://t.me/BotName?start=TOKEN`
5. Frontend opens Telegram URL in new tab
6. User clicks "Start" in Telegram
7. Bot sends webhook POST to `/api/webhooks/telegram`
8. Backend calls `consumeTelegramLinkToken(TOKEN)`
9. If valid: saves `telegramId` to user, sets preferredChannels=[telegram]
10. Bot replies with confirmation message in Telegram
11. User is now connected — all reminders go to Telegram

### Saving a Deadline (Full Flow)

1. User clicks "Save Deadline" in extension popup
2. Extension scrapes page content via `chrome.scripting.executeScript`
3. POST `/api/links` with URL, title, content + JWT header
4. API validates, checks plan limits, creates SavedLink (status: pending)
5. Enqueues BullMQ job (link-processor)
6. Link-processor worker:
   - Optionally enriches content with Firecrawl
   - Builds structured prompt for deadline extraction
   - Calls LiteLLM via OpenAI SDK with JSON mode
   - Parses extracted fields
   - Updates SavedLink with deadline, category, urgency, etc.
7. Calls reminder scheduler:
   - Calculates reminder times based on urgency score
   - Creates Reminder records for each preferred channel
   - Enqueues delayed BullMQ jobs (reminder-dispatch)
8. At reminder time, dispatcher worker:
   - Generates contextual AI message
   - Sends via configured channels (email/telegram)
   - Updates delivery status, logs to NotificationLog

---

## Configuration Files Reference

### API Environment (apps/api/.env.example)
- `DATABASE_URL` - PostgreSQL connection
- `UPSTASH_REDIS_URL` - Redis for BullMQ
- `JWT_SECRET` - DeadlineAI JWT signing secret
- `GOOGLE_CLIENT_IDS` - Comma-separated Google OAuth client IDs
- `CLERK_SECRET_KEY` / `CLERK_WEBHOOK_SECRET` - Optional Clerk fallback
- `FRONTEND_URL` - CORS origin
- `PORT` - API server port
- `LITELLM_PROXY_URL` / `LITELLM_API_KEY` / `LITELLM_MODEL` - AI provider
- `FIRECRAWL_API_KEY` - Page scraping
- `RESEND_API_KEY` / `EMAIL_FROM` - Email delivery
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_NAME` / `TELEGRAM_WEBHOOK_URL` - Telegram
- `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` - WhatsApp (paused)
- `CRON_INTERVAL_MS` - Cron sweep frequency

### Web Environment (apps/web/.env.example)
- `NEXT_PUBLIC_API_URL` - Backend endpoint
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk (optional)
- `NEXT_PUBLIC_TELEGRAM_BOT_NAME` - For deep links
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` - Google OAuth

### Extension Environment (apps/extension/.env.example)
- `PLASMO_PUBLIC_API_URL` - Backend endpoint
- `PLASMO_PUBLIC_WEB_URL` - Dashboard URL for auth relay

---

## Key Design Decisions

### Dual Auth System
- DeadlineAI JWT as primary (from Google Sign-In)
- Clerk JWT as secondary fallback (for existing web dashboard users)
- Universal auth middleware tries both transparently
- Allows gradual migration without breaking existing users

### Telegram Deep-Link Auth
- Eliminates manual Chat ID copy-paste friction
- Temporary link tokens prevent replay attacks
- 10-minute expiry limits attack window
- Bot auto-sets preferred channel to Telegram on connect
- Users can still use `/deadlines` command to query anytime

### HTML Telegram Messages
- Bot uses HTML parse_mode for rich formatting
- Auto-fallback to plain text if HTML parse fails
- Consistent with email branding
- Better readability for deadline information

### Extension Auth via PostMessage
- Google OAuth in popup window (standard OAuth flow)
- PostMessage relay avoids exposing secrets in extension
- Works across origins securely
- JWT stored in chrome.storage.local persists across sessions
