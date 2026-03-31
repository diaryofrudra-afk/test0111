/**
 * ═══════════════════════════════════════════════════════
 *  Suprwise — Manual Login Mode
 * ═══════════════════════════════════════════════════════
 *  If automatic login fails (OTP required, CAPTCHA, etc),
 *  this opens a VISIBLE browser where YOU log in manually.
 *  Once logged in, it captures vehicle data automatically.
 * 
 *  Usage:  node manual-login.js
 * ═══════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const axios = require('axios');

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
const CACHE_TTL = 2000; // 2 seconds (Real-Time mode)

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║  Suprwise — Manual Login Mode                    ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  A browser will open. Log in to Blackbuck        ║');
console.log('║  manually (handle OTP, CAPTCHA, etc yourself).   ║');
console.log('║                                                  ║');
console.log('║  Once on the dashboard, come back here and       ║');
console.log('║  the server will auto-capture vehicle data.      ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('');

async function init() {
  browser = await puppeteer.launch({
    headless: false, // Switch back to visible browser for stability
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--window-size=1280,900',
      `--user-data-dir=${path.join(__dirname, 'puppeteer_data')}` // Persistent session
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  page = await browser.newPage();

  let lastBlackbuckToken = null;

  // ── Intercept all API responses ──
  const intercepted = [];
  await page.setRequestInterception(true);
  
  page.on('request', req => {
    const url = req.url();
    const headers = req.headers();
    
    // Capture the Blackbuck Bearer token
    if (url.includes('blackbuck.com') && headers['authorization']) {
        lastBlackbuckToken = headers['authorization'];
        console.log('🔑 Captured Blackbuck Bearer Token');
    }

    const type = req.resourceType();
    if (['image', 'font', 'media'].includes(type)) req.abort();
    else req.continue();
  });

  page.on('response', async res => {
    try {
      const url = res.url();
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('application/json') && res.status() === 200) {
        // Use a safe way to get text that won't throw if frame is gone
        const text = await res.text().catch(() => null);
        if (!text) return;

        if (text.includes('vehicle') || text.includes('reg') || 
            text.includes('ignition') || text.includes('latitude') ||
            text.includes('odometer') || text.includes('fleet') ||
            text.includes('truck') || text.includes('gps')) {
          try {
            const data = JSON.parse(text);
            // Store a DEEP CLONE of the data immediately
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

  // ── Automated Login ──
  try {
    console.log('🔄 Attempting automated login…');
    await new Promise(r => setTimeout(r, 5000));

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('sign-in') || currentUrl.includes('auth')) {
        console.log('   📍 On login page, attempting to find "Login with password"…');
        // Simple click attempt
        try {
            const elements = await page.$$('div, span, button, a');
            for (const el of elements) {
                const content = await page.evaluate(e => e.textContent, el).catch(() => '');
                if (content && content.includes('Login with password')) {
                    await el.click().catch(() => {});
                    await new Promise(r => setTimeout(r, 2000));
                    break;
                }
            }
        } catch (e) {}

        const phoneField = await page.$('input[type="tel"], input[name="phone"]').catch(() => null);
        if (phoneField) {
            await phoneField.click({ clickCount: 3 }).catch(() => {});
            await phoneField.type('7008693400', { delay: 100 }).catch(() => {});
            console.log('\n   👉 PLEASE ENTER PASSWORD MANUALLY IF NEEDED');
        }
    }

    console.log('   ⏳ Waiting for session stabilization…');
    await new Promise(r => setTimeout(r, 10000)); 
    
    if (!page.url().includes('gps')) {
       console.log('   🔄 Navigating to GPS dashboard…');
       await page.goto('https://blackbuck.com/boss/gps', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }

  } catch (err) {
    console.error('   ⚠️ Automation hint:', err.message);
  }

  // ── Vehicle extraction ──
  function extractVehicles() {
    const vehicleMap = new Map();

    // Helper to merge data into the map
    const mergeVehicle = (v) => {
      if (!v.reg) return;
      if (!vehicleMap.has(v.reg)) {
        vehicleMap.set(v.reg, v);
      } else {
        const existing = vehicleMap.get(v.reg);
        // Update only null/default values
        for (const key in v) {
          if ((existing[key] === null || existing[key] === 0 || existing[key] === 'OFF') && v[key] !== null) {
            existing[key] = v[key];
          }
        }
      }
    };

    // 1. Process tracking details first (best status/coords)
    for (const { url, data } of intercepted) {
      if (url.includes('gps/tracking/details') && data && Array.isArray(data.list)) {
        for (const item of data.list) {
          mergeVehicle(normalize(item));
        }
      }
    }

    // 2. Process activegps (good for battery/metadata)
    for (const { url, data } of intercepted) {
      if (url.includes('activegps') && data && Array.isArray(data.data)) {
        for (const item of data.data) {
          const rawTruck = item.truck || {};
          const v = normalize({
            ...item,
            truck_no: rawTruck.truckNo,
            battery: rawTruck.batteryVoltage
          });
          mergeVehicle(v);
        }
      }
    }
    
    // 3. Fallback for any other objects
    const results = [];
    const seen = new Set();
    for (const { data } of intercepted) {
      findVehicles(data, results, seen, 0);
    }
    results.forEach(v => mergeVehicle(v));

    return Array.from(vehicleMap.values());
  }

  function findVehicles(obj, results, seen, depth) {
    if (depth > 5 || !obj) return;
    if (Array.isArray(obj)) {
      for (const item of obj) findVehicles(item, results, seen, depth + 1);
      return;
    }
    if (typeof obj !== 'object') return;
    
    // Check for common registration keys
    const keys = Object.keys(obj).map(k => k.toLowerCase());
    const regKey = keys.find(k => k === 'truck_no' || k === 'reg_no' || k === 'vehicleno' || k === 'truckno' || k === 'registration_number');
    
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

  function normalize(raw) {
    const get = (key) => {
        if (raw[key] !== undefined && raw[key] !== null) return raw[key];
        // Deep check for truck object
        if (raw.truck && raw.truck[key] !== undefined) return raw.truck[key];
        
        const lowerKey = key.toLowerCase();
        for (const [k, v] of Object.entries(raw)) {
            if (k.toLowerCase() === lowerKey) return v;
        }
        return null;
    };

    const regRaw = get('truck_no') || get('truckNo') || get('vehicle_no') || get('reg_no') || get('registration_number') || get('registration') || '';
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
      dataAge: Math.round((Date.now() - (get('intercept_time') || Date.now())) / 1000)
    };
  }

  // ── Automated Login Endpoints ──
  
  // Step 1: Start login with phone number
  app.post('/api/login/start', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });

    try {
      console.log(`\n📲 Starting automated login for: ${phone}`);
      if (!page || page.isClosed()) {
          page = await browser.newPage();
      }
      
      await page.goto(BLACKBUCK_URL, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2000));

      // Find phone input
      const phoneSelectors = ['input[type="tel"]', 'input[name="phone"]', 'input[placeholder*="phone" i]', 'input[placeholder*="mobile" i]'];
      let phoneField = null;
      for (const sel of phoneSelectors) {
          phoneField = await page.$(sel);
          if (phoneField) break;
      }

      if (!phoneField) {
          await page.screenshot({ path: 'login-error.png' });
          return res.json({ success: false, error: 'Could not find phone input field. Check login-error.png' });
      }

      await phoneField.click({ clickCount: 3 });
      await phoneField.type(phone, { delay: 100 });
      
      // Click Get OTP / Submit
      const submitSelectors = ['button[type="submit"]', 'button:has-text("OTP")', 'button:has-text("Login")'];
      let submitted = false;
      for (const sel of submitSelectors) {
          const btn = await page.$(sel);
          if (btn) {
              await btn.click();
              submitted = true;
              break;
          }
      }
      
      if (!submitted) await page.keyboard.press('Enter');

      console.log('   ✅ Phone submitted, waiting for OTP input…');
      res.json({ success: true, message: 'OTP requested. Please check your phone.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── API endpoint ──
  app.get('/api/fetch-blackbuck', async (req, res) => {
    // [Agent 4 & 10] Real-Time Optimization: Trigger fresh fetch on-demand
    if (lastBlackbuckToken && page && !page.isClosed()) {
        try {
            const data = await page.evaluate(async (token) => {
                const r = await fetch("https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200", {
                    headers: { "Authorization": token, "Accept": "application/json" }
                });
                return r.ok ? await r.json() : null;
            }, lastBlackbuckToken);

            if (data && Array.isArray(data.list)) {
                const refreshed = data.list.map(raw => {
                    const v = normalize(raw);
                    v.intercept_time = Date.now();
                    return v;
                });
                vehicleCache = refreshed;
                cacheTimestamp = Date.now();
                console.log(`⚡ Real-Time Instant Fetch Success: ${refreshed.length} vehicles`);
            }
        } catch (e) {
            console.log(`⚠️ Real-Time Fetch failed, using cache: ${e.message}`);
        }
    }

    let vehicles = (vehicleCache || []).filter(v => v.reg && v.reg !== '');
    
    if (vehicles.length && (Date.now() - cacheTimestamp < CACHE_TTL)) {
      return res.json({ success: true, vehicles, realTime: true });
    }

    // Only attempt DOM scraping if NO intercepted data is found
    if (!page || page.isClosed()) {
        return res.json({ success: false, error: 'Browser/Page is closed. Please restart.' });
    }

    page.evaluate(() => {
      const text = document.body.innerText;
      const regPattern = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4})\b/gi;
      return [...new Set((text.match(regPattern) || []).map(m => m.replace(/\s/g, '').toUpperCase()))];
    }).then(regs => {
      if (regs.length) {
        const vehicles = regs.filter(r => r.length >= 6 && r.length <= 12).map(reg => ({
          reg, ignition: 'OFF', odometer: null, speed: 0,
          lat: null, lng: null, battery: null, fuelLevel: null,
          heading: null, lastUpdate: null, address: null,
        }));
        console.log(`\n📄 Scraped ${vehicles.length} registrations from page`);
        res.json({ success: true, vehicles, scraped: true });
      } else {
        console.log('\n⚠️  No vehicle data found yet.');
        console.log('   Make sure you are logged in and on the fleet dashboard.');
        console.log('   Navigate around the dashboard to trigger API calls.');
        res.json({ success: false, error: 'No vehicle data captured yet. Navigate to the fleet dashboard in the browser.' });
      }
    }).catch(err => {
      res.json({ success: false, error: err.message });
    });
  });

  // Refresh — reload the page to get fresh data
  app.get('/api/fetch-blackbuck/refresh', async (req, res) => {
    try {
      console.log('🔄 Reloading dashboard…');
      await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 5000));
      const vehicles = extractVehicles();
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
      capturedApis: intercepted.length,
      vehicleCount: vehicleCache ? vehicleCache.length : 0,
      uptime: Math.floor(process.uptime()),
      timestamp: Date.now()
    });
  });

  // [Agent 1 & 9] Detailed system status for Sentinel & Analyst
  app.get('/api/system/status', (req, res) => {
    const lastResponses = intercepted.slice(-5);
    const hasError = lastResponses.some(r => r.data && (r.data.error || r.data.message?.toLowerCase().includes('unauthorized')));
    
    res.json({
      active: !!(page && !page.isClosed()),
      url: page ? page.url() : null,
      tokenPresent: !!lastBlackbuckToken,
      lastCapture: intercepted.length ? new Date(intercepted[intercepted.length-1].time).toISOString() : null,
      sessionHealth: hasError ? 'ERROR_REQUIRED_LOGIN' : 'OK',
      memoryUsage: process.memoryUsage().rss
    });
  });

  // Debug — dump all captured API data
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
    if (match) {
      res.json(match.data);
    } else {
      res.status(404).json({ error: 'No matching captured API found' });
    }
  });

  app.get('/api/debug/token', (req, res) => {
    res.json({ token: lastBlackbuckToken });
  });

  // [Agent 4 & 8] High-speed polling and Session Heartbeat
  let lastHeartbeat = Date.now();
  const HEARTBEAT_INTERVAL = 15 * 60 * 1000; // 15 minutes

  setInterval(async () => {
    if (!page || page.isClosed()) return;
    
    try {
      // 1. Session Heartbeat (Agent 8)
      if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL) {
        lastHeartbeat = Date.now();
        console.log('💓 Heartbeat: Refreshing dashboard to maintain session...');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        return; // Skip poll on refresh
      }

      // 2. High-speed token polling (Agent 4)
      if (!lastBlackbuckToken) return;
      const data = await page.evaluate(async (token) => {
        try {
          const res = await fetch("https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200", {
            headers: { "Authorization": token, "Accept": "application/json" }
          });
          return res.ok ? await res.json() : { error: res.status };
        } catch (e) { return null; }
      }, lastBlackbuckToken);

      if (data && Array.isArray(data.list) && data.list.length > 0) {
        // [Agent 10] Simple State Deduplication
        const lastTime = intercepted.length ? intercepted[intercepted.length-1].time : 0;
        if (Date.now() - lastTime > 800) { // Safety gap to prevent noise
            intercepted.push({
                url: "https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?auto=true",
                data: data,
                time: Date.now()
            });
            if (intercepted.length > 50) intercepted.shift();

            // [Agent 6] Broadcaster: Push updates to backend
            const vehicles = extractVehicles().filter(v => v.reg && v.reg !== '');
            if (vehicles.length > 0) {
              axios.post('http://localhost:8000/api/gps/raw-push', { vehicles })
                .catch(() => {}); // Suppress errors if backend is down
            }
        }
      } else if (data && data.error === 401) {
        console.log('⚠️ [Agent 9] Token expired (401). RE-LOGIN REQUIRED.');
        lastBlackbuckToken = null;
      }
    } catch (err) {}
  }, 1000);

  app.listen(PORT, () => {
    console.log(`\n🚀 Proxy running on http://localhost:${PORT}`);
    console.log(`   Test: curl http://localhost:${PORT}/api/health`);
    console.log(`   Fetch: curl http://localhost:${PORT}/api/fetch-blackbuck`);
    console.log(`   Debug: curl http://localhost:${PORT}/api/debug/captured`);
    console.log('');
    console.log('   👉 Log into Blackbuck in the browser, then use Suprwise!');
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
