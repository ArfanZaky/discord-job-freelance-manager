const { chromium } = require('playwright');
const db = require('./db');
const { generateCoverLetter, solveCaptchaWithVision } = require('./aiService');

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
    console.log(`[AutoApply] Generating AI cover letter for: ${item.title}`);
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
    const headless = process.env.AUTO_APPLY_HEADLESS !== 'false';
    log(`Launching browser (headless: ${headless})...`);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    log(`Navigating to ${item.url}...`);
    
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pageTitle = await page.title();
    log(`Page loaded: "${pageTitle}"`);

    // Check if captcha is present on the page
    const captchaElements = await page.$$('img[src*="captcha"], iframe[src*="turnstile"], iframe[src*="recaptcha"], .captcha, #captcha');
    if (captchaElements.length > 0) {
      log(`Detected ${captchaElements.length} possible captcha element(s). Engaging 9Router Vision solver...`);
      for (const cap of captchaElements) {
        try {
          const capBox = await cap.boundingBox();
          if (capBox && capBox.width > 30 && capBox.height > 20) {
            const screenshotBuf = await cap.screenshot();
            const base64 = screenshotBuf.toString('base64');
            const solution = await solveCaptchaWithVision(base64);
            log(`AI Vision solved captcha: "${solution}"`);
            
            // Try to find captcha input field nearby
            const capInput = await page.$('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha"]');
            if (capInput) {
              await capInput.fill(solution.trim());
              log(`Injected captcha solution into input.`);
            }
          }
        } catch (capErr) {
          log(`Captcha processing note: ${capErr.message}`);
        }
      }
    }

    // Try autofilling standard form fields if application form is directly on page
    const filledFields = [];

    // Full name
    const nameInput = await page.$('input[name*="name" i], input[id*="name" i], input[placeholder*="nama" i], input[placeholder*="name" i]');
    if (nameInput) {
      await nameInput.fill(profile.full_name);
      filledFields.push('Full Name');
    }

    // Email
    const emailInput = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
    if (emailInput) {
      await emailInput.fill(profile.email);
      filledFields.push('Email');
    }

    // Phone
    const phoneInput = await page.$('input[type="tel"], input[name*="phone" i], input[name*="hp" i], input[id*="phone" i]');
    if (phoneInput) {
      await phoneInput.fill(profile.phone);
      filledFields.push('Phone');
    }

    // Cover letter / Message / Proposal
    const descArea = await page.$('textarea[name*="cover" i], textarea[name*="message" i], textarea[name*="proposal" i], textarea[id*="proposal" i], textarea[placeholder*="pesan" i], textarea');
    if (descArea) {
      await descArea.fill(coverLetter);
      filledFields.push('Cover Letter / Message');
    }

    // LinkedIn / Portfolio / GitHub links
    const linkInput = await page.$('input[name*="linkedin" i], input[placeholder*="linkedin" i]');
    if (linkInput && profile.linkedin) {
      await linkInput.fill(profile.linkedin);
      filledFields.push('LinkedIn URL');
    }

    const portInput = await page.$('input[name*="portfolio" i], input[name*="github" i], input[placeholder*="portfolio" i]');
    if (portInput && profile.portfolio) {
      await portInput.fill(profile.portfolio);
      filledFields.push('Portfolio URL');
    }

    log(`Auto-filled fields: ${filledFields.join(', ') || 'No direct standard inputs detected'}`);

    // If on Kalibrr / JobStreet / Projects.co.id, check if "Apply" / "Kirim Penawaran" button exists
    const applyButton = await page.$(
      'button:has-text("Apply"), a:has-text("Apply"), button:has-text("Lamar"), a:has-text("Lamar"), button:has-text("Kirim Penawaran"), button:has-text("Submit")'
    );

    if (applyButton) {
      const btnText = (await applyButton.textContent()).trim();
      log(`Found primary apply action button: "${btnText}"`);
    }

    log(`Application preparation completed successfully.`);
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
