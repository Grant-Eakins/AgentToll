/**
 * Example: AgentToll agent configuration with pay_toll tool
 * 
 * This shows how AgentToll users add the toll payment tool to their agent
 */

// ============================================
// 1. Add tool to your AgentToll config
// ============================================

const agenttollConfig = {
  name: "ResearchBot",
  model: "claude-3-opus",
  
  // System prompt with toll handling instructions
  system_prompt: `You are a research assistant. When you encounter paywalled content 
(HTTP 402 responses), evaluate if it's worth paying for based on your task.
Use the pay_toll tool to pay small amounts (up to 0.01 USDC) for valuable resources.`,

  // Tools available to the agent
  tools: [
    // ... other tools ...
    {
      name: "pay_toll",
      description: "Pay a micropayment toll to access a paywalled resource. Use when you get HTTP 402.",
      parameters: {
        type: "object",
        required: ["url", "amount"],
        properties: {
          url: { type: "string", description: "URL requiring payment" },
          amount: { type: "number", description: "Payment amount in USDC" },
          max_amount: { type: "number", description: "Max you're willing to pay (default 0.05)" },
          reason: { type: "string", description: "Why this resource is valuable" }
        }
      }
    }
  ],

  // Wallet for payments
  wallet: {
    type: "solana",
    // Your agent's wallet keypair (keep secure!)
    keypair_path: "./wallet/agent-wallet.json"
  }
};

// ============================================
// 2. How the agent handles a 402 response
// ============================================

/*
Example agent flow:

1. Agent tries to fetch: https://api.example.com/research-data
2. Gets 402 response:
   {
     "status": 402,
     "payment": {
     "amount": 0.05,
       "currency": "USDC",
       "pay_url": "https://www.agenttoll.xyz/pay?..."
     }
   }

3. Agent decides: "I need this data for my research task"

4. Agent calls pay_toll:
   pay_toll({
     url: "https://api.example.com/research-data",
     amount: 0.05,
     reason: "Contains academic papers relevant to quantum computing research"
   })

5. Tool returns:
   {
     "success": true,
     "token": "eyJhbGc...",
     "retry_headers": { "Authorization": "Bearer eyJhbGc..." }
   }

6. Agent retries original request with token

7. Gets the data, continues task
*/

// ============================================
// 3. Budget controls for your AgentToll
// ============================================

const budgetConfig = {
  // Maximum spend per task
  max_per_task: 0.10, // USDC

  // Maximum spend per day
  max_per_day: 1.00, // USDC

  // Auto-approve threshold (no human confirmation needed)
  auto_approve_under: 0.01, // USDC

  // Require human approval above this
  require_approval_above: 0.05, // USDC

  // Domains to never pay
  blocklist: [
    "spam-site.com",
    "sketchy-api.io"
  ],

  // Domains to always pay (trusted)
  allowlist: [
    "arxiv.org",
    "wikipedia.org", 
    "official-api.com"
  ]
};

export { agenttollConfig, budgetConfig };
