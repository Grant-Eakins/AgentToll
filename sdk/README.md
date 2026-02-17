# AgentToll SDK

One-line micropayment integration for AI agents.

## Installation

```bash
npm install @agenttoll/sdk
```

## Quick Start

### 1. Get Your API Key

```javascript
// Via API
const response = await fetch('https://toll.agenttoll.io/api/publisher/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My API',
    email: 'you@example.com',
    wallet_address: 'YourSolanaWallet'
  })
});
const { api_key } = await response.json();
```

Or use the web form at [toll.agenttoll.io](https://toll.agenttoll.io)

### 2. Add to Your Server

```javascript
import tollbooth from '@agenttoll/sdk';

// Toll all agents, let humans through free
app.use(tollbooth(process.env.AGENTTOLL_KEY, {
  amount: 0.005,        // USDC per request
  freeForHumans: true   // Browsers pass free
}));

// Or use the convenience method
app.use(tollbooth.agentsOnly(process.env.AGENTTOLL_KEY));
```

## SDK Options

```javascript
tollbooth(apiKey, {
  amount: 0.005,           // USDC to charge (default: 0.005)
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

## Full Documentation

See [toll.agenttoll.io/docs](https://toll.agenttoll.io/docs)
