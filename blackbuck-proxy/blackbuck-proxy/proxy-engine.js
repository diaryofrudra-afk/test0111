/**
 * ═══════════════════════════════════════════════════════
 *  Suprwise — GPS PROXY ENGINE
 * ═══════════════════════════════════════════════════════
 *  High-performance automated login and real-time 
 *  telemetry extraction for Blackbuck Fleet.
 * ═══════════════════════════════════════════════════════
 */

require('dotenv').config({ path: '../.env' });
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
const BLACKBUCK_URL = 'https://blackbuck.com/boss/sign-in';
const PHONE = process.env.BLACKBUCK_PHONE;
const PASSWORD = process.env.BLACKBUCK_PASS;
const SUPRWISE_BACKEND = 'http://localhost:8000/api/gps/raw-push';

let browser = null;
let page = null;
let lastBlackbuckToken = null;
let vehicleCache = [];
let cacheTimestamp = 0;
let loginStatus = 'INITIALIZING';

/**
 * Handles the automated credential-based login flow.
 */
async function performAutomatedLogin() {
    if (!PHONE || !PASSWORD) {
        console.error('❌ Configuration Error: Missing BLACKBUCK_PHONE or BLACKBUCK_PASS in .env');
        loginStatus = 'ERROR_CONFIG';
        return false;
    }

    try {
        loginStatus = 'LOGGING_IN';
        console.log(`\n🔍 Synchronizing session with: ${BLACKBUCK_URL}`);

        // Champion Navigation (no wait)
        await page.goto(BLACKBUCK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 1. Enter Phone Number (Machine Gun Loop to catch paint)
        console.log('   👉 Triggering Phone loop...');
        for (let i = 0; i < 15; i++) {
            await page.mouse.click(500, 418);
            await new Promise(r => setTimeout(r, 100));
        }
        await page.keyboard.type(PHONE);

        // 2. Switch to Password Mode
        await page.mouse.click(500, 608);
        await new Promise(r => setTimeout(r, 500)); // Verified injection wait

        // 3. Enter Password (Focus Buffer)
        await page.mouse.click(500, 560);
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.type(PASSWORD);

        // 4. Submit (Champion Coordinate)
        await page.mouse.click(500, 706);

        // 5. Final Synchronization (Poll for Token)
        console.log('   🚀 Finalizing Protocol Link...');
        for (let i = 0; i < 60; i++) {
            if (lastBlackbuckToken) {
                console.log('   ✅ Speed-Champion Protocol Successful');
                loginStatus = 'LOGGED_IN';
                return true;
            }
            await new Promise(r => setTimeout(r, 100)); // Poll every 100ms
        }
        return false;
    } catch (err) {
        console.error('   ❌ Login sequence failed:', err.message);
        return false;
    }
}

/**
 * Initializes the proxy engine and starts real-time data lifecycle.
 */
async function initEngine() {
    console.log('\n🚀 Starting Suprwise GPS Engine...');

    browser = await puppeteer.launch({
        headless: process.env.HEADLESS === 'true',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1280,900',
            '--remote-debugging-port=9222',
            `--user-data-dir=${path.join(__dirname, 'puppeteer_data')}`
        ],
        defaultViewport: { width: 1280, height: 900 }
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Essential Interaction Layer
    await page.setRequestInterception(true);
    page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'font', 'media'].includes(type)) req.abort();
        else req.continue();
    });

    await performAutomatedLogin();
}

/**
 * Handles the automated credential-based login flow with direct memory-polling.
 */
async function performAutomatedLogin() {
    if (!PHONE || !PASSWORD) {
        console.error('❌ Configuration Error: Missing BLACKBUCK_PHONE or BLACKBUCK_PASS in .env');
        loginStatus = 'ERROR_CONFIG';
        return false;
    }

    try {
        loginStatus = 'LOGGING_IN';
        console.log(`\n🔍 Synchronizing session with: ${BLACKBUCK_URL}`);

        await page.goto(BLACKBUCK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Phase 0: Vitality Check (Already Logged In?)
        const existingToken = await page.evaluate(() => {
            return localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('accessToken');
        });

        if (existingToken) {
            lastBlackbuckToken = existingToken.startsWith('Token ') ? existingToken : `Token ${existingToken}`;
            console.log('   ✅ Active Session Detected (Protocol Link Restored)');
            loginStatus = 'LOGGED_IN';
            return true;
        }

        console.log('   🛠️ No active session. Executing Automated Protocol...');

        // 1. Phone Entry (Machine Gun Loop)
        for (let i = 0; i < 12; i++) {
            await page.mouse.click(500, 418);
            await new Promise(r => setTimeout(r, 100));
        }
        await page.keyboard.type(PHONE);

        // 2. Password Mode
        await page.mouse.click(500, 608);
        await new Promise(r => setTimeout(r, 500));

        // 3. Password Entry (Focus + Clear + Type)
        await page.mouse.click(500, 560);
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.down('Shift');
        await page.keyboard.press('Home'); // Select all to the left
        await page.keyboard.up('Shift');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(PASSWORD);

        // 4. Submit (Champion Interaction: Enter)
        console.log('   🚀 Triggering submission via ENTER');
        await page.keyboard.press('Enter');

        // 5. Final Victory: Memory Poll (localStorage)
        console.log('   🚀 Finalizing Protocol Link via Storage...');
        for (let i = 0; i < 40; i++) {
            const storageToken = await page.evaluate(() => {
                const raw = localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('accessToken');
                return raw ? raw : null;
            });

            if (storageToken) {
                // Formatting for Blackbuck API
                lastBlackbuckToken = storageToken.startsWith('Token ') ? storageToken : `Token ${storageToken}`;
                console.log('   ✅ Storage-Scrape Protocol Successful');
                loginStatus = 'LOGGED_IN';
                return true;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    } catch (err) {
        console.error('   ❌ Login sequence failed:', err.message);
        return false;
    }
}

/**
 * Real-time GPS synchronization loop (1s interval)
 */
setInterval(async () => {
    if (!page || page.isClosed() || !lastBlackbuckToken) return;

    try {
        const data = await page.evaluate(async (token) => {
            try {
                const r = await fetch("https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200", {
                    headers: { "Authorization": token, "Accept": "application/json" }
                });
                return r.ok ? await r.json() : { error: r.status };
            } catch (e) { return null; }
        }, lastBlackbuckToken);

        if (data && Array.isArray(data.list) && data.list.length > 0) {
            const refreshed = data.list.map(raw => normalize(raw));
            vehicleCache = refreshed;
            cacheTimestamp = Date.now();

            // Stream updates to Suprwise backend
            axios.post(SUPRWISE_BACKEND, { vehicles: refreshed }).catch(() => { });
        } else if (data && data.error === 401) {
            console.log('⚠️ Session expired (401). Re-logging...');
            await performAutomatedLogin();
        }
    } catch (err) { }
}, 1000);

// Activity Heartbeat (Every 10 min)
setInterval(async () => {
    if (page && !page.isClosed()) {
        console.log('💓 Session Heartbeat: Activity refresh');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
    }
}, 10 * 60 * 1000);

function normalize(raw) {
    const get = (key) => raw[key] !== undefined ? raw[key] : (raw.truck && raw.truck[key] !== undefined ? raw.truck[key] : null);
    const regRaw = get('truck_no') || get('reg_no') || '';
    const cleanReg = String(regRaw).replace(/[^A-Z0-9]/gi, '').toUpperCase();

    return {
        reg: cleanReg,
        lat: parseFloat(get('latitude')) || null,
        lng: parseFloat(get('longitude')) || null,
        speed: parseFloat(get('current_speed') || 0),
        ignition: get('ignition_status') || 'OFF',
        status: get('gps_status') || 'UNKNOWN',
        stoppedSince: get('gps_status_since') || null,
        lastUpdate: get('last_updated_on_format') || 'Just Now',
        address: get('address') || 'Fetching...',
        dataAge: 0
    };
}

app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        engine: 'Suprwise GPS Proxy',
        login: loginStatus,
        token: !!lastBlackbuckToken,
        vehicles: vehicleCache.length,
        uptime: Math.floor(process.uptime())
    });
});

app.get('/api/fetch-blackbuck', (req, res) => {
    res.json({ success: true, vehicles: vehicleCache, realTime: true });
});

app.listen(PORT, () => {
    console.log(`\n✅ Suprwise GPS Proxy live on http://localhost:${PORT}`);
    initEngine().catch(e => console.error('❌ Initialization failed:', e));
});

process.on('SIGINT', async () => {
    if (browser) await browser.close().catch(() => { });
    process.exit(0);
});
