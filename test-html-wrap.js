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

  const testText = 'Halo, saya berpengalaman dalam website development dan siap membantu mengembangkan sistem website ini dengan profesional, rapi, dan tepat waktu.';

  const results = await page.evaluate((rawText) => {
    const htmlWithDiv = `<div>${rawText}</div>`;
    const htmlWithP = `<p>${rawText}</p>`;
    
    // Test with <div> wrapping
    $('#bid__message').code(htmlWithDiv);
    
    let expr1;
    try {
      expr1 = $($('#bid__message').summernote().code()).text();
    } catch(e) {
      expr1 = 'ERROR: ' + e.message;
    }

    return {
      htmlWithDiv,
      expr1,
      expr1Length: typeof expr1 === 'string' ? expr1.length : 0
    };
  }, testText);

  console.log('Results with HTML wrapper:', results);
  await browser.close();
})();
