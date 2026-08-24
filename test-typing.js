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

  // Click on .note-editable and type character by character like a real human!
  await page.click('.note-editable');
  await page.keyboard.type('Halo, saya berpengalaman dalam website development dan siap membantu mengembangkan sistem website ini dengan profesional, rapi, dan tepat waktu.');

  const check = await page.evaluate(() => {
    return {
      editableText: document.querySelector('.note-editable').innerText,
      textareaValue: document.getElementById('bid__message').value
    };
  });
  console.log('After human typing:', check);

  await browser.close();
})();
