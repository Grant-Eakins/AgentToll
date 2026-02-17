/**
 * AgentToll SDK
 * One-line integration for AI agent micropayments
 * 
 * Usage (Express):
 *   app.use(require('@agenttoll/sdk')('your-api-key'))
 * 
 * Usage (Cloudflare Worker):
 *   import { tollgate } from '@agenttoll/sdk/edge'
 *   export default tollgate('your-api-key', { amount: 0.005 })
 */

const TOLL_API_BASE = process.env.TOLL_API_URL || 'https://toll.agenttoll.io';

// Agent detection patterns
const AGENT_PATTERNS = [
  // Platform-specific
  /agenttoll/i,
  /openclaw/i,
  /clawd/i,
  // Major AI providers
  /claude/i,
  /anthropic/i,
  /openai/i,
  /gpt-4/i,
  /chatgpt/i,
  /gemini/i,
  /google-ai/i,
  // Agent frameworks
  /langchain/i,
  /autogpt/i,
  /agentgpt/i,
  /babyagi/i,
  /crewai/i,
  /superagent/i,
  // Generic patterns
  /ai-agent/i,
  /bot\//i,
  /agent\//i,
];

/**
 * Detect if request is from an AgentToll/AI agent
 */
function isAgent(req) {
  const ua = req.headers['user-agent'] || '';
  const agentHeader = req.headers['x-agent-type'] || req.headers['x-agenttoll-id'] || '';
  
  // Check User-Agent
  if (AGENT_PATTERNS.some(pattern => pattern.test(ua))) return true;
  
  // Check custom agent headers
  if (agentHeader) return true;
  
  // Check x402 capability header (agents advertise payment capability)
  if (req.headers['x-402-capable'] === 'true') return true;
  
  return false;
}

/**
 * Verify payment token
 */
async function verifyToken(token, apiKey) {
  try {
    const res = await fetch(`${TOLL_API_BASE}/api/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Publisher-Key': apiKey,
      },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

/**
 * Build 402 Payment Required response for agents
 */
function build402Response(req, options) {
  const { apiKey, amount, resource } = options;
  const requestedUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  
  const paymentInfo = {
    status: 402,
    message: 'Payment Required',
    agent_instructions: `To access this resource, pay ${amount} USDC via the payment URL below. After payment, retry with the returned token in Authorization header.`,
    payment: {
      amount: amount,
      currency: 'USDC',
      network: 'solana',
      pay_url: `${TOLL_API_BASE}/pay?publisher=${apiKey}&amount=${amount}&resource=${encodeURIComponent(requestedUrl)}`,
      api_endpoint: `${TOLL_API_BASE}/api/pay`,
    },
    x402: {
      version: 1,
      amount: amount,
      currency: 'USDC',
      receiver: options.walletAddress || 'pending',
      network: 'solana-mainnet',
      description: `Access to ${resource || requestedUrl}`,
    },
    retry: {
      method: req.method,
      url: requestedUrl,
      headers: {
        'Authorization': 'Bearer <token_from_payment>',
      },
    },
  };

  return paymentInfo;
}

/**
 * Express/Connect middleware factory
 * 
 * @param {string} apiKey - Your publisher API key from toll.agenttoll.io
 * @param {object} options - Configuration options
 * @returns {function} Express middleware
 * 
 * @example
 * // One line integration
 * app.use(tollbooth('pk_live_xxx'));
 * 
 * @example
 * // With options
 * app.use(tollbooth('pk_live_xxx', { 
 *   amount: 0.01,
 *   paths: ['/api/premium/*'],
 *   freeForHumans: true 
 * }));
 */
function tollbooth(apiKey, options = {}) {
  const config = {
    amount: options.amount || 0.005,
    paths: options.paths || ['*'],
    freeForHumans: options.freeForHumans ?? false,
    walletAddress: options.walletAddress || null,
    onPayment: options.onPayment || null,
    bypassHeader: options.bypassHeader || null,
  };

  return async function tollboothMiddleware(req, res, next) {
    // Check bypass header (for internal services)
    if (config.bypassHeader && req.headers[config.bypassHeader.toLowerCase()]) {
      return next();
    }

    // Check if path should be tolled
    const shouldToll = config.paths.some(pattern => {
      if (pattern === '*') return true;
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(req.path);
    });

    if (!shouldToll) return next();

    // Detect if agent
    const agentRequest = isAgent(req);

    // If free for humans and not an agent, pass through
    if (config.freeForHumans && !agentRequest) {
      return next();
    }

    // Check for existing payment token
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (token) {
      const valid = await verifyToken(token, apiKey);
      if (valid) {
        // Track successful access
        req.tollPaid = true;
        req.tollAgent = agentRequest;
        return next();
      }
    }

    // No valid token - return 402 Payment Required
    const paymentInfo = build402Response(req, {
      apiKey,
      amount: config.amount,
      resource: req.path,
      walletAddress: config.walletAddress,
    });

    // Set x402 headers for agent parsing
    res.setHeader('X-402-Version', '1');
    res.setHeader('X-402-Amount', config.amount.toString());
    res.setHeader('X-402-Currency', 'USDC');
    res.setHeader('X-402-Pay-URL', paymentInfo.payment.pay_url);
    res.setHeader('X-402-Network', 'solana');
    res.setHeader('Content-Type', 'application/json');

    return res.status(402).json(paymentInfo);
  };
}

/**
 * Protect specific routes (alternative API)
 * 
 * @example
 * app.get('/premium', tollbooth.protect('pk_xxx', { amount: 0.01 }), handler)
 */
tollbooth.protect = function(apiKey, options = {}) {
  return tollbooth(apiKey, { ...options, paths: ['*'] });
};

/**
 * Agent-only tollbooth (humans pass free)
 * 
 * @example
 * app.use(tollbooth.agentsOnly('pk_xxx'))
 */
tollbooth.agentsOnly = function(apiKey, options = {}) {
  return tollbooth(apiKey, { ...options, freeForHumans: true });
};

/**
 * Check if request has valid toll payment
 */
tollbooth.hasPaid = function(req) {
  return req.tollPaid === true;
};

/**
 * Check if request is from an agent
 */
tollbooth.isAgent = isAgent;

// Export for different module systems
module.exports = tollbooth;
module.exports.default = tollbooth;
module.exports.tollbooth = tollbooth;
module.exports.isAgent = isAgent;
