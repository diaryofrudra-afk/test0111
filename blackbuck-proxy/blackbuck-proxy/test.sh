#!/bin/bash
# ═══════════════════════════════════════════════
#  Suprwise — Blackbuck Proxy Setup & Test
# ═══════════════════════════════════════════════
#  Run this script in the blackbuck-proxy folder
# ═══════════════════════════════════════════════

set -e
clear

echo "╔══════════════════════════════════════════════════╗"
echo "║  Suprwise — Blackbuck GPS Proxy Setup            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check Node.js ──
echo "Step 1: Checking Node.js…"
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
    exit 1
fi
NODE_VER=$(node -v)
echo "   ✅ Node.js $NODE_VER"
echo ""

# ── Step 2: Install dependencies ──
echo "Step 2: Installing dependencies…"
if [ ! -d "node_modules" ]; then
    npm install
    echo "   ✅ Dependencies installed"
else
    echo "   ✅ Dependencies already installed"
fi
echo ""

# ── Step 3: Check .env ──
echo "Step 3: Checking .env configuration…"
if [ ! -f ".env" ]; then
    echo "   ⚠️  No .env file found. Creating from template…"
    cp .env.example .env
    echo ""
    echo "   ╔════════════════════════════════════════════╗"
    echo "   ║  EDIT YOUR CREDENTIALS NOW:                ║"
    echo "   ║                                            ║"
    echo "   ║  Open .env in any text editor and set:     ║"
    echo "   ║    BLACKBUCK_USERNAME=your_phone_number     ║"
    echo "   ║    BLACKBUCK_PASSWORD=your_password          ║"
    echo "   ║                                            ║"
    echo "   ║  Then run this script again.               ║"
    echo "   ╚════════════════════════════════════════════╝"
    echo ""
    
    # Try to open .env in default editor
    if command -v code &> /dev/null; then
        code .env
    elif command -v nano &> /dev/null; then
        nano .env
    elif command -v notepad &> /dev/null; then
        notepad .env
    fi
    exit 0
fi

# Read env values
source .env 2>/dev/null || true
if [ -z "$BLACKBUCK_USERNAME" ] || [ "$BLACKBUCK_USERNAME" = "your_phone_or_email" ]; then
    echo "   ❌ BLACKBUCK_USERNAME not set in .env"
    echo "   Edit .env and add your Blackbuck phone number / email"
    exit 1
fi
echo "   ✅ Username: $BLACKBUCK_USERNAME"
echo "   ✅ Password: ****$(echo $BLACKBUCK_PASSWORD | tail -c 4)"
echo ""

# ── Step 4: Test Blackbuck URL ──
echo "Step 4: Checking fleet.blackbuck.com reachability…"
if curl -sI --max-time 10 "https://fleet.blackbuck.com" > /dev/null 2>&1; then
    echo "   ✅ fleet.blackbuck.com is reachable"
else
    echo "   ⚠️  fleet.blackbuck.com might be down or blocked"
    echo "   Continuing anyway (the browser may handle redirects)"
fi
echo ""

# ── Step 5: Start server in debug mode ──
echo "Step 5: Starting proxy server in DEBUG mode…"
echo "   (Visible browser so you can see what happens)"
echo ""
echo "═══════════════════════════════════════════════════"
echo ""

# Run with visible browser for first test
HEADLESS=false LOG_LEVEL=debug node server.js
