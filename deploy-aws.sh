#!/bin/bash
# Run this script ON the AWS server to deploy Suprwise
# Usage: bash deploy-aws.sh
set -e

REPO_DIR="/home/ubuntu/test0111"
BACKEND_DIR="$REPO_DIR/suprwise-backend"
FRONTEND_DIR="$REPO_DIR/react code v1"
DIST_DIR="$REPO_DIR/react-dist"

echo "=== Suprwise AWS Deployment ==="

# ── 1. Backend ──────────────────────────────────────────────────────────────
echo ""
echo ">>> [1/4] Installing Python backend dependencies..."
cd "$BACKEND_DIR"
mkdir -p data
pip3 install -r requirements.txt --quiet

# ── 2. Backend service ───────────────────────────────────────────────────────
echo ""
echo ">>> [2/4] Setting up systemd service for backend..."
sudo cp "$BACKEND_DIR/suprwise-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable suprwise-backend
sudo systemctl restart suprwise-backend
sleep 2
sudo systemctl status suprwise-backend --no-pager

# ── 3. Frontend build ────────────────────────────────────────────────────────
echo ""
echo ">>> [3/4] Building React frontend..."
cd "$FRONTEND_DIR"
npm install --silent
npm run build
cp -r dist/. "$DIST_DIR/"
echo "Frontend built to $DIST_DIR"

# ── 4. Nginx config ──────────────────────────────────────────────────────────
echo ""
echo ">>> [4/4] Configuring nginx..."
sudo cp "$REPO_DIR/nginx.conf" /etc/nginx/sites-available/suprwise
sudo ln -sf /etc/nginx/sites-available/suprwise /etc/nginx/sites-enabled/suprwise
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "=== Deployment complete ==="
echo "Backend: http://localhost:8000/api/health"
echo "Frontend: http://$(curl -s ifconfig.me 2>/dev/null || echo '<your-ip>')"
