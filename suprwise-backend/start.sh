#!/bin/bash
# Start Suprwise FastAPI backend
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Create data directory if missing
mkdir -p data

# Install dependencies if needed
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "Installing Python dependencies..."
  pip3 install -r requirements.txt
fi

echo "Starting Suprwise backend on port 8000..."
exec uvicorn suprwise.main:app --host 0.0.0.0 --port 8000 --workers 2
