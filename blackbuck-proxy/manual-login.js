/**
 * ═══════════════════════════════════════════════════════
 *  Suprwise — Manual Login Mode
 * ═══════════════════════════════════════════════════════
 *  Opens a VISIBLE browser where YOU log in manually.
 *  Once logged in, it captures the Bearer token from
 *  request headers and polls the Blackbuck API directly.
 *
 *  Usage:
 *    npm install
 *    node manual-login.js
 *
 *  Then log in to Blackbuck in the browser window.
 *  Once on the dashboard:
 *    curl http://localhost:3000/api/fetch-blackbuck
 * ═══════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

// Use existing Chromium (from Playwright cache or system)
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000');
const BLACKBUCK_URL = process.env.BLACKBUCK_URL || 'https://fleet.blackbuck.com';

let browser = null;
let page = null;
let vehicleCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2000; // 2 seconds (real-time mode)

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║  Suprwise — Manual Login Mode                    ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  A browser will open. Log in to Blackbuck        ║');
console.log('║  manually (handle OTP, CAPTCHA, etc yourself).   ║');
console.log('║                                                  ║');
console.log('║  Once on the dashboard, come back here —         ║');
console.log('║  the server will auto-capture vehicle data.      ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

async function init() {
  // puppeteer-extra wraps puppeteer-core; pass executablePath explicitly
  puppeteer.use(StealthPlugin());
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,900',
      `--user-data-dir=${path.join(__dirname, 'puppeteer_data')}`, // Persistent session
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  page = await browser.newPage();

  let lastBlackbuckToken = null;
  const intercepted = [];

  await page.setRequestInterception(true);

  // Capture Bearer token + block heavy resources
  page.on('request', req => {
    const url = req.url();
    const headers = req.headers();

    if (url.includes('blackbuck.com') && headers['authorization']) {
      lastBlackbuckToken = headers['authorization'];
      console.log('🔑 Captured Blackbuck Bearer Token');
    }

    const type = req.resourceType();
    if (['image', 'font', 'media'].includes(type)) req.abort();
    else req.continue();
  });

  // Intercept vehicle/GPS JSON responses
  page.on('response', async res => {
    try {
      const url = res.url();
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('application/json') && res.status() === 200) {
        const text = await res.text().catch(() => null);
        if (!text) return;

        if (
          text.includes('vehicle') || text.includes('reg') ||
          text.includes('ignition') || text.includes('latitude') ||
          text.includes('odometer') || text.includes('fleet') ||
          text.includes('truck') || text.includes('gps')
        ) {
          try {
            const data = JSON.parse(text);
            intercepted.push({ url, data: JSON.parse(JSON.stringify(data)), time: Date.now() });
            console.log(`📡 Captured: ${url.slice(0, 80)}…`);
          } catch (e) {}
        }
      }
    } catch (e) {}
  });

  console.log(`🌐 Opening ${BLACKBUCK_URL}…`);
  console.log('   👉 LOG IN MANUALLY in the browser window');
  console.log('   👉 Navigate to the fleet/vehicles dashboard');
  console.log('   👉 Then test with: curl http://localhost:3000/api/fetch-blackbuck');
  console.log('');

  await page.goto(BLACKBUCK_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('⏳ Waiting for manual login… Please log in to Blackbuck in the browser window.');

  // ── Helpers ──

  function normalize(raw) {
    const get = (key) => {
      if (raw[key] !== undefined && raw[key] !== null) return raw[key];
      if (raw.truck && raw.truck[key] !== undefined) return raw.truck[key];
      const lowerKey = key.toLowerCase();
      for (const [k, v] of Object.entries(raw)) {
        if (k.toLowerCase() === lowerKey) return v;
      }
      return null;
    };

    const regRaw =
      get('truck_no') || get('truckNo') || get('vehicle_no') ||
      get('reg_no') || get('registration_number') || get('registration') || '';
    const cleanReg = String(regRaw).replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (cleanReg.length < 5) return { reg: '' };

    return {
      reg: cleanReg,
      lat: parseFloat(get('latitude') || get('lat')) || null,
      lng: parseFloat(get('longitude') || get('lng')) || null,
      speed: parseFloat(get('current_speed') || get('speed') || 0),
      ignition: (() => {
        const v = get('ignition_status') || get('ignition') || get('engine_status') || get('engine');
        if (v === 'ON' || v === 'OFF') return v;
        if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
        const s = String(v || '').toUpperCase();
        return s.includes('ON') || s.includes('RUN') ? 'ON' : 'OFF';
      })(),
      odometer: parseFloat(get('odometer') || get('total_distance') || get('travelled_today')) || null,
      battery: parseFloat(get('battery') || get('voltage') || get('battery_level')) || null,
      fuelLevel: parseFloat(get('fuel_level') || get('fuel')) || null,
      heading: parseFloat(get('heading') || get('course') || get('direction')) || null,
      lastUpdate: get('last_updated_on_format') || get('last_updated') || get('last_seen') || get('timestamp'),
      status: get('gps_status') || get('status') || 'UNKNOWN',
      stoppedSince: get('gps_status_since') || null,
      address: get('address') || get('location'),
    };
  }

  function findVehicles(obj, results, seen, depth) {
    if (depth > 5 || !obj) return;
    if (Array.isArray(obj)) {
      for (const item of obj) findVehicles(item, results, seen, depth + 1);
      return;
    }
    if (typeof obj !== 'object') return;

    const keys = Object.keys(obj).map(k => k.toLowerCase());
    const regKey = keys.find(
      k => k === 'truck_no' || k === 'reg_no' || k === 'vehicleno' ||
           k === 'truckno' || k === 'registration_number'
    );

    if (regKey) {
      const v = normalize(obj);
      if (v.reg && v.reg.length >= 6 && !seen.has(v.reg)) {
        seen.add(v.reg);
        results.push(v);
      }
    } else {
      for (const val of Object.values(obj)) {
        if (typeof val === 'object' && val !== null) findVehicles(val, results, seen, depth + 1);
      }
    }
  }

  function extractVehicles() {
    const vehicleMap = new Map();

    const mergeVehicle = (v) => {
      if (!v.reg) return;
      if (!vehicleMap.has(v.reg)) {
        vehicleMap.set(v.reg, v);
      } else {
        const existing = vehicleMap.get(v.reg);
        for (const key in v) {
          if ((existing[key] === null || existing[key] === 0 || existing[key] === 'OFF') && v[key] !== null) {
            existing[key] = v[key];
          }
        }
      }
    };

    for (const { url, data } of intercepted) {
      if (url.includes('gps/tracking/details') && data && Array.isArray(data.list)) {
        for (const item of data.list) mergeVehicle(normalize(item));
      }
    }

    for (const { url, data } of intercepted) {
      if (url.includes('activegps') && data && Array.isArray(data.data)) {
        for (const item of data.data) {
          const rawTruck = item.truck || {};
          mergeVehicle(normalize({ ...item, truck_no: rawTruck.truckNo, battery: rawTruck.batteryVoltage }));
        }
      }
    }

    const results = [];
    const seen = new Set();
    for (const { data } of intercepted) findVehicles(data, results, seen, 0);
    results.forEach(v => mergeVehicle(v));

    return Array.from(vehicleMap.values());
  }

  // ── Real-time polling loop (1s) ──
  let lastHeartbeat = Date.now();
  const HEARTBEAT_INTERVAL = 15 * 60 * 1000;

  setInterval(async () => {
    if (!page || page.isClosed()) return;
    try {
      if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL) {
        lastHeartbeat = Date.now();
        console.log('💓 Heartbeat: Refreshing dashboard to keep session alive…');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        return;
      }

      if (!lastBlackbuckToken) return;

      const data = await page.evaluate(async (token) => {
        try {
          const res = await fetch(
            'https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200',
            { headers: { Authorization: token, Accept: 'application/json' } }
          );
          return res.ok ? await res.json() : { error: res.status };
        } catch (e) { return null; }
      }, lastBlackbuckToken);

      if (data && Array.isArray(data.list) && data.list.length > 0) {
        const lastTime = intercepted.length ? intercepted[intercepted.length - 1].time : 0;
        if (Date.now() - lastTime > 800) {
          intercepted.push({
            url: 'https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?auto=true',
            data,
            time: Date.now(),
          });
          if (intercepted.length > 50) intercepted.shift();

          const vehicles = extractVehicles().filter(v => v.reg);
          if (vehicles.length > 0) {
            vehicleCache = vehicles;
            cacheTimestamp = Date.now();
            console.log(`📍 Cache updated: ${vehicles.length} vehicles`);
          }
        }
      } else if (data && data.error === 401) {
        console.log('⚠️ Token expired (401). Please log in again in the browser.');
        lastBlackbuckToken = null;
      }
    } catch (err) {}
  }, 1000);

  // ── Endpoints ──

  app.get('/api/fetch-blackbuck', async (req, res) => {
    // On-demand instant fetch using captured token
    if (lastBlackbuckToken && page && !page.isClosed()) {
      try {
        const data = await page.evaluate(async (token) => {
          const r = await fetch(
            'https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200',
            { headers: { Authorization: token, Accept: 'application/json' } }
          );
          return r.ok ? await r.json() : null;
        }, lastBlackbuckToken);

        if (data && Array.isArray(data.list)) {
          const refreshed = data.list.map(raw => normalize(raw)).filter(v => v.reg);
          vehicleCache = refreshed;
          cacheTimestamp = Date.now();
          console.log(`⚡ Fetched ${refreshed.length} vehicles via token`);
          return res.json({ success: true, vehicles: refreshed, realTime: true });
        }
      } catch (e) {
        console.log(`⚠️ Direct fetch failed, using cache: ${e.message}`);
      }
    }

    const vehicles = (vehicleCache || []).filter(v => v.reg);
    if (vehicles.length && Date.now() - cacheTimestamp < CACHE_TTL) {
      return res.json({ success: true, vehicles, realTime: true });
    }

    // DOM fallback
    if (!page || page.isClosed()) {
      return res.json({ success: false, error: 'Browser is closed. Please restart.' });
    }

    try {
      const regs = await page.evaluate(() => {
        const text = document.body.innerText;
        const regPattern = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4})\b/gi;
        return [...new Set((text.match(regPattern) || []).map(m => m.replace(/\s/g, '').toUpperCase()))];
      });

      if (regs.length) {
        const scraped = regs
          .filter(r => r.length >= 6 && r.length <= 12)
          .map(reg => ({
            reg, ignition: 'OFF', odometer: null, speed: 0,
            lat: null, lng: null, battery: null, fuelLevel: null,
            heading: null, lastUpdate: null, address: null,
          }));
        console.log(`📄 Scraped ${scraped.length} registrations from page DOM`);
        return res.json({ success: true, vehicles: scraped, scraped: true });
      }

      res.json({
        success: false,
        error: 'No vehicle data captured yet. Log in and navigate to the fleet dashboard.',
      });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.get('/api/fetch-blackbuck/refresh', async (req, res) => {
    try {
      console.log('🔄 Reloading dashboard…');
      await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 3000));
      const vehicles = extractVehicles().filter(v => v.reg);
      res.json({ success: true, vehicles });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'running',
      mode: 'manual-login',
      currentUrl: page ? page.url() : 'unknown',
      tokenPresent: !!lastBlackbuckToken,
      capturedApis: intercepted.length,
      vehicleCount: vehicleCache ? vehicleCache.length : 0,
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now(),
    });
  });

  app.get('/api/system/status', (req, res) => {
    const lastResponses = intercepted.slice(-5);
    const hasError = lastResponses.some(
      r => r.data && (r.data.error || String(r.data.message || '').toLowerCase().includes('unauthorized'))
    );
    res.json({
      active: !!(page && !page.isClosed()),
      url: page ? page.url() : null,
      tokenPresent: !!lastBlackbuckToken,
      lastCapture: intercepted.length ? new Date(intercepted[intercepted.length - 1].time).toISOString() : null,
      sessionHealth: hasError ? 'ERROR_REQUIRED_LOGIN' : 'OK',
      memoryUsage: process.memoryUsage().rss,
    });
  });

  app.get('/api/debug/captured', (req, res) => {
    res.json({
      count: intercepted.length,
      apis: intercepted.map(d => ({
        url: d.url,
        time: new Date(d.time).toLocaleTimeString(),
        dataPreview: JSON.stringify(d.data).slice(0, 200),
      })),
    });
  });

  app.get('/api/debug/inspect', (req, res) => {
    const urlPart = req.query.url || 'tracking/details';
    const match = intercepted.find(d => d.url.includes(urlPart));
    if (match) return res.json(match.data);
    res.status(404).json({ error: 'No matching captured API found' });
  });

  app.get('/api/debug/token', (req, res) => {
    res.json({ token: lastBlackbuckToken });
  });

  app.post('/api/login/start', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });
    try {
      console.log(`\n📲 Navigating to login page for: ${phone}`);
      if (!page || page.isClosed()) page = await browser.newPage();
      await page.goto(BLACKBUCK_URL, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2000));
      const phoneSelectors = [
        'input[type="tel"]', 'input[name="phone"]',
        'input[placeholder*="phone" i]', 'input[placeholder*="mobile" i]',
      ];
      let phoneField = null;
      for (const sel of phoneSelectors) {
        phoneField = await page.$(sel);
        if (phoneField) break;
      }
      if (!phoneField) return res.json({ success: false, error: 'Could not find phone input field.' });
      await phoneField.click({ clickCount: 3 });
      await phoneField.type(phone, { delay: 100 });
      const submitSelectors = ['button[type="submit"]', 'button'];
      let submitted = false;
      for (const sel of submitSelectors) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); submitted = true; break; }
      }
      if (!submitted) await page.keyboard.press('Enter');
      res.json({ success: true, message: 'Phone submitted. Please complete login in the browser.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 Proxy running on http://localhost:${PORT}`);
    console.log(`   Health:  curl http://localhost:${PORT}/api/health`);
    console.log(`   Fetch:   curl http://localhost:${PORT}/api/fetch-blackbuck`);
    console.log(`   Token:   curl http://localhost:${PORT}/api/debug/token`);
    console.log(`   Debug:   curl http://localhost:${PORT}/api/debug/captured`);
    console.log('');
    console.log('   👉 Log into Blackbuck in the browser, then use the endpoints above!');
    console.log('');
  });
}

init().catch(err => {
  console.error('❌ Failed to start:', err.message);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down…');
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
