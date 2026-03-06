/**
 * AgentToll — Content Gate Middleware
 * 
 * Protects HTML/content pages from agentic search crawlers and scrapers.
 * Unlike the API tollbooth which returns JSON 402, this middleware:
 *   - Serves a stripped HTML page with payment prompt for bots
 *   - Lets real browser users through free
 *   - Returns proper x402 headers for capable agents
 * 
 * @example
 * // Protect all content pages
 * app.use(contentGate('pk_live_xxx'));
 * 
 * // Protect specific paths
 * app.use('/blog', contentGate('pk_live_xxx', { amount: 0.001 }));
 * app.use('/premium', contentGate('pk_live_xxx', { amount: 0.01 }));
 */

const TOLL_API_BASE = process.env.TOLL_API_URL || 'https://agenttoll-production.up.railway.app';

// Known AI search / scraper user-agent patterns
const AGENTIC_SEARCH_PATTERNS = [
  // AI search engines
  /gptbot/i, /chatgpt-user/i, /oai-searchbot/i,
  /perplexitybot/i, /perplexity/i,
  /google-extended/i,
  /claudebot/i, /claude-web/i, /anthropic-ai/i,
  /ccbot/i,        // Common Crawl (used to train models)
  /bytespider/i,   // ByteDance / TikTok AI
  /amazonbot/i,
  /petalbot/i,
  /cohere-ai/i,
  /meta-externalagent/i,
  // SEO scrapers
  /semrushbot/i, /ahrefsbot/i, /dataforseo/i, /serpapi/i, /mj12bot/i,
  /dotbot/i, /rogerbot/i, /blexbot/i,
  // Generic scrapers & HTTP libraries
  /scrapy/i, /python-requests/i, /httpx/i, /axios/i,
  /node-fetch/i, /undici/i, /go-http-client/i,
  /curl/i, /wget/i, /libwww-perl/i, /java\//i,
  // Headless browsers
  /headlesschrome/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
  // Generic catch-all
  /bot[\s\/\-_]/i, /[\s\/\-_]bot$/i,
  /crawler/i, /spider/i, /scraper/i,
  /agent[\s\/\-_]/i, /[\s\/\-_]agent$/i,
];

// Patterns that should ALWAYS pass (real browsers, social previews)
const HUMAN_BROWSER_PATTERNS = [
  /mozilla\/5\.0.*(?:chrome|firefox|safari|edg|opr)\/[\d]/i,
];

// Social preview bots we might want to allow for link unfurling
const SOCIAL_PREVIEW_BOTS = [
  /twitterbot/i, /facebookbot/i, /facebot/i,
  /linkedinbot/i, /slackbot/i, /discordbot/i,
  /whatsapp/i, /telegrambot/i,
];

/**
 * Detect if request is from an agentic search / scraper
 */
function isAgenticCrawler(req) {
  const ua = req.headers['user-agent'] || '';
  
  // Check for x402 capability header
  if (req.headers['x-402-capable'] === 'true') return true;
  
  // Check for agent identification headers
  if (req.headers['x-agent-type'] || req.headers['x-agenttoll-id']) return true;

  // Social preview bots — allow by default (they just need meta tags)
  if (SOCIAL_PREVIEW_BOTS.some(p => p.test(ua))) return false;

  // Check against agentic search patterns
  if (AGENTIC_SEARCH_PATTERNS.some(p => p.test(ua))) return true;

  // If it looks like a real browser, allow
  if (HUMAN_BROWSER_PATTERNS.some(p => p.test(ua))) return false;

  // No User-Agent at all — suspicious
  if (!ua || ua.length < 10) return true;

  return false;
}

/**
 * Build a gated HTML page that replaces actual content for bots
 */
function buildGatedHTML(req, options) {
  const { apiKey, amount, resource } = options;
  const requestedUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const payUrl = `${TOLL_API_BASE}/pay?publisher=${apiKey}&amount=${amount}&resource=${encodeURIComponent(requestedUrl)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Paywalled — AgentToll</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="x402:amount" content="${amount}">
  <meta name="x402:currency" content="USDC">
  <meta name="x402:pay-url" content="${payUrl}">
  <meta name="x402:networks" content="solana,base">
</head>
<body>
  <h1>402 — Payment Required</h1>
  <p>This content is protected by AgentToll. AI agents and automated crawlers must pay to access.</p>
  
  <section id="x402-payment">
    <h2>Payment Details</h2>
    <ul>
      <li><strong>Amount:</strong> ${amount} USDC</li>
      <li><strong>Currency:</strong> USDC</li>
      <li><strong>Networks:</strong> Solana, Base</li>
      <li><strong>Resource:</strong> ${resource || requestedUrl}</li>
    </ul>
    <p>Pay via: <a href="${payUrl}">${payUrl}</a></p>
    <p>API endpoint: <code>POST ${TOLL_API_BASE}/api/pay</code></p>
  </section>

  <section id="x402-instructions">
    <h2>For AI Agents</h2>
    <p>To access this content programmatically:</p>
    <ol>
      <li>Send ${amount} USDC to the publisher wallet on Solana or Base</li>
      <li>POST the transaction signature to ${TOLL_API_BASE}/api/pay</li>
      <li>Receive an access token</li>
      <li>Retry this URL with <code>Authorization: Bearer &lt;token&gt;</code></li>
    </ol>
  </section>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "isAccessibleForFree": false,
    "hasPart": {
      "@type": "WebPageElement",
      "isAccessibleForFree": false,
      "cssSelector": "#content"
    }
  }
  </script>
</body>
</html>`;
}

/**
 * Content Gate middleware factory
 * 
 * @param {string} apiKey - Publisher API key
 * @param {object} options - Configuration
 * @param {number} options.amount - USDC price (default: 0.001)
 * @param {string[]} options.paths - Glob patterns to protect (default: ['*'])
 * @param {boolean} options.allowSocialPreviews - Allow social bot previews (default: true)
 * @param {string} options.bypassHeader - Header name for internal bypass
 * @param {function} options.onBlocked - Callback when a crawler is blocked
 * @returns {function} Express middleware
 */
export function contentGate(apiKey, options = {}) {
  // ── Missing API key? Loud warning with setup instructions ──
  if (!apiKey || apiKey === 'undefined' || apiKey === 'your-api-key') {
    console.warn([
      '',
      '\x1b[33m⚠️  AgentToll: No API key provided!\x1b[0m',
      '',
      '   Run: \x1b[1mnpx agenttoll init\x1b[0m',
      '   Or visit: https://www.agenttoll.xyz/dashboard',
      '',
    ].join('\n'));
  }

  const config = {
    amount: options.amount || 0.001,
    paths: options.paths || ['*'],
    allowSocialPreviews: options.allowSocialPreviews ?? true,
    bypassHeader: options.bypassHeader || null,
    onBlocked: options.onBlocked || null,
  };

  return async function contentGateMiddleware(req, res, next) {
    // Only gate GET requests (content pages)
    if (req.method !== 'GET') return next();

    // Check bypass header
    if (config.bypassHeader && req.headers[config.bypassHeader.toLowerCase()]) {
      return next();
    }

    // Check if path should be gated
    const shouldGate = config.paths.some(pattern => {
      if (pattern === '*') return true;
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(req.path);
    });

    if (!shouldGate) return next();

    // Check if this is an agentic crawler
    if (!isAgenticCrawler(req)) {
      return next(); // Real human browser — pass through
    }

    // Check for valid payment token
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (token) {
      try {
        const verifyRes = await fetch(`${TOLL_API_BASE}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Publisher-Key': apiKey,
          },
          body: JSON.stringify({ token }),
        });
        const result = await verifyRes.json();
        if (result.valid === true) {
          req.tollPaid = true;
          return next();
        }
      } catch {
        // Verification failed, continue to block
      }
    }

    // Report blocked event
    try {
      fetch(`${TOLL_API_BASE}/api/analytics/agent-stopped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publisher: apiKey,
          resource: req.path,
          agent_id: req.headers['x-agenttoll-id'] || req.headers['x-agent-id'] || null,
          agent_type: req.headers['x-agent-type'] || 'search-crawler',
          user_agent: req.headers['user-agent'] || null,
          amount_required: config.amount,
        }),
      }).catch(() => {});
    } catch {}

    // Callback
    if (config.onBlocked) {
      config.onBlocked({
        path: req.path,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
    }

    // Return gated HTML with x402 headers
    const requestedUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const payUrl = `${TOLL_API_BASE}/pay?publisher=${apiKey}&amount=${config.amount}&resource=${encodeURIComponent(requestedUrl)}`;

    res.setHeader('X-402-Version', '1');
    res.setHeader('X-402-Amount', config.amount.toString());
    res.setHeader('X-402-Currency', 'USDC');
    res.setHeader('X-402-Pay-URL', payUrl);
    res.setHeader('X-402-Supported-Networks', 'solana,base');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    res.status(402).send(buildGatedHTML(req, {
      apiKey,
      amount: config.amount,
      resource: req.path,
    }));
  };
}

/**
 * Generate robots.txt content with x402 payment signals
 * 
 * @param {object} options
 * @param {string} options.apiKey - Publisher API key
 * @param {number} options.amount - Default USDC amount
 * @param {string[]} options.disallowPaths - Paths to disallow (default: all)
 * @param {string[]} options.allowPaths - Paths to allow for all bots
 * @returns {string} robots.txt content
 */
export function generateRobotsTxt(options = {}) {
  const apiKey = options.apiKey || '';
  const amount = options.amount || 0.001;
  const disallowPaths = options.disallowPaths || ['/'];
  const allowPaths = options.allowPaths || [];
  const payUrl = `${TOLL_API_BASE}/pay?publisher=${apiKey}&amount=${amount}`;

  const aiCrawlers = [
    'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
    'Google-Extended', 'Googlebot',
    'ClaudeBot', 'Claude-Web', 'Anthropic-AI',
    'PerplexityBot',
    'CCBot', 'ByteSpider', 'Bytespider',
    'AmazonBot', 'PetalBot',
    'Cohere-AI', 'Meta-ExternalAgent',
    'SemrushBot', 'AhrefsBot', 'DataForSeoBot',
    'Scrapy', 'MJ12bot', 'DotBot',
  ];

  let txt = `# AgentToll robots.txt — x402 Payment Required
# AI agents and crawlers must pay to access this content.
# Learn more: https://agenttoll-production.up.railway.app/docs

# x402 Payment Information
# X-402-Amount: ${amount}
# X-402-Currency: USDC
# X-402-Networks: solana, base
# X-402-Pay-URL: ${payUrl}

`;

  // Block all AI crawlers
  for (const bot of aiCrawlers) {
    txt += `User-agent: ${bot}\n`;
    for (const path of disallowPaths) {
      txt += `Disallow: ${path}\n`;
    }
    txt += `# Pay to access: ${payUrl}\n\n`;
  }

  // Default: allow standard crawlers with allowed paths
  txt += `User-agent: *\n`;
  for (const path of allowPaths) {
    txt += `Allow: ${path}\n`;
  }
  txt += `Sitemap: /sitemap.xml\n\n`;

  // x402 metadata (custom extension)
  txt += `# x402 Protocol\n`;
  txt += `# Agents with payment capability can access blocked resources\n`;
  txt += `# by paying via the x402 protocol.\n`;
  txt += `# Documentation: ${TOLL_API_BASE}/docs#x402\n`;
  txt += `# API: POST ${TOLL_API_BASE}/api/pay\n`;

  return txt;
}

export { isAgenticCrawler };
export default contentGate;
