/**
 * ═══════════════════════════════════════════════════════
 *  Suprwise — Token Extraction Agent
 * ═══════════════════════════════════════════════════════
 *  Opens a visible browser for the user to log in.
 *  Captures the 'Authorization' token and saves it to .env.
 * ═══════════════════════════════════════════════════════
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const ENV_PATH = path.join(__dirname, '../.env');
const LOGIN_URL = 'https://blackbuck.com/boss/sign-in';

async function extractToken() {
    console.log('\n🚀 Starting Token Extraction Agent...');
    console.log('   👉 A browser window will open.');
    console.log('   👉 Please log in manually.');
    console.log('   👉 I will detect and save your token automatically.');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
        defaultViewport: { width: 1280, height: 900 }
    });

    const page = await browser.newPage();

    let capturedToken = null;

    // Listen for requests to capture the authorization header
    await page.setRequestInterception(true);
    page.on('request', req => {
        const headers = req.headers();
        const url = req.url();

        if (headers['authorization'] && (url.includes('blackbuck.com') || url.includes('api-fms'))) {
            const token = headers['authorization'];
            if (token.startsWith('Token ') || token.startsWith('Bearer ')) {
                if (token !== capturedToken) {
                    capturedToken = token;
                    console.log(`\n✅ TOKEN CAPTURED: ${token.substring(0, 30)}...`);
                    saveTokenToEnv(token);
                }
            }
        }
        
        const type = req.resourceType();
        if (['image', 'font', 'media'].includes(type)) req.abort();
        else req.continue();
    });

    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

    console.log('\n⏳ Waiting for login... (Log in and navigate to the dashboard)');
    
    // Keep alive until browser is closed
    const checkInterval = setInterval(async () => {
        try {
            if (browser.process() === null || (await browser.pages()).length === 0) {
                console.log('\n👋 Browser closed. Extraction agent stopping.');
                clearInterval(checkInterval);
                process.exit(0);
            }
        } catch (e) {
            clearInterval(checkInterval);
            process.exit(0);
        }
    }, 2000);
}

function saveTokenToEnv(token) {
    try {
        let envContent = '';
        if (fs.existsSync(ENV_PATH)) {
            envContent = fs.readFileSync(ENV_PATH, 'utf8');
        }

        const lines = envContent.split('\n');
        let found = false;
        const newLines = lines.map(line => {
            if (line.startsWith('BLACKBUCK_TOKEN=')) {
                found = true;
                return `BLACKBUCK_TOKEN=${token}`;
            }
            return line;
        });

        if (!found) {
            newLines.push(`BLACKBUCK_TOKEN=${token}`);
        }

        fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf8');
        console.log('💾 Token saved to .env file');
    } catch (err) {
        console.error('❌ Failed to save token:', err.message);
    }
}

extractToken().catch(err => {
    console.error('❌ Agent failed:', err.message);
    process.exit(1);
});
