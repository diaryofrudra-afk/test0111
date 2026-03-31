const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function run() {
    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto('https://example.com'); // Placeholder to set localStorage
        
        // Mock a token in localStorage
        await page.evaluate(() => {
            localStorage.setItem('token', 'Bearer mock-test-token-12345');
        });
        
        // Simulate the extraction logic from proxy-engine.js
        const storageToken = await page.evaluate(() => {
            const raw = localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('accessToken');
            return raw ? raw : null;
        });
        
        console.log('--- EXTRACTION RESULT ---');
        console.log('Found Token:', storageToken);
        console.log('--- END OF RESULT ---');
        
    } catch (e) {
        console.error('Test failed:', e);
    } finally {
        await browser.close();
    }
}
run();
