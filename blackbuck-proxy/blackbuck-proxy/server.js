/**
 * ═══════════════════════════════════════════════════════════════
 *  Suprwise — Blackbuck GPS Proxy Server
 * ═══════════════════════════════════════════════════════════════
 *  Logs into fleet.blackbuck.com via headless browser,
 *  intercepts the vehicle API responses, and serves the data
 *  to the Suprwise frontend on localhost:3000
 * 
 *  Usage:
 *    1. cp .env.example .env  (fill in your credentials)
 *    2. npm install
 *    3. npm start
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ──
const CONFIG = {
  username: process.env.BLACKBUCK_USERNAME || '',
  password: process.env.BLACKBUCK_PASSWORD || '',
  url: process.env.BLACKBUCK_URL || 'https://fleet.blackbuck.com',
  port: parseInt(process.env.PORT || '3000'),
  cacheTTL: parseInt(process.env.CACHE_TTL || '120') * 1000,
  headless: process.env.HEADLESS !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info',
};

// ── Logger ──
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function log(level, ...args) {
  if (LEVELS[level] >= LEVELS[CONFIG.logLevel]) {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const prefix = { debug: '🔍', info: '📡', warn: '⚠️', error: '❌' };
    console.log(`${prefix[level] || ''} [${ts}] [${level.toUpperCase()}]`, ...args);
  }
}

// ── Cache ──
let vehicleCache = null;
let cacheTimestamp = 0;
let isFetching = false;
let browser = null;

function isCacheValid() {
  return vehicleCache && (Date.now() - cacheTimestamp < CONFIG.cacheTTL);
}

// ── Puppeteer: Login & Fetch ──
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

async function fetchFromBlackbuck() {
  if (!CONFIG.username || !CONFIG.password) {
    throw new Error('BLACKBUCK_USERNAME and BLACKBUCK_PASSWORD must be set in .env');
  }

  if (isFetching) {
    log('warn', 'Fetch already in progress, waiting…');
    await new Promise(r => setTimeout(r, 5000));
    if (isCacheValid()) return vehicleCache;
    throw new Error('Concurrent fetch timed out');
  }

  isFetching = true;
  let page;

  try {
    const b = await launchBrowser();
    page = await b.newPage();

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    const interceptedData = [];

    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // ── Intercept XHR/Fetch responses that contain vehicle data ──
    page.on('response', async res => {
      try {
        const url = res.url();
        const ct = res.headers()['content-type'] || '';
        
        // Capture any JSON API response that might contain vehicle data
        if (ct.includes('application/json') && res.status() === 200) {
          const text = await res.text().catch(() => '');
          if (!text) return;
          
          // Look for vehicle/fleet data patterns
          const lower = url.toLowerCase();
          const isVehicleEndpoint = 
            lower.includes('vehicle') || 
            lower.includes('fleet') || 
            lower.includes('track') ||
            lower.includes('device') ||
            lower.includes('asset') ||
            lower.includes('gps') ||
            lower.includes('location') ||
            lower.includes('telemetry');

          // Also check the response body for vehicle-like data
          const hasVehicleData = 
            text.includes('registration') || 
            text.includes('reg_no') ||
            text.includes('vehicle_no') ||
            text.includes('ignition') ||
            text.includes('odometer') ||
            text.includes('latitude') ||
            text.includes('speed');

          if (isVehicleEndpoint || hasVehicleData) {
            log('debug', `Captured API: ${url.slice(0, 100)}`);
            try {
              interceptedData.push({ url, data: JSON.parse(text) });
            } catch {}
          }
        }
      } catch {}
    });

    // ── Navigate to login page ──
    log('info', `Navigating to ${CONFIG.url}…`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // ── Detect if we need to login ──
    const currentUrl = page.url();
    const needsLogin = currentUrl.includes('login') || 
                       currentUrl.includes('sign') ||
                       await page.$('input[type="password"]') !== null;

    if (needsLogin) {
      log('info', 'Login required, entering credentials…');

      // Try common login form patterns
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[name="phone"]',
        'input[name="mobile"]',
        'input[type="email"]',
        'input[type="tel"]',
        'input[placeholder*="phone" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="mobile" i]',
        'input[placeholder*="username" i]',
        'input[placeholder*="number" i]',
      ];

      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        'input[placeholder*="password" i]',
      ];

      // Find and fill username
      let usernameField = null;
      for (const sel of usernameSelectors) {
        usernameField = await page.$(sel);
        if (usernameField) { log('debug', `Username field: ${sel}`); break; }
      }

      // Find and fill password
      let passwordField = null;
      for (const sel of passwordSelectors) {
        passwordField = await page.$(sel);
        if (passwordField) { log('debug', `Password field: ${sel}`); break; }
      }

      if (!usernameField || !passwordField) {
        // Take a screenshot for debugging
        await page.screenshot({ path: 'debug-login.png', fullPage: true });
        throw new Error('Could not find login form fields. Check debug-login.png');
      }

      // Clear and type credentials
      await usernameField.click({ clickCount: 3 });
      await usernameField.type(CONFIG.username, { delay: 50 });
      await sleep(500);
      await passwordField.click({ clickCount: 3 });
      await passwordField.type(CONFIG.password, { delay: 50 });
      await sleep(500);

      // Click submit button
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("Sign In")',
        'button:has-text("Log In")',
        'button:has-text("Submit")',
        'button:has-text("Continue")',
        '[class*="login" i] button',
        '[class*="submit" i]',
      ];

      let submitted = false;
      for (const sel of submitSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            submitted = true;
            log('debug', `Clicked submit: ${sel}`);
            break;
          }
        } catch {}
      }

      if (!submitted) {
        // Try pressing Enter as fallback
        await page.keyboard.press('Enter');
        log('debug', 'Pressed Enter to submit');
      }

      // Wait for navigation after login
      log('info', 'Waiting for post-login page…');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await sleep(3000);

      // Check for login errors
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (pageText.toLowerCase().includes('invalid') || 
          pageText.toLowerCase().includes('incorrect') ||
          pageText.toLowerCase().includes('wrong password')) {
        throw new Error('Login failed — check your credentials in .env');
      }

      log('info', 'Login successful!');
    } else {
      log('info', 'Already authenticated, skipping login.');
    }

    // ── Wait for dashboard data to load ──
    log('info', 'Waiting for fleet data to load…');
    await sleep(5000);

    // Scroll the page to trigger lazy-loaded content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(2000);

    // ── Parse intercepted vehicle data ──
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

    // ── Fallback: scrape from DOM if no API data captured ──
    if (!vehicles.length) {
      log('warn', 'No API data intercepted, attempting DOM scrape…');
      vehicles = await scrapeVehiclesFromDOM(page);
    }

    // ── Last resort: screenshot for debugging ──
    if (!vehicles.length) {
      await page.screenshot({ path: 'debug-dashboard.png', fullPage: true });
      log('warn', 'No vehicles found. Check debug-dashboard.png for the page state.');
    }

    log('info', `Fetched ${vehicles.length} vehicles total`);

    // Close page but keep browser alive for session reuse
    await page.close();

    vehicleCache = vehicles;
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

// ── Vehicle data extraction from arbitrary JSON ──
function extractVehicles(obj, depth = 0) {
  if (depth > 5 || !obj) return [];
  const results = [];

  // If it's an array, check each item
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (isVehicleObject(item)) {
        results.push(normalizeVehicle(item));
      } else {
        results.push(...extractVehicles(item, depth + 1));
      }
    }
    return results;
  }

  // If it's an object, check if it IS a vehicle, or search its values
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
  // Must have some kind of registration/vehicle identifier
  const hasReg = keys.some(k => 
    k.includes('reg') || k.includes('vehicle_no') || k.includes('vehicleno') || 
    k.includes('number_plate') || k.includes('registration') || k.includes('rc_no')
  );
  // And some kind of GPS/telemetry data
  const hasTelemetry = keys.some(k => 
    k.includes('lat') || k.includes('lng') || k.includes('lon') || 
    k.includes('speed') || k.includes('ignition') || k.includes('odometer') ||
    k.includes('location') || k.includes('gps')
  );
  return hasReg || (hasTelemetry && Object.keys(obj).length >= 3);
}

function normalizeVehicle(raw) {
  const find = (...patterns) => {
    for (const [key, val] of Object.entries(raw)) {
      const k = key.toLowerCase();
      for (const p of patterns) {
        if (k.includes(p) && val !== null && val !== undefined) return val;
      }
    }
    return null;
  };

  const reg = String(find('reg', 'vehicle_no', 'vehicleno', 'number_plate', 'registration', 'rc_no') || '')
    .replace(/[^A-Z0-9]/gi, '').toUpperCase();

  const lat = parseFloat(find('lat', 'latitude')) || null;
  const lng = parseFloat(find('lng', 'lon', 'longitude')) || null;
  const speed = parseFloat(find('speed', 'velocity', 'current_speed')) || 0;
  const ignition = find('ignition', 'ign', 'engine_status');
  const odometer = parseFloat(find('odometer', 'odo', 'total_distance', 'km_driven')) || null;
  const battery = parseFloat(find('battery', 'batt', 'voltage', 'device_battery')) || null;
  const fuelLevel = parseFloat(find('fuel', 'fuel_level', 'fuel_percent')) || null;
  const heading = parseFloat(find('heading', 'bearing', 'direction', 'course')) || null;
  const lastUpdate = find('last_update', 'updated_at', 'timestamp', 'gps_time', 'last_seen');
  const address = find('address', 'location_name', 'place', 'location_address');

  return {
    reg,
    lat,
    lng,
    speed,
    ignition: typeof ignition === 'boolean' ? (ignition ? 'ON' : 'OFF') : 
              typeof ignition === 'number' ? (ignition ? 'ON' : 'OFF') :
              String(ignition || '').toUpperCase().includes('ON') ? 'ON' : 'OFF',
    odometer,
    battery,
    fuelLevel,
    heading,
    lastUpdate: lastUpdate ? String(lastUpdate) : null,
    address: address ? String(address) : null,
  };
}

function mergeVehicles(existing, newOnes) {
  const map = new Map(existing.map(v => [v.reg, v]));
  for (const v of newOnes) {
    if (!v.reg) continue;
    const prev = map.get(v.reg);
    if (prev) {
      // Merge: prefer non-null values from new data
      for (const [k, val] of Object.entries(v)) {
        if (val !== null && val !== undefined && val !== 0 && val !== '') {
          prev[k] = val;
        }
      }
    } else {
      map.set(v.reg, v);
    }
  }
  return [...map.values()];
}

// ── DOM scraping fallback ──
async function scrapeVehiclesFromDOM(page) {
  return page.evaluate(() => {
    const vehicles = [];
    // Try to find any table rows, cards, or list items with vehicle data
    const allText = document.body.innerText;
    
    // Look for Indian vehicle registration pattern: XX00XX0000
    const regPattern = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4})\b/gi;
    const matches = allText.match(regPattern) || [];
    
    for (const match of [...new Set(matches)]) {
      const reg = match.replace(/\s/g, '').toUpperCase();
      if (reg.length >= 6 && reg.length <= 12) {
        vehicles.push({
          reg,
          ignition: 'OFF',
          odometer: null,
          lat: null,
          lng: null,
          speed: 0,
          battery: null,
          fuelLevel: null,
          heading: null,
          lastUpdate: null,
          address: null,
        });
      }
    }
    
    return vehicles;
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════

// Main endpoint — called by Suprwise frontend
app.get('/api/fetch-blackbuck', async (req, res) => {
  try {
    // Return cache if fresh
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

// Force refresh (bypass cache)
app.get('/api/fetch-blackbuck/refresh', async (req, res) => {
  try {
    vehicleCache = null;
    cacheTimestamp = 0;
    const vehicles = await fetchFromBlackbuck();
    res.json({ success: true, vehicles, cached: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    cached: isCacheValid(),
    vehicleCount: vehicleCache ? vehicleCache.length : 0,
    lastFetch: cacheTimestamp ? new Date(cacheTimestamp).toLocaleString('en-IN') : 'never',
    uptime: Math.floor(process.uptime()) + 's',
  });
});

// Manual vehicle data injection (for testing)
app.post('/api/vehicles/mock', (req, res) => {
  const { count = 5 } = req.body;
  const regs = ['OD02AY8703', 'OD05BF4521', 'OD09AB1234', 'JH01CK7890', 'CG04DH5678'];
  const makes = ['Liebherr LTM 1050', 'ACE Hydra', 'Escorts 14T', 'Terex HC-40', 'Sany STC-75'];
  
  vehicleCache = Array.from({ length: Math.min(count, 20) }, (_, i) => ({
    reg: regs[i % regs.length] || `OD${String(i).padStart(2,'0')}XX${String(1000+i)}`,
    ignition: Math.random() > 0.4 ? 'ON' : 'OFF',
    odometer: Math.round(10000 + Math.random() * 80000),
    speed: Math.round(Math.random() * 60),
    lat: 20.29 + Math.random() * 0.1,
    lng: 85.82 + Math.random() * 0.1,
    battery: (11 + Math.random() * 3).toFixed(1),
    fuelLevel: Math.round(Math.random() * 100),
    heading: Math.round(Math.random() * 360),
    lastUpdate: new Date().toISOString(),
    address: ['Chandrasekharpur, BBSR', 'Patia, BBSR', 'IDCO Jharsuguda', 'Rourkela Steel Plant', 'Paradip Port'][i % 5],
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
