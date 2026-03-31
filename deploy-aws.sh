#!/bin/bash
# Run this script ON the AWS server to deploy Suprwise
# Usage: bash deploy-aws.sh
set -e

REPO_DIR="/home/ubuntu/test0111"
BACKEND_DIR="$REPO_DIR/suprwise-backend"
FRONTEND_DIR="$REPO_DIR/react code v1"
DIST_DIR="/var/www/suprwise"

echo "=== Suprwise AWS Deployment ==="

# ── 1. Backend virtualenv + deps ─────────────────────────────────────────────
echo ""
echo ">>> [1/4] Setting up Python virtualenv and installing deps..."
cd "$BACKEND_DIR"
mkdir -p data

if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
venv/bin/pip install -r requirements.txt --quiet
echo "Python deps installed."

# ── 2. Backend systemd service ────────────────────────────────────────────────
echo ""
echo ">>> [2/4] Installing systemd service for backend..."
sudo cp "$BACKEND_DIR/suprwise-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable suprwise-backend
sudo systemctl restart suprwise-backend
sleep 3
sudo systemctl status suprwise-backend --no-pager -l
curl -s http://localhost:8000/api/health && echo "" || echo "WARNING: backend not responding yet"

# ── 3. Frontend build ─────────────────────────────────────────────────────────
echo ""
echo ">>> [3/4] Building React frontend..."
cd "$FRONTEND_DIR"
npm install --silent
npm run build
sudo mkdir -p "$DIST_DIR"
sudo cp -r dist/. "$DIST_DIR/"
echo "Frontend built to $DIST_DIR"

# ── 4. Nginx config ───────────────────────────────────────────────────────────
echo ""
echo ">>> [4/4] Configuring nginx..."
sudo tee /etc/nginx/sites-available/suprwise > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/suprwise;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/suprwise /etc/nginx/sites-enabled/suprwise
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "=== Deployment complete ==="
echo "Backend health: $(curl -s http://localhost:8000/api/health)"
echo "Frontend: http://$(curl -s ifconfig.me 2>/dev/null || echo '<your-ip>')"
