# DeadlineAI - Credentials Needed for Deployment

## Required Credentials (Production)

### 1. Supabase PostgreSQL
```
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```
**How to get:**
1. Go to https://supabase.com/dashboard
2. Create new project (or use existing)
3. Settings → Database → Connection string → URI
4. Replace `[PASSWORD]` with your database password

### 2. Upstash Redis
```
UPSTASH_REDIS_URL="rediss://default:[PASSWORD]@[HOST]:[PORT]"
```
**How to get:**
1. Go to https://console.upstash.com
2. Create Redis database
3. Copy the `rediss://` endpoint URL

### 3. Google OAuth (for Sign-In)
```
GOOGLE_CLIENT_IDS="your-client-id.apps.googleusercontent.com"
```
**How to get:**
1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URIs:
   - `https://web-i24hours-projects.vercel.app/auth`
   - `http://localhost:3000/auth` (for local dev)
4. Copy Client ID

### 4. Google SMTP (for Email Notifications)
```
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
EMAIL_FROM="DeadlineAI <your-email@gmail.com>"
```
**How to get:**
1. Go to https://myaccount.google.com/apppasswords
2. Generate App Password (16 characters, no spaces)
3. Use your Gmail address

### 5. LiteLLM Proxy
```
LITELLM_PROXY_URL="https://your-litellm-proxy.fly.dev/v1"
LITELLM_API_KEY="sk-your-proxy-key"
LITELLM_MODEL="gpt-4o-mini"
```
**How to get:**
1. Deploy LiteLLM proxy (Fly.io, Railway, or local)
2. Set master_key in proxy config
3. Copy proxy URL and key

### 6. Telegram Bot
```
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrSTUvwxyz"
TELEGRAM_BOT_NAME="DeadlineAIBot"
TELEGRAM_WEBHOOK_URL="https://deadlineai-api.onrender.com/api/webhooks/telegram"
```
**How to get:**
1. Message @BotFather on Telegram
2. Create new bot with /newbot
3. Copy API token and bot username

### 7. Firecrawl (Page Scraping)
```
FIRECRAWL_API_KEY="fc-xxxxxxxxxxxxxxxx"
```
**How to get:**
1. Go to https://firecrawl.dev
2. Sign up and copy API key

### 8. JWT Secret
```
JWT_SECRET="any-random-256-bit-secret-string-here"
```
Generate one:
```bash
openssl rand -base64 32
```

---

## Complete .env file for Render

Copy this and fill in ALL values:

```env
NODE_ENV=production
PORT=4000
DATABASE_URL="postgresql://..."
UPSTASH_REDIS_URL="rediss://..."
JWT_SECRET="..."
GOOGLE_CLIENT_IDS="..."
FRONTEND_URL="https://web-i24hours-projects.vercel.app"
LITELLM_PROXY_URL="..."
LITELLM_API_KEY="..."
LITELLM_MODEL="gpt-4o-mini"
FIRECRAWL_API_KEY="..."
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="..."
SMTP_PASS="..."
EMAIL_FROM="DeadlineAI <...>"
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_BOT_NAME="..."
TELEGRAM_WEBHOOK_URL="https://deadlineai-api.onrender.com/api/webhooks/telegram"
CRON_INTERVAL_MS=60000
```

---

## Deploy Checklist

- [ ] Supabase project created + `DATABASE_URL`
- [ ] Upstash Redis created + `UPSTASH_REDIS_URL`
- [ ] Google OAuth Client ID created
- [ ] Google App Password generated
- [ ] LiteLLM Proxy deployed
- [ ] Telegram bot created via @BotFather
- [ ] Firecrawl API key obtained
- [ ] JWT secret generated
- [ ] All values pasted into Render dashboard
- [ ] Click Deploy on Render
- [ ] Set Telegram webhook after API is live
