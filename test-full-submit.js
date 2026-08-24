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
  console.log('Clue:', clueText);

  const capImg = await page.$('#captcha, img[src*="captcha"]');
  const screenshotBuf = await capImg.screenshot();
  const base64 = screenshotBuf.toString('base64');
  
  const prompt = `Ini adalah gambar captcha Projects.co.id. Petunjuk soal: "Tulis nama ${clueText} ini".
Tolong baca teks captcha yang tertulis di gambar secara persis sesuai petunjuk di atas. 
Balas HANYA kata captcha tersebut tanpa penjelasan atau tanda baca tambahan.`;

  const solved = await solveCaptchaWithVision(base64, prompt);
  const cleaned = solved.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  console.log('AI Captcha Solved:', cleaned);

  await page.fill('#bid__amount', '5000000');
  
  const proposalText = 'Halo, saya berpengalaman fullstack developer dalam pengembangan sistem website, pembuatan API, dan frontend/backend. Saya siap membantu menyelesaikan project ini dengan rapi dan tepat waktu.';
  
  await page.evaluate((text) => {
    // Projects.co.id uses older Summernote version: $('#bid__message').code('<div>...</div>')
    const html = `<div>${text}</div>`;
    if (typeof $('#bid__message').code === 'function') {
      $('#bid__message').code(html);
    } else if (typeof $('#bid__message').summernote === 'function') {
      $('#bid__message').summernote('code', html);
    }
    const textarea = document.getElementById('bid__message');
    if (textarea) textarea.value = html;
  }, proposalText);

  await page.fill('#bid__captcha', cleaned);

  page.on('dialog', async d => {
    console.log('Dialog:', d.message());
    await d.accept();
  });

  console.log('Submitting...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {}),
    page.click('#place_new_bid')
  ]);

  await page.waitForTimeout(5000);

  console.log('Final URL:', page.url());
  console.log('Final Title:', await page.title());

  const isSuccess = page.url().includes('bid_placed') || page.url().includes('view') || (await page.title()).toLowerCase().includes('bid placed');
  console.log('Is Bid Success:', isSuccess);

  await browser.close();
})();
