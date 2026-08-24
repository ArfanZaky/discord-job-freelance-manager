const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const db = require('./db');
const { getSetting } = require('./db');
const { generateCoverLetter, solveCaptchaWithVision } = require('./aiService');

/**
 * Handle automated bidding specifically for Projects.co.id
 */
async function applyProjectsCoId(page, item, profile, coverLetter, log) {
  const username = getSetting('projectscoid_user', 'AzakyHifdillah');
  const password = getSetting('projectscoid_pass', '456321987Azaky');

  log(`[Projects.co.id] Authenticating session for user: ${username}...`);
  
  // 1. Visit Login Page
  await page.goto('https://projects.co.id/public/home/login', { waitUntil: 'networkidle', timeout: 30000 });
  
  const userField = await page.$('#LoginActivity__user_name');
  if (userField) {
    await userField.fill(username);
    await page.fill('#LoginActivity__password', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
  }

  // 2. Navigate directly to Place New Bid page
  let bidUrl = item.url;
  if (!bidUrl.includes('/place_new_bid/')) {
    bidUrl = bidUrl.replace('/view/', '/place_new_bid/');
  }

  log(`[Projects.co.id] Navigating to bid form: ${bidUrl}`);
  await page.goto(bidUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const bidForm = await page.$('#form_browse_projects_place_new_bid');
  if (!bidForm) {
    // Check if already placed bid or project closed
    const pageText = await page.textContent('body');
    if (/already placed|telah melakukan bid|selesai|closed/i.test(pageText)) {
      log(`[Projects.co.id] Notice: Already placed bid or project unavailable.`);
      return { success: true, message: 'Already bid or closed' };
    }
    throw new Error('Could not find bid form on Projects.co.id');
  }

  // 3. Fill Bid Amount
  const amountInput = await page.$('#bid__amount');
  if (amountInput) {
    let bidAmount = 0;
    const minVal = await amountInput.getAttribute('min');
    const maxVal = await amountInput.getAttribute('max');
    
    if (minVal && maxVal) {
      // Calculate realistic middle or lower bound
      const minNum = parseInt(minVal, 10) || 0;
      const maxNum = parseInt(maxVal, 10) || minNum;
      bidAmount = minNum > 0 ? Math.round((minNum + maxNum) / 2) : maxNum;
    }

    if (bidAmount > 0) {
      await amountInput.fill(String(bidAmount));
      log(`[Projects.co.id] Set bid amount: Rp ${bidAmount.toLocaleString('id-ID')}`);
    }
  }

  // 4. Fill Proposal Message (Summernote rich text & hidden textarea)
  const summernoteEditable = await page.$('.note-editable');
  if (summernoteEditable) {
    await page.evaluate((text) => {
      const editor = document.querySelector('.note-editable');
      if (editor) {
        editor.innerHTML = `<p>${text.replace(/\n/g, '<br>')}</p>`;
      }
      const rawTextarea = document.querySelector('#bid__message');
      if (rawTextarea) {
        rawTextarea.value = text;
      }
    }, coverLetter);
    log(`[Projects.co.id] Injected AI proposal into Summernote editor.`);
  } else {
    const rawTextarea = await page.$('#bid__message');
    if (rawTextarea) {
      await rawTextarea.fill(coverLetter);
    }
  }

  // 5. Solve Captcha via Vision AI
  const capImg = await page.$('#captcha, img[src*="captcha"]');
  if (capImg) {
    log(`[Projects.co.id] Captcha image detected. Capturing screenshot...`);
    const screenshotBuf = await capImg.screenshot();
    const base64 = screenshotBuf.toString('base64');
    
    const captchaPrompt = 'Tuliskan teks jawaban yang ada di dalam gambar captcha ini secara tepat. Hanya balas teks tanpa penjelasan.';
    const solvedCaptcha = await solveCaptchaWithVision(base64, captchaPrompt);
    
    log(`[Projects.co.id] Captcha solved by AI: "${solvedCaptcha}"`);
    const capInput = await page.$('#bid__captcha');
    if (capInput) {
      await capInput.fill(solvedCaptcha.trim().toLowerCase());
    }
  }

  // 6. Submit the Bid
  const submitBtn = await page.$('#place_new_bid');
  if (submitBtn) {
    log(`[Projects.co.id] Submitting proposal via #place_new_bid...`);
    await submitBtn.click();
    await page.waitForTimeout(6000);

    const postSubmitUrl = page.url();
    log(`[Projects.co.id] Post-submit URL: ${postSubmitUrl}`);
  }

  return { success: true, message: 'Bid submitted successfully to Projects.co.id' };
}

/**
 * Universal auto-apply router
 */
async function applyToJob(itemId, customProposal = null) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) {
    throw new Error('Item not found');
  }

  const profile = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();

  db.prepare('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('applying', itemId);

  let coverLetter = customProposal || item.ai_cover_letter;
  if (!coverLetter) {
    console.log(`[AutoApply] Generating AI proposal for: ${item.title}`);
    coverLetter = await generateCoverLetter(item, profile);
    db.prepare('UPDATE items SET ai_cover_letter = ? WHERE id = ?').run(coverLetter, itemId);
  }

  const logEntries = [];
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    console.log(`[AutoApply][${itemId}] ${msg}`);
    logEntries.push(`[${timestamp}] ${msg}`);
  };

  log(`Target URL: ${item.url || 'No URL found'}`);

  if (!item.url) {
    const failMsg = 'Cannot auto-apply: missing application URL';
    log(failMsg);
    db.prepare('UPDATE items SET status = ?, apply_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('failed', logEntries.join('\n'), itemId);
    return { success: false, log: logEntries.join('\n'), message: failMsg };
  }

  let browser;
  try {
    log(`Launching browser with stealth mode...`);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta'
    });

    const page = await context.newPage();

    // Check if target is Projects.co.id
    if (item.url.includes('projects.co.id') || item.platform_source === 'Projects.co.id') {
      await applyProjectsCoId(page, item, profile, coverLetter, log);
    } else {
      // General job application handler
      log(`Navigating to ${item.url}...`);
      await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const pageTitle = await page.title();
      log(`Page loaded: "${pageTitle}"`);

      // Autofill standard form inputs
      const nameInput = await page.$('input[name*="name" i], input[id*="name" i], input[placeholder*="nama" i], input[placeholder*="name" i]');
      if (nameInput) await nameInput.fill(profile.full_name);

      const emailInput = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
      if (emailInput) await emailInput.fill(profile.email);

      const phoneInput = await page.$('input[type="tel"], input[name*="phone" i], input[name*="hp" i], input[id*="phone" i]');
      if (phoneInput) await phoneInput.fill(profile.phone);

      const descArea = await page.$('textarea[name*="cover" i], textarea[name*="message" i], textarea[name*="proposal" i], textarea');
      if (descArea) await descArea.fill(coverLetter);

      const linkInput = await page.$('input[name*="linkedin" i], input[placeholder*="linkedin" i]');
      if (linkInput && profile.linkedin) await linkInput.fill(profile.linkedin);

      const portInput = await page.$('input[name*="portfolio" i], input[name*="github" i], input[placeholder*="portfolio" i]');
      if (portInput && profile.portfolio) await portInput.fill(profile.portfolio);
    }

    log(`Application routine completed successfully.`);
    const finalLog = logEntries.join('\n');

    db.prepare('UPDATE items SET status = ?, apply_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('applied', finalLog, itemId);

    await browser.close();
    return { success: true, log: finalLog, coverLetter };

  } catch (err) {
    if (browser) await browser.close();
    const errMsg = `Error during application automation: ${err.message}`;
    log(errMsg);
    const finalLog = logEntries.join('\n');

    db.prepare('UPDATE items SET status = ?, apply_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('failed', finalLog, itemId);

    return { success: false, log: finalLog, error: err.message };
  }
}

module.exports = {
  applyToJob
};
