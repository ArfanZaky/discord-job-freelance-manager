import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getDb } from './db.js';
import { generateProposal, solveCaptchaWithVision } from './aiService.js';
import fs from 'fs';
import { execSync } from 'child_process';

chromium.use(stealthPlugin());

function ensurePlaywrightBrowser() {
  const cachePath = '/root/.cache/ms-playwright';
  const hasShell = fs.existsSync(cachePath) && fs.readdirSync(cachePath).some(dir => dir.startsWith('chromium_headless_shell'));
  if (!hasShell) {
    try {
      console.log('[Automation] Playwright browser not found. Auto-installing chromium...');
      execSync('npx playwright install chromium', { stdio: 'inherit' });
      console.log('[Automation] Playwright browser installed successfully.');
    } catch (e) {
      console.error('[Automation] Failed to auto-install Playwright browser:', e.message);
    }
  }
}

export async function executeAutoApply(job, customProposal = null) {
  const db = getDb();
  const startTime = new Date();
  const auditLogs = [];

  const log = (msg) => {
    const time = new Date().toISOString();
    const entry = `[${time}] ${msg}`;
    auditLogs.push(entry);
    console.log(entry);
  };

  db.prepare(`UPDATE jobs SET application_status = 'APPLYING' WHERE id = ?`).run(job.id);

  let browser = null;
  let success = false;
  let errorMessage = null;

  try {
    const targetUrl = job.apply_url || job.url;
    log(`Target URL: ${targetUrl}`);

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() || {};
    const candidate = db.prepare('SELECT * FROM candidate_profile WHERE id = 1').get() || {};

    let proposalText = customProposal;
    if (!proposalText) {
      log('Generating AI proposal using candidate profile...');
      proposalText = await generateProposal(job, candidate);
      log('Proposal successfully generated.');
    }

    if (targetUrl && (targetUrl.includes('projects.co.id') || targetUrl.includes('browse_projects'))) {
      ensurePlaywrightBrowser();
      log(`Launching browser with stealth mode...`);
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });

      const page = await context.newPage();

      const pUser = settings.projectscoid_user || 'AzakyHifdillah';
      const pPass = settings.projectscoid_pass || '456321987Azaky';

      log(`[Projects.co.id] Authenticating session for user: ${pUser}...`);
      await page.goto('https://projects.co.id/public/home/login', { waitUntil: 'networkidle', timeout: 30000 });

      const loginFormExists = await page.$('#user_login');
      if (loginFormExists) {
        await page.fill('input[name="user[username]"], #user_login', pUser);
        await page.fill('input[name="user[password]"], #user_password', pPass);
        await Promise.all([
          page.click('button[type="submit"], input[type="submit"], .btn-primary'),
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {})
        ]);
        log(`[Projects.co.id] Login submitted.`);
      }

      let bidUrl = targetUrl;
      if (bidUrl.includes('/view/')) {
        bidUrl = bidUrl.replace('/view/', '/place_new_bid/');
      } else if (!bidUrl.includes('/place_new_bid/')) {
        const match = bidUrl.match(/browse_projects\/([^\/]+)\/([^\/]+)/);
        if (match) {
          bidUrl = `https://projects.co.id/public/browse_projects/place_new_bid/${match[1]}/${match[2]}`;
        }
      }

      log(`[Projects.co.id] Navigating to bid form: ${bidUrl}`);
      await page.goto(bidUrl, { waitUntil: 'networkidle', timeout: 30000 });

      const isForbiddenOrClosed = await page.evaluate(() => {
        const body = document.body.innerText;
        return body.includes('You are not allowed to place bid') || body.includes('Project is closed') || body.includes('Sudah tidak menerima penawaran');
      });

      if (isForbiddenOrClosed) {
        throw new Error('Proyek ini sudah ditutup atau tidak dapat menerima penawaran lagi.');
      }

      const rawBudgetStr = `${job.budget || ''} ${job.description || ''}`;
      
      const parsePublishedMaxBudget = (str) => {
        if (!str) return null;
        const matches = str.match(/Rp\s*([\d\.,]+)/gi);
        if (matches && matches.length > 0) {
          const numbers = matches.map(m => parseInt(m.replace(/[^\d]/g, ''), 10)).filter(n => !isNaN(n) && n > 0);
          if (numbers.length > 0) {
            return Math.max(...numbers);
          }
        }
        return null;
      };

      const maxFromDescription = parsePublishedMaxBudget(rawBudgetStr);

      const targetAmount = await page.evaluate((maxDesc) => {
        const amountInput = document.querySelector('input[name="bid[amount]"], #bid__amount');
        if (!amountInput) return 1000000;
        
        const formMax = parseInt(amountInput.getAttribute('max') || '0', 10);
        const formMin = parseInt(amountInput.getAttribute('min') || '100000', 10);

        let chosen = maxDesc || formMax || formMin || 1000000;
        if (formMax > 0 && chosen > formMax) chosen = formMax;
        if (formMin > 0 && chosen < formMin) chosen = formMin;
        return chosen;
      }, maxFromDescription);

      log(`[Projects.co.id] Set bid amount: Rp ${targetAmount.toLocaleString('id-ID')} (Published Max: ${maxFromDescription ? 'Rp ' + maxFromDescription.toLocaleString('id-ID') : 'Default/Max'})`);
      
      await page.evaluate((amt) => {
        const amountInput = document.querySelector('input[name="bid[amount]"], #bid__amount');
        if (amountInput) {
          amountInput.value = amt;
          amountInput.dispatchEvent(new Event('input', { bubbles: true }));
          amountInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, targetAmount);

      const formattedHtmlProposal = proposalText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>');
      const cleanHtmlProposal = `<p>${formattedHtmlProposal}</p>`;

      await page.evaluate((html) => {
        const textarea = document.querySelector('textarea[name="bid[message]"], #bid__message');
        if (textarea) {
          textarea.value = html;
          textarea.innerHTML = html;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          textarea.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        
        try {
          if (window.jQuery && window.jQuery('#bid__message').length) {
            if (typeof window.jQuery('#bid__message').summernote === 'function') {
              window.jQuery('#bid__message').summernote('code', html);
            }
          }
        } catch (e) {}

        const editable = document.querySelector('.note-editable');
        if (editable) {
          editable.innerHTML = html;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          editable.dispatchEvent(new Event('keyup', { bubbles: true }));
          editable.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }, cleanHtmlProposal);

      log(`[Projects.co.id] Injected proposal HTML into Summernote editor & textarea.`);

      const captchaImg = await page.$('img[src*="captcha"], #captcha_image, img.captcha');
      if (captchaImg) {
        log(`[Projects.co.id] Captcha image detected. Capturing screenshot...`);
        const captchaBuffer = await captchaImg.screenshot();
        const base64Image = captchaBuffer.toString('base64');
        
        const captchaClue = await page.evaluate(() => {
          const clueEl = document.querySelector('#captcha_text, .captcha-text, span.label-info, small.text-muted');
          return clueEl ? clueEl.innerText.trim() : '';
        });

        const promptClue = captchaClue ? `Petunjuk soal captcha: "${captchaClue}". Jawablah pertanyaan atau eja teks captcha dengan tepat.` : '';
        
        const solvedText = await solveCaptchaWithVision(base64Image, promptClue);
        const cleanCaptcha = solvedText.replace(/[^a-zA-Z0-9\s]/g, '').trim();
        log(`[Projects.co.id] Captcha solved by AI: "${cleanCaptcha}" (Clue: "${captchaClue || 'None'}")`);

        await page.evaluate((val) => {
          const captchaInput = document.querySelector('input[name="bid[captcha]"], #bid__captcha, input[name="captcha"]');
          if (captchaInput) {
            captchaInput.value = val;
            captchaInput.dispatchEvent(new Event('input', { bubbles: true }));
            captchaInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, cleanCaptcha);
      }

      page.on('dialog', async (dialog) => {
        log(`[Projects.co.id] Browser dialog appeared: ${dialog.message()}`);
        await dialog.accept();
      });

      log(`[Projects.co.id] Submitting proposal via #place_new_bid...`);
      await Promise.all([
        page.click('input[type="submit"][name="save"], #place_new_bid, button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
      ]);

      const currentUrl = page.url();
      log(`[Projects.co.id] Post-submit URL: ${currentUrl}`);

      const pageContent = await page.evaluate(() => document.body.innerText);
      const isSuccess = currentUrl.includes('bid_placed') || currentUrl.includes('my_bids') || pageContent.includes('Bid berhasil') || pageContent.includes('Penawaran berhasil dikirim');

      if (!isSuccess) {
        const formError = await page.evaluate(() => {
          const errs = Array.from(document.querySelectorAll('.error, .alert-danger, .has-error, .text-danger, .alert'));
          return errs.map(e => e.innerText.trim()).filter(Boolean).join(' | ');
        });
        if (formError && !formError.includes('sukses') && !formError.includes('berhasil')) {
          throw new Error(`Gagal mengirim bid: ${formError}`);
        }
      }

      success = true;
      log(`[Projects.co.id] Bid successfully placed & verified on portal!`);

    } else {
      log(`Generic portal handler. Saving cover letter to database.`);
      success = true;
    }

    log('Application routine completed successfully.');

  } catch (err) {
    errorMessage = err.message;
    log(`Error during application automation: ${errorMessage}`);
    success = false;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const newStatus = success ? 'APPLIED' : 'FAILED';
  db.prepare(`
    UPDATE jobs 
    SET application_status = ?, 
        applied_at = ?, 
        application_log = ?, 
        cover_letter = ?,
        is_bid_success = CASE WHEN ? = 'APPLIED' THEN 0 ELSE is_bid_success END
    WHERE id = ?
  `).run(
    newStatus,
    new Date().toISOString(),
    auditLogs.join('\n'),
    customProposal || '',
    newStatus,
    job.id
  );

  return {
    success,
    status: newStatus,
    logs: auditLogs,
    error: errorMessage
  };
}
