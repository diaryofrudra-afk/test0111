// Connect to the running browser and take a screenshot
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version').catch(() => null);
    if (res) {
      const data = await res.json();
      console.log('Browser WS endpoint:', data.webSocketDebuggerUrl);
      const browser = await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl });
      const pages = await browser.pages();
      console.log('Open pages:', pages.map(p => p.url()));
      if (pages[0]) {
        await pages[0].screenshot({ path: '/tmp/current-page.png', fullPage: false });
        console.log('Screenshot saved to /tmp/current-page.png');
      }
      browser.disconnect();
    } else {
      console.log('Remote debugging not available');
    }
  } catch (e) {
    console.error(e.message);
  }
})();
