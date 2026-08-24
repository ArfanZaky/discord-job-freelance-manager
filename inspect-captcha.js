const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://projects.co.id/public/home/login');
  await page.fill('#LoginActivity__user_name', 'AzakyHifdillah');
  await page.fill('#LoginActivity__password', '456321987Azaky');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  
  await page.goto('https://projects.co.id/public/browse_projects/place_new_bid/5b511d/bantu-mengembangkan-website');
  await page.waitForTimeout(3000);

  const captchaContainer = await page.evaluate(() => {
    const cap = document.querySelector('#captcha') || document.querySelector('img[src*="captcha"]');
    if (!cap) return 'No captcha element';
    const parent = cap.closest('.form-group') || cap.parentElement;
    return {
      parentHtml: parent ? parent.innerHTML : null,
      parentText: parent ? parent.innerText : null,
      src: cap.getAttribute('src')
    };
  });

  console.log('Captcha container:', captchaContainer);
  await browser.close();
})();
