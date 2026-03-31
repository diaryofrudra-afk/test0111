#!/bin/bash
# Start Suprwise FastAPI backend
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Create virtualenv if missing
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

# Install dependencies
echo "Installing dependencies..."
venv/bin/pip install -r requirements.txt --quiet

# Create data directory
mkdir -p data

echo "Starting Suprwise backend on port 8000..."
exec venv/bin/uvicorn suprwise.main:app --host 0.0.0.0 --port 8000 --workers 2
