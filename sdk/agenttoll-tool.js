/**
 * AgentToll Tool: pay_toll
 * 
 * This tool allows AgentToll/OpenClaw agents to autonomously pay
 * micropayment tolls when they hit 402 Payment Required responses.
 * 
 * Installation:
 *   Add this tool to your AgentToll's tool configuration
 * 
 * Usage in agent prompts:
 *   "If you encounter a 402 Payment Required error on a useful resource,
 *    use the pay_toll tool to pay up to 0.01 USDC if the content is
 *    valuable for the current task."
 */

import { Keypair, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createTransferInstruction,
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';

const TOLL_API = 'https://agenttoll-production.up.railway.app';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // Mainnet USDC

/**
 * AgentToll-compatible tool implementation
 */
export async function pay_toll(params, context) {
  const { url, amount, max_amount = 0.05, reason } = params;
  const { wallet_keypair, solana_rpc } = context;

  // Safety check: don't overpay
  if (amount > max_amount) {
    return {
      success: false,
      error: `Requested amount ${amount} USDC exceeds max_amount ${max_amount} USDC`,
      suggestion: 'Increase max_amount if this resource is valuable, or skip this resource',
    };
  }

  try {
    // 1. Get payment details from toll service
    const quoteRes = await fetch(`${TOLL_API}/api/pay/quote?resource=${encodeURIComponent(url)}&amount=${amount}`);
    const quote = await quoteRes.json();

    // 2. Create and send Solana USDC transfer
    const connection = new Connection(solana_rpc || 'https://api.mainnet-beta.solana.com');
    const payer = Keypair.fromSecretKey(wallet_keypair);
    
    const payerAta = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
    const receiverAta = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(quote.receiver_wallet));

    // Amount in USDC (6 decimals)
    const transferAmount = Math.floor(amount * 1_000_000);

    const transaction = new Transaction().add(
      createTransferInstruction(
        payerAta,
        receiverAta,
        payer.publicKey,
        transferAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const signature = await connection.sendTransaction(transaction, [payer]);
    await connection.confirmTransaction(signature, 'confirmed');

    // 3. Submit payment proof to toll service
    const payRes = await fetch(`${TOLL_API}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: quote.publisher || 'default',
        amount: amount,
        resource: url,
        tx_signature: signature,
        agent_id: context.agent_id || 'agenttoll',
      }),
    });

    const payResult = await payRes.json();

    if (!payResult.success) {
      return {
        success: false,
        error: payResult.error,
        tx_signature: signature,
      };
    }

    // 4. Return token for agent to use
    return {
      success: true,
      token: payResult.token,
      expires_in: payResult.expires_in,
      amount_paid: amount,
      tx_signature: signature,
      retry_headers: {
        'Authorization': `Bearer ${payResult.token}`,
      },
      instructions: `Payment successful. Retry the original request to ${url} with the Authorization header set to: Bearer ${payResult.token}`,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      suggestion: 'Check wallet balance or try again later',
    };
  }
}

/**
 * Parse 402 response to extract payment details
 * Helper for agents to understand 402 responses
 */
export function parse402Response(response) {
  // Try x402 headers first
  const headers = response.headers || {};
  if (headers['x-402-amount']) {
    return {
      amount: parseFloat(headers['x-402-amount']),
      currency: headers['x-402-currency'] || 'USDC',
      pay_url: headers['x-402-pay-url'],
      network: headers['x-402-network'] || null,
    };
  }

  // Try body
  const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  if (body?.x402) {
    return {
      amount: body.x402.amount,
      currency: body.x402.currency,
      network: body.x402.network,
      pay_url: body.payment?.pay_url,
    };
  }

  if (body?.payment) {
    return {
      amount: body.payment.amount,
      currency: body.payment.currency,
      network: body.payment.network,
      pay_url: body.payment.pay_url,
    };
  }

  return null;
}

/**
 * AgentToll system prompt addition for toll handling
 */
export const TOLL_SYSTEM_PROMPT = `
## Toll Payment Capability

You have access to the pay_toll tool for handling paywalled content. When you encounter an HTTP 402 Payment Required response:

1. Check the x402 headers or response body for payment details (amount, currency, network)
2. Evaluate if the resource is worth paying for based on your current task
3. If valuable and within your budget (default max 0.05 USDC), use pay_toll to pay
4. Retry the original request with the returned Authorization token

Example 402 handling:
- Receive 402 with amount: 0.05 USDC
- Decide: "This API has data I need for my research task"
- Call: pay_toll(url="...", amount=0.05, reason="Need this data for research")
- Retry request with: Authorization: Bearer <returned_token>

Budget guidelines:
- Small data requests: up to 0.05 USDC
- API calls: up to 0.05 USDC  
- Premium content: up to 0.10 USDC (ask human first if possible)
- Never exceed 0.5 USDC without explicit human approval
`;

export default { pay_toll, parse402Response, TOLL_SYSTEM_PROMPT };
