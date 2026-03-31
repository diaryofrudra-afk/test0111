/**
 * ═══════════════════════════════════════════════════════════════
 *  Suprwise — Blackbuck GPS Proxy Server
 * ═══════════════════════════════════════════════════════════════
 *  Logs into fleet.blackbuck.com via headless browser,
 *  extracts the Bearer token, calls the GPS REST API directly,
 *  and serves full telemetry data to the Suprwise frontend.
 *
 *  Usage:
 *    1. cp .env.example .env  (fill in your credentials)
 *    2. npm install
 *    3. npm start
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ──
const CONFIG = {
  username:     process.env.BLACKBUCK_USERNAME || '',
  password:     process.env.BLACKBUCK_PASSWORD || '',
  url:          process.env.BLACKBUCK_URL      || 'https://fleet.blackbuck.com',
  fleetOwnerId: process.env.FLEET_OWNER_ID     || '5599426',
  pageSize:     parseInt(process.env.PAGE_SIZE || '200'),
  port:         parseInt(process.env.PORT      || '3000'),
  cacheTTL:     parseInt(process.env.CACHE_TTL || '120') * 1000,
  headless:     process.env.HEADLESS !== 'false',
  logLevel:     process.env.LOG_LEVEL || 'info',
};

// ── Logger ──
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function log(level, ...args) {
  if (LEVELS[level] >= LEVELS[CONFIG.logLevel]) {
    const ts     = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const prefix = { debug: '🔍', info: '📡', warn: '⚠️', error: '❌' };
    console.log(`${prefix[level] || ''} [${ts}] [${level.toUpperCase()}]`, ...args);
  }
}

// ── Cache ──
let vehicleCache   = null;
let cacheTimestamp = 0;
let isFetching     = false;
let browser        = null;
let lastBearerToken = null;   // captured from localStorage after login

function isCacheValid() {
  return vehicleCache && (Date.now() - cacheTimestamp < CONFIG.cacheTTL);
}

// ── Puppeteer: launch browser ──
async function launchBrowser() {
  if (browser) {
    try { await browser.pages(); return browser; }
    catch { browser = null; }
  }
  log('info', 'Launching headless browser…');
  browser = await puppeteer.launch({
    headless: CONFIG.headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  return browser;
}

// ── Direct REST API call using captured Bearer token ──
async function fetchFromBlackbuckAPI(page, token) {
  const url =
    `https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details` +
    `?fleet_owner_id=${CONFIG.fleetOwnerId}&page_number=0&page_size=${CONFIG.pageSize}&status=All`;

  const result = await page.evaluate(async (apiUrl, authToken) => {
    try {
      const r = await fetch(apiUrl, {
        headers: { 'Authorization': authToken, 'Accept': 'application/json' },
      });
      if (!r.ok) return { error: r.status };
      return await r.json();
    } catch (e) { return { error: String(e) }; }
  }, url, token);

  if (result?.error === 401) {
    lastBearerToken = null;   // force re-login on next request
    throw new Error('Token expired (401) — will re-login on next request');
  }
  if (result?.error) throw new Error(`API error: ${result.error}`);

  const list = result.list || result.data || result.vehicles || [];
  return { raw: result, vehicles: list.map(normalizeVehicle) };
}

// ── Main fetch: login + token extraction + API call ──
async function fetchFromBlackbuck() {
  if (!CONFIG.username || !CONFIG.password) {
    throw new Error('BLACKBUCK_USERNAME and BLACKBUCK_PASSWORD must be set in .env');
  }

  if (isFetching) {
    log('warn', 'Fetch already in progress, waiting…');
    await sleep(5000);
    if (isCacheValid()) return vehicleCache;
    throw new Error('Concurrent fetch timed out');
  }

  isFetching = true;
  let page;

  try {
    const b = await launchBrowser();
    page = await b.newPage();

    // Block images/fonts/media for speed
    await page.setRequestInterception(true);
    const interceptedData = [];

    page.on('request', req => {
      const t = req.resourceType();
      if (['image', 'font', 'media'].includes(t)) req.abort();
      else req.continue();
    });

    // ── Intercept XHR/Fetch responses (fallback data source) ──
    page.on('response', async res => {
      try {
        const url = res.url();
        const ct  = res.headers()['content-type'] || '';
        if (!ct.includes('application/json') || res.status() !== 200) return;

        const text = await res.text().catch(() => '');
        if (!text) return;

        const lower = url.toLowerCase();
        const isVehicleEndpoint =
          lower.includes('vehicle')  || lower.includes('fleet')   ||
          lower.includes('track')    || lower.includes('device')  ||
          lower.includes('asset')    || lower.includes('gps')     ||
          lower.includes('location') || lower.includes('telemetry') ||
          lower.includes('api-fms')  || lower.includes('tracking/details');

        const hasVehicleData =
          text.includes('registration') || text.includes('reg_no')    ||
          text.includes('vehicle_no')   || text.includes('ignition')  ||
          text.includes('odometer')     || text.includes('latitude')  ||
          text.includes('speed');

        if (isVehicleEndpoint || hasVehicleData) {
          log('debug', `Captured API: ${url.slice(0, 100)}`);
          try { interceptedData.push({ url, data: JSON.parse(text) }); } catch {}
        }
      } catch {}
    });

    // ── Step 1: Check for existing session in localStorage ──
    log('info', `Navigating to ${CONFIG.url}…`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const existingToken = await page.evaluate(() =>
      localStorage.getItem('token')       ||
      sessionStorage.getItem('token')     ||
      localStorage.getItem('accessToken') ||
      localStorage.getItem('authToken')
    );

    if (existingToken) {
      lastBearerToken = existingToken.startsWith('Token ') ? existingToken : `Token ${existingToken}`;
      log('info', 'Existing session restored from localStorage');
    } else {
      // ── Step 2: Detect and perform login ──
      const currentUrl  = page.url();
      const needsLogin  =
        currentUrl.includes('login') || currentUrl.includes('sign') || currentUrl.includes('auth') ||
        await page.$('input[type="password"]') !== null ||
        await page.evaluate(() => document.body.innerText.includes('Login'));

      if (needsLogin) {
        log('info', 'Login required, entering credentials…');

        // Username / phone selectors
        const usernameSelectors = [
          'input[name="username"]', 'input[name="email"]', 'input[name="phone"]',
          'input[name="mobile"]',   'input[type="email"]', 'input[type="tel"]',
          'input[placeholder*="phone" i]',    'input[placeholder*="email" i]',
          'input[placeholder*="mobile" i]',   'input[placeholder*="username" i]',
          'input[placeholder*="number" i]',
        ];

        let usernameField = null;
        for (const sel of usernameSelectors) {
          usernameField = await page.$(sel);
          if (usernameField) { log('debug', `Username field: ${sel}`); break; }
        }

        if (!usernameField) {
          await page.screenshot({ path: 'debug-login.png', fullPage: true });
          throw new Error('Could not find phone/username field. See debug-login.png');
        }

        await usernameField.click({ clickCount: 3 });
        await usernameField.type(CONFIG.username, { delay: 50 });
        await sleep(500);

        // Switch to password mode — find button by text content (Puppeteer-compatible)
        const switched = await page.evaluate(() => {
          const els = [...document.querySelectorAll('button, [role="button"], span, a')];
          const btn = els.find(el => /login\s+with\s+password/i.test(el.textContent));
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (switched) {
          log('debug', 'Switched to password login mode');
          await sleep(800);
        }

        // Password field
        const passwordSelectors = [
          'input[name="password"]', 'input[type="password"]',
          'input[placeholder*="password" i]',
        ];
        let passwordField = null;
        for (const sel of passwordSelectors) {
          passwordField = await page.$(sel);
          if (passwordField) { log('debug', `Password field: ${sel}`); break; }
        }

        if (!passwordField) {
          await page.screenshot({ path: 'debug-login.png', fullPage: true });
          throw new Error('Could not find password field. See debug-login.png');
        }

        await passwordField.click({ clickCount: 3 });
        await passwordField.type(CONFIG.password, { delay: 50 });
        await sleep(500);

        // Submit — try button selectors, fall back to Enter
        const submitSelectors = [
          'button[type="submit"]', 'input[type="submit"]',
          'button', '[class*="submit" i]',
        ];
        let submitted = false;
        for (const sel of submitSelectors) {
          try {
            const btn = await page.$(sel);
            if (btn) {
              // Only click if it looks like a login button
              const text = await page.evaluate(el => el.textContent, btn);
              if (/login|sign\s*in|submit|continue/i.test(text)) {
                await btn.click();
                submitted = true;
                log('debug', `Clicked submit: ${sel} ("${text.trim()}")`);
                break;
              }
            }
          } catch {}
        }
        if (!submitted) {
          await page.keyboard.press('Enter');
          log('debug', 'Pressed Enter to submit');
        }

        // Wait for navigation
        log('info', 'Waiting for post-login page…');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
        await sleep(3000);

        // Check for error messages
        const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (/invalid|incorrect|wrong password/i.test(pageText)) {
          throw new Error('Login failed — check your credentials in .env');
        }

        log('info', 'Login successful!');

        // ── Step 3: Extract Bearer token from storage ──
        for (let i = 0; i < 40; i++) {
          const t = await page.evaluate(() =>
            localStorage.getItem('token')       ||
            sessionStorage.getItem('token')     ||
            localStorage.getItem('accessToken') ||
            localStorage.getItem('authToken')
          );
          if (t) {
            lastBearerToken = t.startsWith('Token ') ? t : `Token ${t}`;
            log('info', 'Bearer token captured from localStorage');
            break;
          }
          await sleep(200);
        }

        if (!lastBearerToken) {
          log('warn', 'Token not found in storage — will rely on response interception');
        }
      } else {
        log('info', 'Already authenticated, skipping login.');
      }
    }

    // ── Step 4: Prefer direct REST API call (most reliable + full data) ──
    if (lastBearerToken) {
      try {
        const { raw, vehicles } = await fetchFromBlackbuckAPI(page, lastBearerToken);
        log('info', `REST API: ${vehicles.length} vehicles (total: ${raw.total ?? '?'})`);
        if (vehicles.length > 0) {
          vehicleCache   = vehicles;
          cacheTimestamp = Date.now();
          await page.close();
          return vehicles;
        }
        log('warn', 'REST API returned 0 vehicles — falling back to interception');
      } catch (apiErr) {
        log('warn', `Direct API failed (${apiErr.message}) — falling back to interception`);
      }
    }

    // ── Step 5: Wait for dashboard and collect intercepted responses ──
    log('info', 'Waiting for fleet data to load…');
    await sleep(5000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(2000);

    let vehicles = [];

    if (interceptedData.length) {
      log('info', `Captured ${interceptedData.length} API responses, parsing…`);
      for (const { url, data } of interceptedData) {
        const found = extractVehicles(data);
        if (found.length) {
          log('info', `Found ${found.length} vehicles from: ${url.slice(0, 80)}`);
          vehicles = mergeVehicles(vehicles, found);
        }
      }
    }

    // ── Step 6: DOM scrape last resort ──
    if (!vehicles.length) {
      log('warn', 'No API data intercepted, attempting DOM scrape…');
      vehicles = await scrapeVehiclesFromDOM(page);
    }

    if (!vehicles.length) {
      await page.screenshot({ path: 'debug-dashboard.png', fullPage: true });
      log('warn', 'No vehicles found. Check debug-dashboard.png for the page state.');
    }

    log('info', `Fetched ${vehicles.length} vehicles total`);
    await page.close();

    vehicleCache   = vehicles;
    cacheTimestamp = Date.now();
    return vehicles;

  } catch (err) {
    log('error', 'Fetch failed:', err.message);
    if (page) await page.close().catch(() => {});
    throw err;
  } finally {
    isFetching = false;
  }
}

// ── Vehicle extraction from arbitrary JSON (for interception fallback) ──
function extractVehicles(obj, depth = 0) {
  if (depth > 5 || !obj) return [];
  const results = [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (isVehicleObject(item)) results.push(normalizeVehicle(item));
      else results.push(...extractVehicles(item, depth + 1));
    }
    return results;
  }
  if (typeof obj === 'object') {
    if (isVehicleObject(obj)) {
      results.push(normalizeVehicle(obj));
    } else {
      for (const val of Object.values(obj)) {
        if (typeof val === 'object' && val !== null) {
          results.push(...extractVehicles(val, depth + 1));
        }
      }
    }
  }
  return results;
}

function isVehicleObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj).map(k => k.toLowerCase());
  const hasReg = keys.some(k =>
    k.includes('reg') || k.includes('vehicle_no') || k.includes('vehicleno') ||
    k.includes('number_plate') || k.includes('registration') || k.includes('rc_no') ||
    k.includes('truck_no')
  );
  const hasTelemetry = keys.some(k =>
    k.includes('lat') || k.includes('lng') || k.includes('lon') ||
    k.includes('speed') || k.includes('ignition') || k.includes('odometer') ||
    k.includes('location') || k.includes('gps')
  );
  return hasReg || (hasTelemetry && Object.keys(obj).length >= 3);
}

// ── Comprehensive field normalizer (covers direct API + intercepted responses) ──
function normalizeVehicle(raw) {
  const truck = raw.truck || {};
  const g = (...keys) => {
    for (const k of keys) {
      const v = raw[k] !== undefined ? raw[k] : truck[k];
      if (v != null) return v;
    }
    return null;
  };

  const ignitionRaw = g('ignition_status', 'ignition', 'ign', 'engine_status');
  const ignition =
    typeof ignitionRaw === 'boolean' ? (ignitionRaw ? 'ON' : 'OFF') :
    typeof ignitionRaw === 'number'  ? (ignitionRaw ? 'ON' : 'OFF') :
    String(ignitionRaw || '').toUpperCase().includes('ON') ? 'ON' : 'OFF';

  return {
    // Identity
    reg:             String(g('truck_no', 'reg_no', 'vehicle_no', 'registration', 'number_plate', 'rc_no') || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(),
    truckId:         g('truck_id'),
    deviceId:        g('device_id'),
    simNo:           g('sim_no'),

    // GPS coordinates
    lat:             parseFloat(g('latitude',  'lat')) || null,
    lng:             parseFloat(g('longitude', 'lng', 'lon')) || null,
    altitude:        parseFloat(g('altitude')) || null,
    heading:         parseFloat(g('heading', 'bearing', 'direction', 'course')) || null,

    // Motion
    speed:           parseFloat(g('current_speed', 'speed', 'velocity') || 0),
    odometer:        parseFloat(g('odometer', 'odo', 'total_distance', 'km_driven', 'travelled_today')) || null,

    // Status
    ignition,
    gpsStatus:       g('gps_status') || 'UNKNOWN',
    stoppedSince:    g('gps_status_since'),
    networkStrength: g('network_strength'),
    gpsStrength:     g('gps_strength'),
    battery:         parseFloat(g('battery', 'batt', 'device_battery', 'voltage')) || null,
    fuelLevel:       parseFloat(g('fuel_level', 'fuel', 'fuel_percent')) || null,
    temperature:     parseFloat(g('temperature')) || null,

    // Location
    address:         g('address', 'location_name', 'place', 'location_address') ? String(g('address', 'location_name', 'place', 'location_address')) : null,
    city:            g('city')  ? String(g('city'))  : null,
    state:           g('state') ? String(g('state')) : null,

    // Timestamps
    lastUpdate:      g('last_updated_on_format', 'last_updated_on', 'last_update', 'updated_at', 'timestamp', 'last_seen') ? String(g('last_updated_on_format', 'last_updated_on', 'last_update', 'updated_at', 'timestamp', 'last_seen')) : null,
    lastGpsTime:     g('gps_time') ? String(g('gps_time')) : null,
  };
}

function mergeVehicles(existing, newOnes) {
  const map = new Map(existing.map(v => [v.reg, v]));
  for (const v of newOnes) {
    if (!v.reg) continue;
    const prev = map.get(v.reg);
    if (prev) {
      for (const [k, val] of Object.entries(v)) {
        if (val !== null && val !== undefined && val !== 0 && val !== '') prev[k] = val;
      }
    } else {
      map.set(v.reg, v);
    }
  }
  return [...map.values()];
}

// ── DOM scraping last resort ──
async function scrapeVehiclesFromDOM(page) {
  return page.evaluate(() => {
    const allText    = document.body.innerText;
    const regPattern = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4})\b/gi;
    const matches    = allText.match(regPattern) || [];
    return [...new Set(matches)]
      .map(m => m.replace(/\s/g, '').toUpperCase())
      .filter(r => r.length >= 6 && r.length <= 12)
      .map(reg => ({
        reg, ignition: 'OFF', gpsStatus: 'UNKNOWN', stoppedSince: null,
        lat: null, lng: null, altitude: null, heading: null,
        speed: 0, odometer: null, battery: null, fuelLevel: null,
        temperature: null, networkStrength: null, gpsStrength: null,
        address: null, city: null, state: null,
        lastUpdate: null, lastGpsTime: null,
        truckId: null, deviceId: null, simNo: null,
      }));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════

// Main endpoint
app.get('/api/fetch-blackbuck', async (req, res) => {
  try {
    if (isCacheValid()) {
      log('info', `Serving cached data (${vehicleCache.length} vehicles)`);
      return res.json({ success: true, vehicles: vehicleCache, cached: true });
    }
    const vehicles = await fetchFromBlackbuck();
    res.json({ success: true, vehicles, cached: false });
  } catch (err) {
    log('error', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force refresh
app.get('/api/fetch-blackbuck/refresh', async (req, res) => {
  try {
    vehicleCache   = null;
    cacheTimestamp = 0;
    const vehicles = await fetchFromBlackbuck();
    res.json({ success: true, vehicles, cached: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Raw API response — returns unfiltered BlackBuck API JSON for debugging
app.get('/api/fetch-blackbuck/raw', async (req, res) => {
  if (!lastBearerToken) {
    return res.status(401).json({
      error: 'No token yet — call /api/fetch-blackbuck first to trigger login',
    });
  }
  const b = await launchBrowser();
  const p = await b.newPage();
  try {
    const { raw } = await fetchFromBlackbuckAPI(p, lastBearerToken);
    res.json(raw);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await p.close().catch(() => {});
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status:       'running',
    token:        !!lastBearerToken,
    cached:       isCacheValid(),
    vehicleCount: vehicleCache ? vehicleCache.length : 0,
    lastFetch:    cacheTimestamp ? new Date(cacheTimestamp).toLocaleString('en-IN') : 'never',
    uptime:       Math.floor(process.uptime()) + 's',
  });
});

// Mock data injection (for testing)
app.post('/api/vehicles/mock', (req, res) => {
  const { count = 5 } = req.body;
  const regs = ['OD02AY8703', 'OD05BF4521', 'OD09AB1234', 'JH01CK7890', 'CG04DH5678'];

  vehicleCache = Array.from({ length: Math.min(count, 20) }, (_, i) => ({
    reg:            regs[i % regs.length] || `OD${String(i).padStart(2, '0')}XX${String(1000 + i)}`,
    truckId:        null, deviceId: null, simNo: null,
    ignition:       Math.random() > 0.4 ? 'ON' : 'OFF',
    gpsStatus:      'MOVING',
    stoppedSince:   null,
    odometer:       Math.round(10000 + Math.random() * 80000),
    speed:          Math.round(Math.random() * 60),
    lat:            20.29 + Math.random() * 0.1,
    lng:            85.82 + Math.random() * 0.1,
    altitude:       null, heading: Math.round(Math.random() * 360),
    battery:        parseFloat((11 + Math.random() * 3).toFixed(1)),
    fuelLevel:      Math.round(Math.random() * 100),
    temperature:    null, networkStrength: null, gpsStrength: null,
    address:        ['Chandrasekharpur, BBSR', 'Patia, BBSR', 'IDCO Jharsuguda', 'Rourkela Steel Plant', 'Paradip Port'][i % 5],
    city: null, state: 'Odisha',
    lastUpdate:     new Date().toISOString(),
    lastGpsTime:    null,
  }));
  cacheTimestamp = Date.now();

  log('info', `Injected ${vehicleCache.length} mock vehicles`);
  res.json({ success: true, vehicles: vehicleCache, mock: true });
});

// ── Startup ──
app.listen(CONFIG.port, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   Suprwise — Blackbuck GPS Proxy         ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║   Server:    http://localhost:${CONFIG.port}        ║`);
  console.log(`  ║   Endpoint:  /api/fetch-blackbuck         ║`);
  console.log(`  ║   Raw API:   /api/fetch-blackbuck/raw     ║`);
  console.log(`  ║   Health:    /api/health                  ║`);
  console.log(`  ║   Mock data: POST /api/vehicles/mock      ║`);
  console.log(`  ║   Headless:  ${CONFIG.headless ? 'yes' : 'NO (visible browser)'}                    ║`);
  console.log(`  ║   Cache TTL: ${CONFIG.cacheTTL / 1000}s                          ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  if (!CONFIG.username || !CONFIG.password) {
    console.log('  ⚠️  No credentials set! Copy .env.example → .env');
    console.log('     You can still test with: POST /api/vehicles/mock');
    console.log('');
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  log('info', 'Shutting down…');
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
