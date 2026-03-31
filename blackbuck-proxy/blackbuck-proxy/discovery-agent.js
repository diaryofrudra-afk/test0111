const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

puppeteer.use(StealthPlugin());

async function discoverEndpoints() {
    console.log('\n🔍 Discovery Agent Starting...');
    console.log('   👉 A browser window will open.');
    console.log('   👉 PLEASE NAVIGATE to the "Trips" or "History" section.');
    console.log('   👉 I will log all API calls below.\n');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
        defaultViewport: { width: 1280, height: 900 },
        userDataDir: path.join(__dirname, 'puppeteer_data')
    });

    const page = await browser.newPage();

    page.on('request', request => {
        const url = request.url();
        if (url.includes('api-fms.blackbuck.com')) {
            console.log(`📡 intercepted: ${url}`);
        }
    });

    await page.goto('https://blackbuck.com/boss/gps', { waitUntil: 'networkidle2' });

    console.log('\n⏳ Waiting for navigation... (Close browser when finished)');
}

discoverEndpoints().catch(err => {
    console.error('❌ Discovery failed:', err.message);
});
