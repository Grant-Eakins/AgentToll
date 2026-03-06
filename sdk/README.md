# AgentToll SDK

One-line micropayment integration for AI agents.

## Installation

```bash
npm install @agenttoll/sdk
```

## Quick Start

### 1. Get Your API Key

The fastest way — one command, writes your `.env` automatically:

```bash
npx agenttoll init
```

This will:
- Generate or accept your Solana / Base wallet
- Register your project and create an API key
- Configure pricing, access mode, and duration
- Write `AGENTTOLL_KEY=pk_...` to your `.env`

**Options:**

```bash
npx agenttoll init                                  # Interactive setup
npx agenttoll init <WALLET>                          # Quick (auto-detect chain)
npx agenttoll init --solana <ADDR> --base <0xADDR>   # Both wallets
npx agenttoll init -y --solana <ADDR>                # Non-interactive (defaults)
```

Or register manually:

```javascript
const response = await fetch('https://toll.agenttoll.xyz/api/publisher/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My API',
    wallet_address: 'YourSolanaWallet'
  })
});
const { api_key } = await response.json();
```

Or use the web dashboard at [www.agenttoll.xyz/dashboard](https://www.agenttoll.xyz/dashboard)

### 2. Add to Your Server

```javascript
import tollbooth from '@agenttoll/sdk';

// Toll all agents, let humans through free
app.use(tollbooth(process.env.AGENTTOLL_KEY, {
  amount: 0.05,         // USDC per request
  freeForHumans: true   // Browsers pass free
}));

// Or use the convenience method
app.use(tollbooth.agentsOnly(process.env.AGENTTOLL_KEY));
```

## SDK Options

```javascript
tollbooth(apiKey, {
  amount: 0.05,            // USDC to charge (default: 0.05)
  freeForHumans: false,    // Let browsers through free
  paths: ['*'],            // Routes to toll (glob patterns)
  walletAddress: null,     // Override default wallet
  bypassHeader: null       // Header for internal bypass
});
```

## Convenience Methods

```javascript
// Toll only AI agents
tollbooth.agentsOnly(apiKey, options)

// Protect single route
tollbooth.protect(apiKey, options)

// Check if paid
tollbooth.hasPaid(req)  // boolean

// Check if AI agent
tollbooth.isAgent(req)  // boolean
```

## Cloudflare Workers / Edge

```javascript
import { tollgate } from '@agenttoll/sdk/edge';

export default tollgate(PUBLISHER_KEY, { amount: 0.01 });
```

## Content Gate (HTML Pages)

Protect HTML pages from agentic crawlers (Perplexity, SearchGPT, etc.):

```javascript
import { contentGate, generateRobotsTxt } from '@agenttoll/sdk/content-gate';

// Serve gated HTML — real browsers pass, agents get 402
app.use(contentGate(PUBLISHER_KEY, { amount: 0.05 }));

// Auto-generate robots.txt with x402 payment signals
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(generateRobotsTxt({ publisherKey: PUBLISHER_KEY }));
});
```

## Browser Gate (Client-Side)

Detect headless/agentic browsers (Puppeteer, Playwright, Selenium) on the client:

```html
<script src="https://agenttoll-production.up.railway.app/js/browser-gate.js"
        data-publisher-key="YOUR_KEY"
        data-amount="0.05">
</script>
```

Detects: `navigator.webdriver`, HeadlessChrome, Selenium markers, Playwright markers, CDP indicators, missing plugins, and 15+ other signals.

## MCP Payment Proxy

Paywall any MCP server without modifying it:

```bash
# Register your MCP server
curl -X POST https://agenttoll-production.up.railway.app/api/mcp/register \
  -H "X-Publisher-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"upstream_url": "http://localhost:8080/mcp", "name": "My MCP Server"}'
```

Then point agents to the proxy URL. Free methods (tools/list, initialize) pass through; paid methods return 402 with payment instructions.

## Full Documentation

See [www.agenttoll.xyz/docs](https://www.agenttoll.xyz/docs)
