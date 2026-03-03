import { Router } from 'express';

const router = Router();

/**
 * GET /api/docs
 * Returns JSON API documentation
 */
router.get('/', (req, res) => {
  res.json(getApiDocs());
});

/**
 * Comprehensive API documentation
 */
function getApiDocs() {
  return {
    name: 'AgentToll API',
    version: '1.0.0',
    description: 'Micropayment infrastructure for AI agents. Gate your API/content, agents pay in USDC.',
    base_url: process.env.API_BASE_URL || 'https://agenttoll-production.up.railway.app',
    
    authentication: {
      publisher: {
        header: 'X-Publisher-Key',
        description: 'Your publisher API key (pk_live_xxx). Required for publisher endpoints.',
        example: 'X-Publisher-Key: pk_live_abc123...',
      },
      agent: {
        header: 'Authorization',
        description: 'Bearer token obtained after payment. Required for accessing tolled resources.',
        example: 'Authorization: Bearer eyJhbGciOiJIUzI1...',
      },
    },

    networks: {
      solana: {
        name: 'Solana Mainnet',
        currency: 'USDC',
        usdc_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        confirmation: 'confirmed',
      },
      base: {
        name: 'Base (Ethereum L2)',
        chain_id: 8453,
        currency: 'USDC',
        usdc_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
      },
    },

    pricing_tiers: {
      standard: { fee_percent: 5, description: 'Default tier for all publishers' },
      premium: { fee_percent: 3, description: 'High-volume publishers (>$1000/mo)' },
      enterprise: { fee_percent: 1, description: 'Custom contracts, can set custom_fee_percent' },
    },

    access_modes: {
      'per-request': {
        description: 'Token valid for exactly 1 API request',
        use_case: 'High-value queries, expensive computations, prevent bulk scraping',
        token_expiry: '5 minutes max (single use)',
        example_pricing: '$0.001 per query',
      },
      'session': {
        description: 'Token valid for specific resource within time window',
        use_case: 'General API access, repeated queries to same endpoint',
        token_expiry: 'Configurable (1m to 7d)',
        example_pricing: '$0.01 for 1 hour access to /api/weather',
      },
      'pass': {
        description: 'Token valid for ALL publisher endpoints within time window',
        use_case: 'Content sites, documentation, full API access',
        token_expiry: 'Configurable (1m to 7d)',
        example_pricing: '$0.50 for 24h full site access',
      },
    },

    endpoints: {
      // ============ PAYMENT ENDPOINTS ============
      payment: {
        'POST /api/pay': {
          description: 'Submit payment proof and receive access token',
          auth: 'None (public)',
          body: {
            publisher: { type: 'string', required: true, description: 'Publisher API key' },
            amount: { type: 'number', required: true, description: 'Amount in USDC' },
            resource: { type: 'string', required: false, description: 'URL being accessed' },
            tx_signature: { type: 'string', required: 'for solana', description: 'Solana transaction signature' },
            tx_hash: { type: 'string', required: 'for base', description: 'Base transaction hash' },
            network: { type: 'string', default: 'solana', enum: ['solana', 'base'] },
            agent_id: { type: 'string', required: false, description: 'Your agent identifier' },
          },
          response: {
            success: true,
            token: 'eyJhbG...',
            expires_in: 3600,
            access: {
              mode: 'session',
              duration: '1h',
              scope: 'single resource',
              uses: 'unlimited within duration',
            },
            payment_summary: {
              total_paid: 0.01,
              publisher_received: 0.0095,
              platform_fee: 0.0005,
            },
          },
        },

        'GET /api/pay/quote': {
          description: 'Get payment details before paying (wallet address, amount, fees, access mode)',
          auth: 'None (public)',
          query: {
            publisher: { type: 'string', required: true, description: 'Publisher API key' },
            resource: { type: 'string', required: false, description: 'URL to access' },
            amount: { type: 'number', required: false, description: 'Override default amount' },
            network: { type: 'string', default: 'solana', enum: ['solana', 'base'] },
          },
          response: {
            amount: 0.05,
            currency: 'USDC',
            network: 'solana',
            receiver_wallet: 'ABC123...',
            fee_breakdown: {
              total: 0.05,
              publisher_receives: 0.0475,
              platform_fee: 0.0025,
              platform_fee_percent: 5,
            },
            access: {
              mode: 'session',
              duration: '1h',
              description: 'Session - access to this resource for 1h',
            },
          },
        },

        'POST /api/pay/intent': {
          description: 'Get pre-built transaction to sign (for advanced agents)',
          auth: 'None (public)',
          body: {
            publisher: { type: 'string', required: true },
            amount: { type: 'number', required: false },
            payer_wallet: { type: 'string', required: true, description: 'Your wallet address' },
            network: { type: 'string', default: 'solana' },
          },
          response: {
            intent_id: 'intent_sol_123...',
            transaction: '... or transaction object for Base',
            expires_at: 1708123456000,
          },
        },
      },

      // ============ VERIFICATION ENDPOINTS ============
      verification: {
        'POST /api/verify': {
          description: 'Verify an access token (used by publisher middleware)',
          auth: 'X-Publisher-Key (optional)',
          body: {
            token: { type: 'string', required: true, description: 'JWT access token' },
          },
          response: {
            valid: true,
            publisher: 'pk_live_xxx',
            resource: 'https://...',
            expires_at: 1708123456000,
            remaining_seconds: 3542,
          },
        },

        'GET /api/verify/check': {
          description: 'Quick token validity check',
          auth: 'Authorization header or ?token= query',
          response: { valid: true, expires_at: 1708123456000 },
        },
      },

      // ============ PUBLISHER ENDPOINTS ============
      publisher: {
        'POST /api/publisher/register': {
          description: 'Register as a new publisher. Only need ONE wallet (Solana OR Base).',
          auth: 'None',
          body: {
            name: { type: 'string', required: true, description: 'Publisher/company name' },
            email: { type: 'string', required: true, description: 'Contact email' },
            website: { type: 'string', required: false },
            wallet_address: { type: 'string', required: false, description: 'Solana wallet (legacy)' },
            wallets: {
              type: 'object',
              required: 'at least one network',
              description: 'Multi-network wallets - only need one!',
              properties: {
                solana: 'Solana wallet address (optional)',
                base: 'Base (0x) wallet address (optional)',
              },
            },
          },
          response: {
            success: true,
            publisher_id: 'uuid',
            api_key: 'pk_live_xxx',
            secret_key: 'sk_live_xxx (save this!)',
          },
        },

        'GET /api/publisher/me': {
          description: 'Get your publisher profile',
          auth: 'X-Publisher-Key',
          response: { id: '...', name: '...', wallets: {}, settings: {}, tier: 'standard' },
        },

        'PATCH /api/publisher/settings': {
          description: 'Update toll settings including access mode',
          auth: 'X-Publisher-Key',
          body: {
            default_amount: { type: 'number', description: 'Default toll amount in USDC' },
            free_for_humans: { type: 'boolean', description: 'Let humans through free' },
            paths: { type: 'array', description: 'Paths to toll (glob patterns)' },
            custom_fee_percent: { type: 'number', description: 'Custom fee (enterprise only, 0-15%)' },
            access_mode: { 
              type: 'string', 
              enum: ['per-request', 'session', 'pass'],
              description: 'How tokens grant access (default: session)',
            },
            access_duration: { 
              type: 'string', 
              enum: ['1m', '5m', '10m', '30m', '1h', '2h', '6h', '12h', '24h', '7d'],
              description: 'Token validity duration (for session/pass modes)',
            },
          },
          examples: {
            per_request: {
              description: 'High-value API: charge per query',
              body: { access_mode: 'per-request', default_amount: 0.001 },
            },
            session: {
              description: 'Standard API: time-limited access',
              body: { access_mode: 'session', access_duration: '1h', default_amount: 0.01 },
            },
            site_pass: {
              description: 'Content site: full access for duration',
              body: { access_mode: 'pass', access_duration: '24h', default_amount: 0.50 },
            },
          },
        },

        'PATCH /api/publisher/wallets': {
          description: 'Update wallet addresses',
          auth: 'X-Publisher-Key',
          body: {
            solana: { type: 'string', description: 'Solana wallet address' },
            base: { type: 'string', description: 'Base wallet (0x...)' },
          },
        },

        'GET /api/publisher/revenue': {
          description: 'Get revenue breakdown and fee info',
          auth: 'X-Publisher-Key',
          response: {
            tier: 'standard',
            fees: { effective_fee_percent: 5, custom_fee_percent: null },
            revenue: { total_gross: 100, total_net: 95, platform_fees_paid: 5 },
          },
        },

        'POST /api/publisher/webhook': {
          description: 'Set up payment webhooks',
          auth: 'X-Publisher-Key',
          body: {
            webhook_url: { type: 'string', required: true },
            events: { type: 'array', default: ['payment.completed', 'payment.failed'] },
          },
          response: { webhook_secret: 'whsec_xxx' },
        },
      },

      // ============ ANALYTICS ENDPOINTS ============
      analytics: {
        'GET /api/analytics': {
          description: 'General analytics dashboard',
          auth: 'X-Publisher-Key',
          query: { timeframe: { default: '24h', enum: ['1h', '24h', '7d', '30d'] } },
          response: {
            total_payments: 1234,
            total_revenue_usdc: 45.67,
            unique_agents: 89,
            agent_breakdown: { agenttoll: 500, openclaw: 300, other: 434 },
          },
        },

        'GET /api/analytics/agents': {
          description: 'AgentToll/agent-specific analytics',
          auth: 'X-Publisher-Key',
          response: {
            by_agent_type: { agenttoll: { count: 500, revenue: 25 }, openclaw: {} },
            top_paying_agents: [],
          },
        },

        'GET /api/analytics/revenue': {
          description: 'Revenue breakdown over time',
          auth: 'X-Publisher-Key',
          query: { timeframe: { default: '7d' } },
          response: {
            gross_revenue_usdc: 100,
            platform_fee_usdc: 5,
            net_revenue_usdc: 95,
            daily_breakdown: { '2026-02-15': 50, '2026-02-16': 50 },
          },
        },

        'GET /api/analytics/moltbook': {
          description: 'AgentToll ecosystem traffic analytics',
          auth: 'X-Publisher-Key',
          query: { timeframe: { default: '24h' } },
          response: {
            moltbook_traffic: { total_payments: 0, total_revenue: 0, unique_agents: 0 },
            by_framework: { agenttoll: {}, openclaw: {} },
            top_moltbook_agents: [],
            insights: { agenttoll_share_percent: 0 },
          },
        },
      },
    },

    // ============ HTTP 402 RESPONSE FORMAT ============
    http_402_format: {
      description: 'Format returned by tollbooth middleware when payment is required',
      example: {
        status: 402,
        message: 'Payment Required',
        agent_instructions: 'Pay 0.05 USDC via the payment URL below...',
        payment: {
          amount: 0.05,
          currency: 'USDC',
          network: 'solana',
          pay_url: 'https://toll.agenttoll.io/pay?publisher=pk_xxx&amount=0.05&resource=...',
          api_endpoint: 'https://toll.agenttoll.io/api/pay',
        },
        x402: {
          version: 1,
          amount: 0.05,
          currency: 'USDC',
          network: 'solana-mainnet',
        },
        retry: {
          url: 'https://your-api.com/data',
          headers: { Authorization: 'Bearer <token_from_payment>' },
        },
      },
      headers: {
        'X-402-Version': '1',
        'X-402-Amount': '0.05',
        'X-402-Currency': 'USDC',
        'X-402-Pay-URL': 'https://toll.agenttoll.io/pay?...',
      },
    },

    // ============ AGENT TOOL SCHEMA ============
    agenttoll_tool: {
      name: 'pay_toll',
      description: 'Tool for AgentToll/OpenClaw agents to pay tolls',
      parameters: {
        url: { type: 'string', required: true, description: 'URL requiring payment' },
        amount: { type: 'number', required: true, description: 'Amount in USDC' },
        max_amount: { type: 'number', default: 0.05, description: 'Safety limit' },
        reason: { type: 'string', description: 'Why this resource is valuable' },
      },
    },

    // ============ SDK INTEGRATION ============
    sdk_examples: {
      express_oneliner: "app.use(require('@agenttoll/sdk')('pk_live_xxx'))",
      express_options: `app.use(tollbooth('pk_live_xxx', { 
  amount: 0.01, 
  paths: ['/api/premium/*'],
  freeForHumans: true 
}))`,
      cloudflare: "export default tollgate('pk_live_xxx', { amount: 0.05 })",
      nextjs: "const toll = tollMiddleware('pk_live_xxx')",
    },

    // ============ ERROR CODES ============
    error_codes: {
      400: 'Bad Request - Missing or invalid parameters',
      401: 'Unauthorized - Invalid or missing API key',
      402: 'Payment Required - Toll not paid',
      403: 'Forbidden - Action not allowed',
      404: 'Not Found - Publisher or resource not found',
      500: 'Internal Error - Server-side issue, retry later',
    },

    rate_limits: {
      default: '1000 requests/minute per IP',
      authenticated: '5000 requests/minute per publisher key',
      note: 'Contact us for higher limits',
    },

    // ============ ADMIN ENDPOINTS ============
    admin: {
      'GET /api/config/status': {
        description: 'Platform configuration status (admin only)',
        auth: 'X-Admin-Key header',
        response: {
          platform: { name: 'agenttoll', version: '1.0.0' },
          wallets: {
            solana: { configured: true, address: 'ABC...' },
            base: { configured: false },
          },
          supported_networks: ['solana'],
          fee_percent: 5,
          jwt_configured: true,
        },
      },
    },

    notes: {
      wallet_requirements: 'Publishers only need ONE wallet (Solana OR Base). Platform fee is collected separately.',
      fee_collection: 'For MVP, publishers receive full payment. Platform fee tracking is logged for later invoicing.',
      agent_interop: 'Follows x402 protocol for cross-agent payment compatibility.',
    },
  };
}

export { router as docsRoutes };
