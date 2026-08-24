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

  const debugSummernote = await page.evaluate((text) => {
    const res = {};
    
    // Method 1: set via code
    try {
      res.beforeCode = typeof $('#bid__message').code === 'function' ? $('#bid__message').code() : 'no .code()';
    } catch(e) { res.beforeCodeErr = e.message; }

    // Try setting code
    try {
      if (typeof $('#bid__message').code === 'function') {
        $('#bid__message').code(text);
        res.setViaCodeMethod = true;
      }
    } catch(e) { res.setViaCodeMethodErr = e.message; }

    // Try setting summernote('code')
    try {
      $('#bid__message').summernote('code', text);
      res.setViaSummernoteCode = true;
    } catch(e) { res.setViaSummernoteCodeErr = e.message; }

    // Check what the validation expression gets:
    try {
      res.validationExprResult = $($('#bid__message').summernote().code()).text();
      res.validationExprLength = res.validationExprResult ? res.validationExprResult.length : 0;
    } catch(e) { res.validationExprErr = e.message; }

    return res;
  }, testText);

  console.log('debugSummernote:', debugSummernote);
  await browser.close();
})();
