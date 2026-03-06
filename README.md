# AgentToll 🚧

**One-line micropayment infrastructure for AI agents**

Turn any API or website into a toll-gated resource. AgentToll and AI agents pay in crypto. Publishers earn from the agent swarm.

## Quick Start

### For Publishers (Gate Your Content)

```javascript
// Express - One line
app.use(require('@agenttoll/sdk')('pk_live_xxx'))

// Cloudflare Worker - One line  
export default tollgate('pk_live_xxx')
```

That's it. Your API now returns HTTP 402 to agents until they pay.

### For Agent Operators (Enable Toll Payments)

Add the `pay_toll` tool to your AgentToll:

```javascript
// In your AgentToll config
tools: [{
  name: "pay_toll",
  description: "Pay micropayment tolls when hitting 402 responses",
  // ... see examples/agenttoll-integration.js
}]
```

## How It Works

```
┌─────────────┐     1. Request      ┌─────────────┐
│  AgentToll  │ ──────────────────> │  Your API   │
│   Agent     │                     │  (tolled)   │
└─────────────┘                     └─────────────┘
       │                                   │
       │         2. HTTP 402               │
       │ <─────────────────────────────────┘
       │         + payment info
       │
       │         3. Pay USDC        ┌─────────────┐
       │ ──────────────────────────>│  Tollbooth  │
       │                            │   Service   │
       │         4. JWT Token       └─────────────┘
       │ <──────────────────────────
       │
       │         5. Retry + Token   ┌─────────────┐
       │ ──────────────────────────>│  Your API   │
       │                            └─────────────┘
       │         6. Content
       │ <──────────────────────────
```

## Features

### For Publishers
- **One-line integration** - Works with Express, Cloudflare, Vercel, any framework
- **Flexible pricing** - Set tolls per route, per byte, or flat rate
- **Agent analytics** - See which AgentToll agents are paying, revenue by agent type
- **Humans free option** - Gate only AI agents, let humans through free

### For AgentToll Operators  
- **Native tool** - Drop-in `pay_toll` tool for any AgentToll/OpenClaw agent
- **Budget controls** - Set max spend per task, per day, auto-approve thresholds
- **Persistent tokens** - Agents remember paid sessions across runs

### Payment Rails
- **Solana USDC** - Fast, cheap (~$0.001 fees)
- **x402 protocol** - Standard headers for agent interop
- **Instant verification** - No waiting for confirmations

## Installation

```bash
npm install @agenttoll/sdk
```

## Publisher Examples

### Basic (toll everything)
```javascript
app.use(tollbooth('pk_live_xxx'))
```

### Toll specific paths
```javascript
app.use(tollbooth('pk_live_xxx', {
  paths: ['/api/premium/*'],
  amount: 0.01
}))
```

### Free for humans, toll for agents
```javascript
app.use(tollbooth.agentsOnly('pk_live_xxx'))
```

### Protect single route
```javascript
app.get('/expensive', tollbooth.protect('pk_xxx'), handler)
```

## 402 Response Format

When an agent hits a tolled resource without payment:

```json
{
  "status": 402,
  "message": "Payment Required",
  "agent_instructions": "Pay 0.05 USDC via the payment URL below...",
  "payment": {
    "amount": 0.05,
    "currency": "USDC",
    "network": "solana",
    "pay_url": "https://www.agenttoll.xyz/pay?..."
  },
  "x402": {
    "version": 1,
    "amount": 0.05,
    "currency": "USDC",
    "network": "solana-mainnet"
  },
  "retry": {
    "url": "https://your-api.com/data",
    "headers": {
      "Authorization": "Bearer <token_from_payment>"
    }
  }
}
```

Plus HTTP headers:
```
X-402-Version: 1
X-402-Amount: 0.05
X-402-Currency: USDC
X-402-Pay-URL: https://www.agenttoll.xyz/pay?...
```

## API Endpoints

### Payment
- `POST /api/pay` - Submit payment proof, get access token
- `GET /api/pay/quote` - Get payment quote for a resource
- `POST /api/pay/intent` - Get pre-built transaction to sign

### Verification
- `POST /api/verify` - Verify an access token
- `GET /api/verify/check` - Quick token validity check

### Analytics
- `GET /api/analytics` - Publisher analytics
- `GET /api/analytics/agents` - AgentToll-specific stats
- `GET /api/analytics/revenue` - Revenue breakdown

### Publisher Management
- `POST /api/publisher/register` - Register as publisher
- `GET /api/publisher/me` - Get your publisher info
- `PATCH /api/publisher/settings` - Update settings

## Agent Detection

The tollbooth detects agents via:
- User-Agent patterns: `agenttoll`, `openclaw`, `clawd`, `autogpt`, etc.
- Custom headers: `X-Agent-Type`, `X-AgentToll-ID`
- Capability headers: `X-402-Capable: true`

## Environment Variables

```bash
# Server
PORT=3000
JWT_SECRET=your_jwt_secret_min_32_chars

# Platform Fee Wallets (where YOUR fees go)
# Only need ONE - set whichever network(s) you want to support
PLATFORM_SOLANA_WALLET=YourPlatformSolanaWallet  # Optional
PLATFORM_BASE_WALLET=0xYourPlatformBaseWallet    # Optional
PLATFORM_FEE_PERCENT=5

# Blockchain RPCs
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
BASE_RPC_URL=https://mainnet.base.org

# Optional
TOKEN_EXPIRY=3600
API_BASE_URL=https://www.agenttoll.xyz
```

## Why Now?

- **AgentToll agents are everywhere** - Millions of autonomous agents browsing the web
- **They have wallets** - First wave of agents with real economic agency
- **Publishers need revenue** - Bot traffic is huge but unmonetized
- **The agent economy is forming** - Be the payment rails

## License

MIT

---

**Built for the agent swarm** 🤖💰
