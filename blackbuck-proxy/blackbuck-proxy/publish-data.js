const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function publishData() {
    console.log('\n📊 Data Publication Agent Starting...');
    console.log('   👉 Opening browser with existing session...');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
        defaultViewport: { width: 1280, height: 900 },
        userDataDir: path.join(__dirname, 'puppeteer_data')
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Load Token from .env or browser
    const ENV_PATH = path.join(__dirname, '../.env');
    let envToken = null;
    if (fs.existsSync(ENV_PATH)) {
        const envContent = fs.readFileSync(ENV_PATH, 'utf8');
        const match = envContent.match(/BLACKBUCK_TOKEN=(.*)/);
        if (match) envToken = match[1].trim();
    }

    // Prepare page
    await page.goto('https://blackbuck.com/boss/gps', { waitUntil: 'networkidle2', timeout: 60000 });

    const token = envToken || await page.evaluate(() => {
        return localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('accessToken');
    });

    if (!token) {
        console.error('❌ Could not find session token. Please log in first.');
        await browser.close();
        process.exit(1);
    }

    const authHeader = token.startsWith('Token ') ? token : `Token ${token}`;
    
    // 2. Fetch Vehicle Status
    console.log('   🔄 Fetching live fleet status...');
    const fleetStatus = await page.evaluate(async (auth) => {
        try {
            const res = await fetch("https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200&fleet_owner_id=5599426", {
                headers: { "Authorization": auth, "Accept": "application/json" }
            });
            return res.ok ? (await res.json()).list : null;
        } catch (e) { return null; }
    }, authHeader);

    // 3. Fetch Trip Records (Multi-Strategy attempt)
    console.log('   🔄 Fetching trip records (last 2 days)...');
    const now = Date.now();
    const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);
    
    const tripResults = await page.evaluate(async (auth, start, end) => {
        const endpoints = [
            `https://api-fms.blackbuck.com/fmsiot/api/v2/gps/trip/records?fleet_owner_id=5599426&start_time=${start}&end_time=${end}&page_number=0&page_size=200`,
            `https://api-fms.blackbuck.com/fmsiot/api/v2/gps/history/v2?fleet_owner_id=5599426&start_time=${start}&end_time=${end}`
        ];
        
        let foundData = [];
        for (const url of endpoints) {
            try {
                const res = await fetch(url, { headers: { "Authorization": auth, "Accept": "application/json" } });
                if (res.ok) {
                    const data = await res.json();
                    const list = data.list || data.data || [];
                    if (list.length > 0) return list;
                }
            } catch (e) {}
        }
        return [];
    }, authHeader, twoDaysAgo, now);

    // 4. Final Output
    console.log('\n✅ Data capture complete!');
    const finalData = {
        timestamp: new Date().toISOString(),
        fleet: fleetStatus || [],
        tripHistory: tripResults
    };
    
    fs.writeFileSync('publication_data.json', JSON.stringify(finalData, null, 2));
    
    console.log(`\n📊 REPORT SUMMARY:`);
    console.log(`   Vehicles detected: ${finalData.fleet.length}`);
    console.log(`   Vehicles with trips (last 2 days): ${finalData.tripHistory.length}`);
    
    await browser.close();
}

publishData().catch(err => {
    console.error('❌ Data publication failed:', err.message);
    process.exit(1);
});
