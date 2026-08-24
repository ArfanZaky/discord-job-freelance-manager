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

  const errorInspection = await page.evaluate(() => {
    // Let's inspect all elements with has-error class or help-block
    const errorBlocks = Array.from(document.querySelectorAll('.form-group')).map(fg => ({
      label: fg.querySelector('label') ? fg.querySelector('label').innerText.trim() : null,
      hasErrorClass: fg.classList.contains('has-error'),
      helpBlockText: fg.querySelector('.help-block') ? fg.querySelector('.help-block').innerText.trim() : null,
      inputId: fg.querySelector('input, textarea, select') ? fg.querySelector('input, textarea, select').id : null
    }));
    return errorBlocks;
  });

  console.log('Error inspection on load:', JSON.stringify(errorInspection, null, 2));
  await browser.close();
})();
