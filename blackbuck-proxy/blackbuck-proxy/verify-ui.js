const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

puppeteer.use(StealthPlugin());

async function verifyUI() {
    console.log('\n🔍 UI Verification Agent Starting...');
    console.log('   👉 Opening visible Chrome browser...');

    const browser = await puppeteer.launch({
        headless: false, // VISIBLE for the user
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
        defaultViewport: { width: 1280, height: 900 },
        // Use the same data dir so we stay logged in if possible
        userDataDir: path.join(__dirname, 'puppeteer_data')
    });

    const page = await browser.newPage();
    
    console.log('   🚀 Navigating to Suprwise Fleet Deployment...');
    try {
        await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for the Fleet page to load (it's usually the default or we click it)
        // Let's look for the 'Fleet Deployment' title
        await page.waitForSelector('#page-fleet', { timeout: 10000 }).catch(() => null);

        console.log('   ✅ Page loaded. Please check the Ignition Indicators (Lightning Bolt icons).');
        console.log('   👉 Yellow/Amber = Ignition ON');
        console.log('   👉 Gray = Ignition OFF');
        
        // Keep it open for 60 seconds so the user can see it
        console.log('\n⏳ Browser will stay open for 60 seconds for manual verification...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        
    } catch (err) {
        console.error('❌ Verification failed:', err.message);
    } finally {
        await browser.close();
        console.log('🏁 Verification agent finished.');
    }
}

verifyUI();
