/**
 * AgentToll - Edge Runtime SDK
 * For Cloudflare Workers, Vercel Edge, Deno Deploy
 * 
 * @example
 * import { tollgate } from '@agenttoll/sdk/edge'
 * export default tollgate('your-api-key')
 */

const TOLL_API_BASE = 'https://agenttoll-production.up.railway.app';

const AGENT_PATTERNS = [
  /agenttoll/i, /openclaw/i, /clawd/i, /openai-agent/i,
  /anthropic-agent/i, /autogpt/i, /agentgpt/i, /babyagi/i,
];

function isAgent(request) {
  const ua = request.headers.get('user-agent') || '';
  const agentHeader = request.headers.get('x-agent-type') || request.headers.get('x-agenttoll-id') || '';
  if (AGENT_PATTERNS.some(p => p.test(ua))) return true;
  if (agentHeader) return true;
  if (request.headers.get('x-402-capable') === 'true') return true;
  return false;
}

async function verifyToken(token, apiKey) {
  try {
    const res = await fetch(`${TOLL_API_BASE}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Publisher-Key': apiKey },
      body: JSON.stringify({ token }),
    });
    return (await res.json()).valid === true;
  } catch {
    return false;
  }
}

function build402(request, apiKey, amount) {
  const url = new URL(request.url);
  return {
    status: 402,
    message: 'Payment Required',
    agent_instructions: `Pay ${amount} USDC to access. Use returned token in Authorization header.`,
    payment: {
      amount,
      currency: 'USDC',
      network: 'solana',
      pay_url: `${TOLL_API_BASE}/pay?publisher=${apiKey}&amount=${amount}&resource=${encodeURIComponent(url.href)}`,
      api_endpoint: `${TOLL_API_BASE}/api/pay`,
    },
    x402: { version: 1, amount, currency: 'USDC', network: 'solana-mainnet' },
    retry: { method: request.method, url: url.href, headers: { 'Authorization': 'Bearer <token>' } },
  };
}

/**
 * Edge-compatible tollgate wrapper
 * Wraps your handler and gates it behind payment
 * 
 * @example
 * // Cloudflare Worker
 * import { tollgate } from '@agenttoll/sdk/edge'
 * 
 * export default tollgate('pk_live_xxx', {
 *   amount: 0.005,
 *   freeForHumans: true,
 *   handler: async (request) => {
 *     return new Response('Premium content!')
 *   }
 * })
 */
export function tollgate(apiKey, options = {}) {
  const amount = options.amount || 0.005;
  const freeForHumans = options.freeForHumans ?? false;
  const handler = options.handler;

  return {
    async fetch(request, env, ctx) {
      const agent = isAgent(request);

      // Free for humans if configured
      if (freeForHumans && !agent) {
        return handler ? handler(request, env, ctx) : new Response('OK');
      }

      // Check payment token
      const auth = request.headers.get('authorization') || '';
      const token = auth.replace(/^Bearer\s+/i, '');

      if (token && await verifyToken(token, apiKey)) {
        return handler ? handler(request, env, ctx) : new Response('OK');
      }

      // Return 402
      const paymentInfo = build402(request, apiKey, amount);
      return new Response(JSON.stringify(paymentInfo), {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'X-402-Version': '1',
          'X-402-Amount': amount.toString(),
          'X-402-Currency': 'USDC',
          'X-402-Pay-URL': paymentInfo.payment.pay_url,
        },
      });
    }
  };
}

/**
 * Middleware for edge frameworks (Hono, itty-router, etc.)
 */
export function tollMiddleware(apiKey, options = {}) {
  const amount = options.amount || 0.005;
  const freeForHumans = options.freeForHumans ?? false;

  return async (request, next) => {
    const agent = isAgent(request);
    if (freeForHumans && !agent) return next();

    const auth = request.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token && await verifyToken(token, apiKey)) return next();

    const paymentInfo = build402(request, apiKey, amount);
    return new Response(JSON.stringify(paymentInfo), {
      status: 402,
      headers: { 'Content-Type': 'application/json', 'X-402-Version': '1' },
    });
  };
}

export { isAgent };
