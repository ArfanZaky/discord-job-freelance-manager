const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { solveCaptchaWithVision } = require('./src/aiService');

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

  const clueText = await page.$eval('#captcha_text', el => el.innerText.trim()).catch(() => '');
  console.log('Clue from website:', clueText);

  const capImg = await page.$('#captcha, img[src*="captcha"]');
  const screenshotBuf = await capImg.screenshot();
  const base64 = screenshotBuf.toString('base64');
  
  const prompt = `Ini adalah gambar captcha dari Projects.co.id dengan petunjuk: "Tulis nama ${clueText} ini".
Tolong baca dan pecahkan teks captcha pada gambar tersebut berdasarkan petunjuk di atas. 
Balas HANYA kata/teks captcha persisnya (lowercase/sesuai yang terbaca), tanpa tanda kutip, tanpa penjelasan lain.`;

  const solved = await solveCaptchaWithVision(base64, prompt);
  console.log('AI Solved:', solved);

  await page.fill('#bid__amount', '5000000');
  
  await page.evaluate((text) => {
    if (window.jQuery && window.jQuery('#bid__message').summernote) {
      window.jQuery('#bid__message').summernote('code', `<p>${text}</p>`);
    }
    const textarea = document.getElementById('bid__message');
    if (textarea) textarea.value = `<p>${text}</p>`;
  }, 'Halo, saya berpengalaman dalam website development dan siap membantu mengembangkan sistem website ini dengan profesional, rapi, dan tepat waktu.');

  const cleaned = solved.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  await page.fill('#bid__captcha', cleaned);

  console.log('Submitting with captcha:', cleaned);
  await page.click('#place_new_bid');
  await page.waitForTimeout(6000);

  console.log('Post Submit URL:', page.url());
  console.log('Post Submit Title:', await page.title());

  const pageErrors = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.has-error .help-block, .alert-danger')).map(el => el.innerText.trim()).filter(t => t.length > 0);
  });
  console.log('Field errors:', pageErrors);

  await browser.close();
})();
