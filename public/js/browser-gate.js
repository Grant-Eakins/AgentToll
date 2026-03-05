/**
 * AgentToll — Browser Gate
 * 
 * Client-side detection of agentic browsers (headless Chrome, Puppeteer,
 * Playwright, Selenium, etc.) with a payment overlay for automated access.
 * 
 * Drop this script into any HTML page to detect and paywall agentic browsers.
 * Real human users are never affected.
 * 
 * Usage:
 *   <script src="https://agenttoll-production.up.railway.app/js/browser-gate.js"
 *           data-publisher-key="YOUR_KEY"
 *           data-amount="0.05">
 *   </script>
 * 
 * Or self-hosted:
 *   <script src="/js/browser-gate.js"
 *           data-publisher-key="YOUR_KEY"
 *           data-amount="0.05"
 *           data-api-base="https://agenttoll-production.up.railway.app">
 *   </script>
 */
(function() {
  'use strict';

  // -----------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------
  const script = document.currentScript;
  const PUBLISHER_KEY = script?.getAttribute('data-publisher-key') || '';
  const AMOUNT = parseFloat(script?.getAttribute('data-amount') || '0.05');
  const API_BASE = script?.getAttribute('data-api-base') || 'https://agenttoll-production.up.railway.app';
  const MODE = script?.getAttribute('data-mode') || 'overlay'; // overlay | redirect | block
  const RESOURCE = script?.getAttribute('data-resource') || window.location.pathname;

  // -----------------------------------------------------------
  // Detection Signals
  // -----------------------------------------------------------

  /**
   * Detect whether the current browser is automated / headless.
   * Returns an object with { isBot: boolean, signals: string[], confidence: number }
   */
  function detectAgenticBrowser() {
    const signals = [];
    let score = 0;

    // 1. navigator.webdriver (set by Selenium, Puppeteer, Playwright)
    if (navigator.webdriver) {
      signals.push('navigator.webdriver=true');
      score += 40;
    }

    // 2. Headless Chrome indicators
    if (/HeadlessChrome/i.test(navigator.userAgent)) {
      signals.push('HeadlessChrome UA');
      score += 50;
    }

    // 3. Chrome without plugins (headless has 0 plugins)
    if (/Chrome/i.test(navigator.userAgent) && navigator.plugins && navigator.plugins.length === 0) {
      signals.push('Chrome with 0 plugins');
      score += 20;
    }

    // 4. Missing language / languages
    if (!navigator.language && !navigator.languages?.length) {
      signals.push('No language set');
      score += 15;
    }

    // 5. Phantom / Nightmare / other headless
    if (window._phantom || window.__nightmare || window.callPhantom) {
      signals.push('Phantom/Nightmare detected');
      score += 50;
    }

    // 6. Chrome DevTools protocol via window.chrome checks
    if (window.chrome) {
      if (!window.chrome.runtime || !window.chrome.runtime.id) {
        // Headless Chrome doesn't have runtime.id
        if (/Chrome/i.test(navigator.userAgent)) {
          signals.push('Chrome without runtime.id');
          score += 10;
        }
      }
    }

    // 7. Missing permissions API (some headless lack it)
    if (typeof navigator.permissions === 'undefined') {
      signals.push('No Permissions API');
      score += 10;
    }

    // 8. Screen dimensions of 0 or unusual
    if (window.outerWidth === 0 && window.outerHeight === 0) {
      signals.push('Zero outer dimensions');
      score += 25;
    }

    // 9. Media devices unavailable (headless has none)
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      // We'll check async below
    }

    // 10. Notification permission pre-denied
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      signals.push('Notifications pre-denied');
      score += 5;
    }

    // 11. Connection type = unknown (headless)
    if (navigator.connection && navigator.connection.type === 'unknown') {
      signals.push('Connection type unknown');
      score += 10;
    }

    // 12. CDP markers (Puppeteer/Playwright inject)
    if (window.cdc_adoQpoasnfa76pfcZLmcfl_Array ||
        window.cdc_adoQpoasnfa76pfcZLmcfl_Promise ||
        window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol ||
        document.$cdc_asdjflasutopfhvcZLmcfl_) {
      signals.push('CDP marker found');
      score += 50;
    }

    // 13. Selenium markers
    if (document.__selenium_unwrapped ||
        document.__webdriver_evaluate ||
        document.__driver_evaluate ||
        document.__webdriver_script_function ||
        document.__webdriver_script_func ||
        document.__webdriver_script_fn ||
        document.__fxdriver_evaluate ||
        document.__driver_unwrapped ||
        document.__webdriver_unwrapped ||
        window._Selenium_IDE_Recorder ||
        window._selenium ||
        document.__selenium_evaluate) {
      signals.push('Selenium marker found');
      score += 50;
    }

    // 14. Playwright-specific
    if (window.__playwright || window.__pw_manual) {
      signals.push('Playwright marker');
      score += 50;
    }

    // 15. Electron/Puppeteer process check
    if (navigator.userAgent.includes('Electron')) {
      signals.push('Electron detected');
      score += 15;
    }

    // 16. Known agentic browser UAs
    const agenticUAs = [
      /bot\b/i, /agent\b/i, /crawler\b/i, /spider\b/i, /scraper\b/i,
      /GPTBot/i, /ChatGPT/i, /Claude/i, /Anthropic/i,
      /PerplexityBot/i, /Bytespider/i, /Amazonbot/i,
      /CCBot/i, /Google-Extended/i, /Bingbot/i,
    ];
    for (const pattern of agenticUAs) {
      if (pattern.test(navigator.userAgent)) {
        signals.push(`Agentic UA: ${navigator.userAgent.match(pattern)?.[0]}`);
        score += 40;
      }
    }

    // 17. Touch support mismatch (mobile UA but no touch)
    if (/Mobile/i.test(navigator.userAgent) && !('ontouchstart' in window) && navigator.maxTouchPoints === 0) {
      signals.push('Mobile UA without touch');
      score += 15;
    }

    // 18. Hardware concurrency of 0 or undefined
    if (navigator.hardwareConcurrency === 0 || typeof navigator.hardwareConcurrency === 'undefined') {
      signals.push('No hardware concurrency');
      score += 10;
    }

    const confidence = Math.min(score, 100);
    return {
      isBot: confidence >= 40,
      signals,
      confidence,
    };
  }

  // -----------------------------------------------------------
  // Payment Overlay UI
  // -----------------------------------------------------------

  function createPaymentOverlay(detection) {
    const overlay = document.createElement('div');
    overlay.id = 'agenttoll-gate';
    overlay.innerHTML = `
      <style>
        #agenttoll-gate {
          position: fixed;
          inset: 0;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.92);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #fff;
        }
        #agenttoll-gate * { box-sizing: border-box; }
        .at-gate-card {
          background: #1a1a2e;
          border: 1px solid #333;
          border-radius: 16px;
          padding: 40px;
          max-width: 500px;
          width: 90%;
          text-align: center;
        }
        .at-gate-card h2 {
          margin: 0 0 8px;
          font-size: 22px;
          color: #00d4ff;
        }
        .at-gate-card .at-sub {
          color: #888;
          font-size: 14px;
          margin-bottom: 24px;
        }
        .at-gate-card .at-amount {
          font-size: 36px;
          font-weight: 700;
          color: #fff;
          margin: 16px 0 4px;
        }
        .at-gate-card .at-currency {
          font-size: 14px;
          color: #888;
          margin-bottom: 24px;
        }
        .at-gate-card .at-pay-btn {
          display: inline-block;
          padding: 14px 32px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          text-decoration: none;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .at-gate-card .at-pay-solana {
          background: linear-gradient(135deg, #9945FF, #14F195);
          color: #fff;
          margin-right: 8px;
        }
        .at-gate-card .at-pay-base {
          background: linear-gradient(135deg, #0052FF, #3B82F6);
          color: #fff;
        }
        .at-gate-card .at-pay-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0,212,255,0.3);
        }
        .at-gate-card .at-token-input {
          margin-top: 20px;
          display: flex;
          gap: 8px;
        }
        .at-gate-card .at-token-input input {
          flex: 1;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid #333;
          background: #0d0d1a;
          color: #fff;
          font-size: 14px;
        }
        .at-gate-card .at-token-input button {
          padding: 10px 18px;
          border-radius: 8px;
          background: #00d4ff;
          color: #000;
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .at-gate-card .at-signals {
          margin-top: 20px;
          font-size: 11px;
          color: #555;
        }
        .at-gate-card .at-x402 {
          margin-top: 16px;
          padding: 12px;
          background: #0d0d1a;
          border-radius: 8px;
          font-size: 12px;
          color: #666;
          text-align: left;
        }
        .at-gate-card .at-info {
          margin-top: 12px;
          font-size: 12px;
          color: #555;
        }
        .at-gate-card .at-dismiss {
          margin-top: 16px;
          background: none;
          border: 1px solid #333;
          color: #666;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          display: none;
        }
      </style>

      <div class="at-gate-card">
        <h2>🚧 Automated Access Detected</h2>
        <p class="at-sub">This content requires payment for automated / agentic access</p>

        <div class="at-amount">$${AMOUNT.toFixed(2)}</div>
        <div class="at-currency">USDC</div>

        <div style="margin-bottom: 16px;">
          <a class="at-pay-btn at-pay-solana" id="at-pay-solana" href="#">Pay with Solana</a>
          <a class="at-pay-btn at-pay-base" id="at-pay-base" href="#">Pay with Base</a>
        </div>

        <div class="at-token-input">
          <input type="text" id="at-token" placeholder="Paste payment token..." />
          <button id="at-verify">Verify</button>
        </div>

        <div class="at-x402" id="at-x402-info">
          <strong>x402 Protocol Info:</strong><br>
          Amount: ${AMOUNT} USDC | Networks: Solana, Base<br>
          API: ${API_BASE}/api/pay<br>
          Resource: ${RESOURCE}
        </div>

        <div class="at-signals">
          Detection: ${detection.signals.join(', ')} (confidence: ${detection.confidence}%)
        </div>

        <p class="at-info">
          Powered by <a href="${API_BASE}" style="color:#00d4ff;">AgentToll</a> — x402 payment protocol
        </p>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Wire up pay buttons
    const payUrlBase = `${API_BASE}/pay?publisher=${PUBLISHER_KEY}&amount=${AMOUNT}&resource=${encodeURIComponent(RESOURCE)}`;
    document.getElementById('at-pay-solana').href = payUrlBase + '&network=solana';
    document.getElementById('at-pay-base').href = payUrlBase + '&network=base';

    // Wire up token verification
    document.getElementById('at-verify').addEventListener('click', async () => {
      const token = document.getElementById('at-token').value.trim();
      if (!token) return;

      try {
        const resp = await fetch(`${API_BASE}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Publisher-Key': PUBLISHER_KEY,
          },
          body: JSON.stringify({ token, resource: RESOURCE }),
        });

        if (resp.ok) {
          // Access granted
          overlay.remove();
          document.body.style.overflow = '';
          sessionStorage.setItem('agenttoll_token', token);
        } else {
          alert('Invalid or expired token. Please pay first.');
        }
      } catch {
        alert('Verification failed. Try again.');
      }
    });
  }

  // -----------------------------------------------------------
  // Blocking modes
  // -----------------------------------------------------------

  function applyBlock(detection) {
    if (MODE === 'redirect') {
      window.location.href = `${API_BASE}/pay?publisher=${PUBLISHER_KEY}&amount=${AMOUNT}&resource=${encodeURIComponent(RESOURCE)}`;
      return;
    }

    if (MODE === 'block') {
      document.documentElement.innerHTML = `
        <html><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center;">
            <h1>402 Payment Required</h1>
            <p>Automated access to this content requires payment of ${AMOUNT} USDC.</p>
            <p><a href="${API_BASE}/pay?publisher=${PUBLISHER_KEY}&amount=${AMOUNT}&resource=${encodeURIComponent(RESOURCE)}" style="color:#00d4ff;">Pay Now</a></p>
          </div>
        </body></html>
      `;
      return;
    }

    // Default: overlay
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => createPaymentOverlay(detection));
    } else {
      createPaymentOverlay(detection);
    }
  }

  // -----------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------

  function init() {
    // If user already has a valid token, skip
    const existingToken = sessionStorage.getItem('agenttoll_token');
    if (existingToken) return;

    const detection = detectAgenticBrowser();

    if (!detection.isBot) return; // Real human, nothing to do

    console.log('[AgentToll] Agentic browser detected:', detection);

    // Report to analytics
    if (PUBLISHER_KEY) {
      try {
        navigator.sendBeacon(`${API_BASE}/api/analytics/agent-blocked`, JSON.stringify({
          publisher_key: PUBLISHER_KEY,
          signals: detection.signals,
          confidence: detection.confidence,
          user_agent: navigator.userAgent,
          resource: RESOURCE,
          source: 'browser-gate',
        }));
      } catch {
        // Non-critical
      }
    }

    applyBlock(detection);
  }

  // Also inject x402 meta tags for discoverability
  function injectX402Meta() {
    if (!PUBLISHER_KEY) return;

    const metaPayUrl = document.createElement('meta');
    metaPayUrl.name = 'x402:pay-url';
    metaPayUrl.content = `${API_BASE}/pay?publisher=${PUBLISHER_KEY}&amount=${AMOUNT}`;
    document.head.appendChild(metaPayUrl);

    const metaAmount = document.createElement('meta');
    metaAmount.name = 'x402:amount';
    metaAmount.content = String(AMOUNT);
    document.head.appendChild(metaAmount);

    const metaCurrency = document.createElement('meta');
    metaCurrency.name = 'x402:currency';
    metaCurrency.content = 'USDC';
    document.head.appendChild(metaCurrency);

    const metaNetworks = document.createElement('meta');
    metaNetworks.name = 'x402:networks';
    metaNetworks.content = 'solana,base';
    document.head.appendChild(metaNetworks);
  }

  // Run
  injectX402Meta();
  init();

  // Expose for programmatic use
  window.AgentTollBrowserGate = {
    detect: detectAgenticBrowser,
    block: applyBlock,
    config: { PUBLISHER_KEY, AMOUNT, API_BASE, MODE, RESOURCE },
  };

})();
