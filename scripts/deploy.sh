#!/bin/bash
set -e

echo "DeadlineAI Deployment Script"
echo "=============================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running from project root
if [ ! -f "package.json" ] || [ ! -d "apps/api" ]; then
    echo -e "${RED}Error: Must run from project root${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Committing latest changes...${NC}"
git add -A
git commit -m "deploy: prepare for production" || echo "Nothing to commit"
git push origin main

echo ""
echo -e "${YELLOW}Step 2: Deploying API to Render...${NC}"
if command -v render &> /dev/null; then
    echo "Render CLI detected. Use the dashboard BluePrint for auto-deploy from GitHub."
    echo "   1. Go to https://dashboard.render.com/blueprints"
    echo "   2. Connect your GitHub repo: i24hour/spacelink"
    echo "   3. Render will auto-detect render.yaml"
else
    echo -e "${RED}Render CLI not found. Install: brew install render${NC}"
fi

echo ""
echo -e "${YELLOW}Step 3: Deploying Dashboard to Vercel...${NC}"
if command -v vercel &> /dev/null; then
    cd apps/web
    vercel --prod
    cd ../..
else
    echo -e "${RED}Vercel CLI not found. Install: npm i -g vercel${NC}"
fi

echo ""
echo -e "${GREEN}Deployment initialized!${NC}"
echo ""
echo "Next steps:"
echo "1. Add environment variables in Render dashboard"
echo "2. Add environment variables in Vercel dashboard"
echo "3. Set Telegram webhook: curl https://your-api.com/api/webhooks/telegram/setup"
