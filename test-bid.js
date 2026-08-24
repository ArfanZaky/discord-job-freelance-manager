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

  const testText = 'Halo, saya berpengalaman dalam website development dan siap membantu mengembangkan sistem website ini dengan profesional, rapi, dan tepat waktu.';

  const editorInfo = await page.evaluate((text) => {
    let jqExists = typeof window.jQuery !== 'undefined';
    let summernoteExists = false;
    
    if (jqExists && window.jQuery('#bid__message').summernote) {
      summernoteExists = true;
      window.jQuery('#bid__message').summernote('code', `<p>${text}</p>`);
    }
    
    const editable = document.querySelector('.note-editable');
    if (editable) {
      editable.innerHTML = `<p>${text}</p>`;
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      editable.dispatchEvent(new Event('keyup', { bubbles: true }));
      editable.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    const textarea = document.getElementById('bid__message');
    if (textarea) {
      textarea.value = `<p>${text}</p>`;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return {
      jqExists,
      summernoteExists,
      editableHtml: editable ? editable.innerHTML : null,
      textareaVal: textarea ? textarea.value : null
    };
  }, testText);

  console.log('Editor setup info:', editorInfo);

  // Set amount
  await page.fill('#bid__amount', '5000000');

  // Solve captcha
  const capImg = await page.$('#captcha, img[src*="captcha"]');
  const screenshotBuf = await capImg.screenshot();
  const base64 = screenshotBuf.toString('base64');
  const solvedCaptcha = await solveCaptchaWithVision(base64, 'Tuliskan teks captcha di gambar ini secara persis (hanya 1 atau 2 kata). Hanya balas teks tanpa penjelasan/tanda petik.');
  const cleaned = solvedCaptcha.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  console.log('Solved captcha:', cleaned);
  await page.fill('#bid__captcha', cleaned);

  page.on('dialog', async d => {
    console.log('Dialog:', d.message());
    await d.accept();
  });

  // Submit
  await page.click('#place_new_bid');
  await page.waitForTimeout(6000);

  console.log('After submit URL:', page.url());
  console.log('After submit Title:', await page.title());
  
  const pageErrors = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.alert, .help-block, .has-error')).map(el => el.innerText.trim());
  });
  console.log('Page errors:', pageErrors);
  
  await browser.close();
})();
