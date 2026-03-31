# Suprwise — Blackbuck GPS Proxy

Proxy server that fetches live GPS telemetry from **fleet.blackbuck.com** and serves it to the Suprwise fleet dashboard.

## How it Works

1. A headless Chromium browser logs into your Blackbuck fleet portal
2. It intercepts the API responses that contain vehicle data (registration, GPS coordinates, ignition, odometer, speed, battery, fuel level)
3. The parsed data is cached and served via a REST API on `localhost:3000`
4. Your Suprwise dashboard calls this endpoint when you click **Sync Telemetry**

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env with your Blackbuck login (phone number + password)

# 3. Start the server
npm start
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fetch-blackbuck` | GET | Fetch vehicles (uses cache if fresh) |
| `/api/fetch-blackbuck/refresh` | GET | Force re-fetch from Blackbuck |
| `/api/health` | GET | Server health & cache status |
| `/api/vehicles/mock` | POST | Inject mock data for testing |

## Testing Without Blackbuck Credentials

You can inject realistic test data without any login:

```bash
# Start the server
npm start

# In another terminal, inject mock vehicles:
curl -X POST http://localhost:3000/api/vehicles/mock -H "Content-Type: application/json" -d '{"count": 5}'

# Now the Suprwise dashboard's "Sync Telemetry" button will work
```

## Troubleshooting

- **"Could not find login form fields"** — Blackbuck may have changed their login page. Check `debug-login.png` in the project folder. Set `HEADLESS=false` in `.env` to watch the browser.
- **"Login failed"** — Double-check your phone/email and password in `.env`
- **No vehicles found** — Check `debug-dashboard.png`. Blackbuck might use a different page structure. Open an issue with the screenshot.
- **Puppeteer won't install** — On Linux, you may need: `sudo apt install chromium-browser` and set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BLACKBUCK_USERNAME` | (required) | Your login phone/email |
| `BLACKBUCK_PASSWORD` | (required) | Your password |
| `BLACKBUCK_URL` | `https://fleet.blackbuck.com` | Portal URL |
| `PORT` | `3000` | Proxy server port |
| `CACHE_TTL` | `120` | Cache lifetime in seconds |
| `HEADLESS` | `true` | Set `false` to see the browser |
| `LOG_LEVEL` | `info` | `debug` for verbose output |
