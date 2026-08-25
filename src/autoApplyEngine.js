const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const db = require('./db');
const { getSetting } = require('./db');
const { generateCoverLetter, solveCaptchaWithVision, classifyProjectForAutoBid } = require('./aiService');

/**
 * Helper to extract maximum published budget number from string
 */
function parsePublishedMaxBudget(budgetStr) {
  if (!budgetStr) return 0;
  
  const clean = budgetStr.replace(/idr|rp/gi, '').trim();
  const parts = clean.split(/[-–—~]|sampai|s\/d|s\.d|to/i);
  
  let maxVal = 0;
  for (const part of parts) {
    let mult = 1;
    if (/jt|juta|million/i.test(part)) mult = 1000000;
    else if (/rb|ribu|k/i.test(part)) mult = 1000;
    
    const rawDigits = parseInt(part.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(rawDigits) && rawDigits > 0) {
      let num = rawDigits;
      if (mult > 1 && num < 10000) {
        num = num * mult;
      }
      if (num > maxVal) {
        maxVal = num;
      }
    }
  }
  return maxVal;
}

/**
 * Calculate final bid amount based on published budget max
 */
function calculateBidAmount(budgetSalary, minAttr, maxAttr) {
  let targetAmount = parsePublishedMaxBudget(budgetSalary);
  
  // Default fallback if not found
  if (!targetAmount || targetAmount <= 0) {
    targetAmount = 1000000;
  }

  // Safety clamps based on HTML form constraints
  if (minAttr && parseInt(minAttr, 10) > 0) {
    targetAmount = Math.max(targetAmount, parseInt(minAttr, 10));
  }
  if (maxAttr && parseInt(maxAttr, 10) > 0) {
    targetAmount = Math.min(targetAmount, parseInt(maxAttr, 10));
  }

  return targetAmount;
}

/**
 * Handle automated bidding specifically for Projects.co.id
 */
async function applyProjectsCoId(page, item, profile, coverLetter, log) {
  const username = getSetting('projectscoid_user', 'AzakyHifdillah');
  const password = getSetting('projectscoid_pass', '456321987Azaky');

  log(`[Projects.co.id] Authenticating session for user: ${username}...`);
  
  // 1. Visit Login Page
  await page.goto('https://projects.co.id/public/home/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  const userField = await page.$('#LoginActivity__user_name');
  if (userField) {
    await userField.fill(username);
    await page.fill('#LoginActivity__password', password);
    await Promise.all([
      page.waitForURL('https://projects.co.id/**', { timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await page.waitForTimeout(3000);
    log(`[Projects.co.id] Logged in successfully. Current URL: ${page.url()}`);
  }

  // 2. Navigate directly to Place New Bid page
  let bidUrl = item.url;
  if (!bidUrl.includes('/place_new_bid/')) {
    bidUrl = bidUrl.replace('/view/', '/place_new_bid/');
  }

  log(`[Projects.co.id] Navigating to bid form: ${bidUrl}`);
  await page.goto(bidUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const bidForm = await page.$('#form_browse_projects_place_new_bid');
  if (!bidForm) {
    const pageText = await page.textContent('body');
    if (/already placed|telah melakukan bid|telah mengajukan penawaran|selesai|closed|telah berakhir/i.test(pageText)) {
      log(`[Projects.co.id] Notice: Already placed bid or project unavailable.`);
      return { success: true, message: 'Already bid or closed' };
    }
    throw new Error('Could not find bid form on Projects.co.id');
  }

  // 3. Fill Bid Amount (Set strictly to Maximum Published Budget)
  const amountInput = await page.$('#bid__amount');
  let finalBidAmount = '1000000';
  if (amountInput) {
    const maxVal = await amountInput.getAttribute('max');
    const minVal = await amountInput.getAttribute('min');
    
    const bidAmount = calculateBidAmount(item.budget_salary, minVal, maxVal);

    finalBidAmount = String(bidAmount);
    await amountInput.click({ clickCount: 3 });
    await amountInput.fill(String(bidAmount));
    log(`[Projects.co.id] Set bid amount to MAX published budget: Rp ${bidAmount.toLocaleString('id-ID')} (Published: ${item.budget_salary || 'N/A'})`);
  }

  // 4. Fill Proposal Message via Summernote API
  const cleanCoverLetter = coverLetter.trim().length > 15 ? coverLetter.trim() : 'Halo, saya berpengalaman dalam website development dan siap mengerjakan proyek ini dengan profesional, rapi, dan tepat waktu.';
  
  await page.evaluate((text) => {
    const wrappedHtml = `<div>${text.replace(/\n/g, '<br>')}</div>`;
    
    // Older Summernote API support on Projects.co.id
    if (window.jQuery) {
      if (typeof window.jQuery('#bid__message').code === 'function') {
        window.jQuery('#bid__message').code(wrappedHtml);
      } else if (typeof window.jQuery('#bid__message').summernote === 'function') {
        window.jQuery('#bid__message').summernote('code', wrappedHtml);
      }
    }
    
    // DOM textarea sync
    const rawTextarea = document.querySelector('#bid__message');
    if (rawTextarea) {
      rawTextarea.value = wrappedHtml;
    }
  }, cleanCoverLetter);
  
  log(`[Projects.co.id] Injected AI proposal into Summernote editor (${cleanCoverLetter.length} chars).`);

  // 5. Solve Captcha via Vision AI with Clue Text
  const capImg = await page.$('#captcha, img[src*="captcha"]');
  if (capImg) {
    const clueText = await page.$eval('#captcha_text', el => el.innerText.trim()).catch(() => '');
    log(`[Projects.co.id] Captcha image detected. Site clue: "${clueText}". Capturing screenshot...`);
    
    const screenshotBuf = await capImg.screenshot();
    const base64 = screenshotBuf.toString('base64');
    
    const captchaPrompt = `Ini adalah gambar captcha dari Projects.co.id dengan petunjuk: "Tulis nama ${clueText} ini".
Tolong baca dan pecahkan teks captcha pada gambar tersebut berdasarkan petunjuk di atas. 
Balas HANYA kata/teks captcha persisnya (lowercase/sesuai yang terbaca), tanpa tanda kutip, tanpa penjelasan lain.`;

    const solvedCaptcha = await solveCaptchaWithVision(base64, captchaPrompt);
    const cleaned = solvedCaptcha.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    
    log(`[Projects.co.id] Captcha solved by AI: "${cleaned}"`);
    const capInput = await page.$('#bid__captcha');
    if (capInput) {
      await capInput.click();
      await capInput.fill(cleaned);
      await capInput.dispatchEvent('change');
    }
  }

  // Handle confirmation dialogs
  page.on('dialog', async dialog => {
    log(`[Projects.co.id] Dialog popped up: ${dialog.message()}`);
    await dialog.accept();
  });

  // 6. Submit the Bid
  const submitBtn = await page.$('#place_new_bid');
  if (submitBtn) {
    log(`[Projects.co.id] Submitting proposal via #place_new_bid...`);
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {}),
      submitBtn.click()
    ]);
    
    await page.waitForTimeout(5000);

    const postSubmitUrl = page.url();
    const postSubmitTitle = await page.title();
    log(`[Projects.co.id] Post-submit URL: ${postSubmitUrl} | Title: ${postSubmitTitle}`);

    if (postSubmitUrl.includes('bid_placed') || postSubmitTitle.toLowerCase().includes('bid placed') || postSubmitUrl.includes('user/my_bids') || postSubmitUrl.includes('/view/')) {
      log(`[Projects.co.id] SUCCESS: Bid confirmed placed on Projects.co.id!`);
    } else {
      const fieldErrors = await page.$$eval('.has-error .help-block, .error-message', els => 
        els.map(e => e.innerText.trim()).filter(t => t.length > 0)
      );
      
      if (fieldErrors.length > 0) {
        throw new Error(`Projects.co.id validation error: ${fieldErrors.join(', ')}`);
      }
    }
  }

  return { success: true, bidAmount: finalBidAmount, message: 'Bid submitted successfully to Projects.co.id' };
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
  let applyResult = { success: true };
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
      applyResult = await applyProjectsCoId(page, item, profile, coverLetter, log);
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

    const bidAmt = applyResult.bidAmount ? `Rp ${parseInt(applyResult.bidAmount).toLocaleString('id-ID')}` : (item.bid_amount || '');

    db.prepare('UPDATE items SET status = ?, bid_amount = ?, apply_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('applied', bidAmt, finalLog, itemId);

    await browser.close();
    return { success: true, log: finalLog, coverLetter, bidAmount: bidAmt };

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

/**
 * Auto-Bid Pipeline Worker:
 * Evaluates pending Projects.co.id freelance items with AI classifier
 * If matches website bugfix/development, automatically places bid.
 */
let isAutoBidWorkerRunning = false;

async function runAutoBidRoutine(limit = 3) {
  if (isAutoBidWorkerRunning) {
    console.log('[AutoBid Routine] Already running, skipping concurrent run.');
    return { processed: 0, status: 'already_running' };
  }

  const enabled = getSetting('autobid_enabled', '0') === '1';
  if (!enabled) {
    console.log('[AutoBid Routine] Auto-bid is disabled in settings.');
    return { processed: 0, status: 'disabled' };
  }

  isAutoBidWorkerRunning = true;
  console.log('[AutoBid Routine] Scanning un-evaluated Projects.co.id freelance projects...');

  try {
    // Find un-evaluated Projects.co.id freelance items
    const candidates = db.prepare(`
      SELECT * FROM items 
      WHERE (platform_source = 'Projects.co.id' OR url LIKE '%projects.co.id%')
        AND status IN ('new', 'analyzed')
        AND auto_bid_evaluated = 0
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(limit);

    console.log(`[AutoBid Routine] Found ${candidates.length} candidates.`);
    let processed = 0;

    for (const item of candidates) {
      console.log(`[AutoBid Routine] Evaluating item [${item.id}] "${item.title}" with AI...`);
      
      const classification = await classifyProjectForAutoBid(item);
      console.log(`[AutoBid Routine] Result: match=${classification.match}, category="${classification.category}", reason="${classification.reason}"`);

      db.prepare(`
        UPDATE items SET
          auto_bid_evaluated = 1,
          auto_bid_matched = ?,
          auto_bid_category = ?,
          auto_bid_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        classification.match ? 1 : 0,
        classification.category,
        classification.reason,
        item.id
      );

      if (classification.match) {
        console.log(`[AutoBid Routine] MATCHED! Auto-placing bid on "${item.title}"...`);
        
        // Log to autobid_logs
        const logRes = db.prepare(`
          INSERT INTO autobid_logs (item_id, item_title, matched, category, reason, status, details)
          VALUES (?, ?, 1, ?, ?, 'bidding', 'Triggered auto bid execution')
        `).run(item.id, item.title, classification.category, classification.reason);

        const result = await applyToJob(item.id);
        
        db.prepare(`
          UPDATE autobid_logs SET
            status = ?,
            details = ?
          WHERE id = ?
        `).run(
          result.success ? 'bid_success' : 'bid_failed',
          result.success ? 'Bid placed successfully' : (result.error || 'Failed'),
          logRes.lastInsertRowid
        );

        processed++;
      } else {
        console.log(`[AutoBid Routine] SKIPPED: Does not match website bugfix/development criteria.`);
        db.prepare(`
          INSERT INTO autobid_logs (item_id, item_title, matched, category, reason, status, details)
          VALUES (?, ?, 0, ?, ?, 'skipped', 'AI filtered out')
        `).run(item.id, item.title, classification.category, classification.reason);
      }

      // Small delay between evaluations
      await new Promise(r => setTimeout(r, 2000));
    }

    return { processed, totalCandidates: candidates.length, status: 'completed' };
  } catch (err) {
    console.error('[AutoBid Routine] Exception occurred:', err);
    return { error: err.message, status: 'error' };
  } finally {
    isAutoBidWorkerRunning = false;
  }
}

module.exports = {
  applyToJob,
  runAutoBidRoutine
};
