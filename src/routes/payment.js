import { Router } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { generateAccessToken } from '../utils/jwt.js';
import { recordPayment, isSupabaseConfigured, dbIsTransactionUsed, dbMarkTransactionUsed } from '../utils/analytics.js';
import { getPublisher, setPublisher } from './publisher.js';

const router = Router();

// Solana configuration
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC);
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Base (Ethereum L2) configuration
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base

// Platform fee configuration
const DEFAULT_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '5'); // 5% default
const MINIMUM_AMOUNT = 0.05; // Minimum charge: $0.05 USDC
const PLATFORM_SOLANA_WALLET = process.env.PLATFORM_SOLANA_WALLET;
const PLATFORM_BASE_WALLET = process.env.PLATFORM_BASE_WALLET;

// Transaction recency: reject txs older than this (in seconds)
const TX_MAX_AGE_SECONDS = parseInt(process.env.TX_MAX_AGE_SECONDS || '600'); // 10 minutes

// Replay protection: track used transaction signatures
const usedTransactions = new Set();

// Check platform wallet configuration
const hasSolanaWallet = !!PLATFORM_SOLANA_WALLET;
const hasBaseWallet = !!PLATFORM_BASE_WALLET;

if (!hasSolanaWallet && !hasBaseWallet) {
  console.error('❌ CRITICAL: No platform wallet configured!');
  console.error('   Set PLATFORM_SOLANA_WALLET and/or PLATFORM_BASE_WALLET in your .env');
} else {
  if (hasSolanaWallet) console.log('✅ Solana fee collection enabled');
  else console.log('ℹ️  Solana payments disabled (no PLATFORM_SOLANA_WALLET)');
  
  if (hasBaseWallet) console.log('✅ Base fee collection enabled');
  else console.log('ℹ️  Base payments disabled (no PLATFORM_BASE_WALLET)');
}

/**
 * Platform fee is a flat 5% for all publishers
 */
function getEffectiveFeePercent() {
  return DEFAULT_FEE_PERCENT; // 5% flat for everyone
}

/**
 * POST /api/pay
 * Process a payment from an AgentToll or any agent
 * 
 * Body:
 *   - publisher: Publisher API key
 *   - amount: Amount in USDC
 *   - resource: URL being accessed
 *   - tx_signature: Solana transaction signature (for Solana payments)
 *   - tx_hash: Base transaction hash (for Base payments)
 *   - network: 'solana' or 'base' (REQUIRED)
 *   - agent_id: (optional) AgentToll/agent identifier
 */
router.post('/', async (req, res) => {
  try {
    const { publisher, amount, resource, tx_signature, tx_hash, network, agent_id } = req.body;

    // Validate network is specified
    if (!network || !['solana', 'base'].includes(network)) {
      return res.status(400).json({
        error: 'Network required',
        message: "Specify network: 'solana' or 'base'",
        supported_networks: ['solana', 'base'],
        agent_hint: "Include 'network' field set to 'solana' or 'base' in your payment request.",
      });
    }

    // Validate required fields
    const txId = network === 'base' ? tx_hash : tx_signature;
    if (!publisher || !txId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['publisher', 'network', network === 'base' ? 'tx_hash' : 'tx_signature'],
        supported_networks: ['solana', 'base'],
        agent_hint: `Provide your ${network === 'base' ? 'Base transaction hash' : 'Solana transaction signature'} after sending payment`,
      });
    }

    // Enforce minimum amount
    if (amount && parseFloat(amount) < MINIMUM_AMOUNT) {
      return res.status(400).json({
        error: `Minimum payment is ${MINIMUM_AMOUNT} USDC`,
        minimum_amount: MINIMUM_AMOUNT,
        provided: parseFloat(amount),
        agent_hint: `Amount must be at least ${MINIMUM_AMOUNT} USDC`,
      });
    }

    // Replay protection: check in-memory cache first, then Supabase
    if (usedTransactions.has(txId)) {
      return res.status(409).json({
        error: 'Transaction already used',
        agent_hint: 'This transaction signature has already been redeemed. Send a new payment.',
      });
    }
    if (isSupabaseConfigured() && await dbIsTransactionUsed(txId)) {
      usedTransactions.add(txId); // cache it locally too
      return res.status(409).json({
        error: 'Transaction already used',
        agent_hint: 'This transaction signature has already been redeemed. Send a new payment.',
      });
    }

    // Look up publisher to get receiver wallet before on-chain verification
    const publisherData = await getPublisher(publisher);
    if (!publisherData) {
      return res.status(404).json({ error: 'Publisher not found', agent_hint: 'Invalid publisher key.' });
    }
    const publisherWallet = network === 'base'
      ? publisherData.wallets?.base
      : publisherData.wallets?.solana || publisherData.wallet_address;
    if (!publisherWallet) {
      return res.status(400).json({ error: `Publisher has no ${network} wallet configured` });
    }

    // Verify the payment on-chain
    let verification;
    if (network === 'base') {
      verification = await verifyBasePayment(tx_hash, amount, publisherWallet);
    } else {
      verification = await verifySolanaPayment(tx_signature, amount, publisherWallet);
    }
    
    if (!verification.valid) {
      return res.status(402).json({
        error: 'Payment verification failed',
        reason: verification.reason,
        network,
        agent_hint: 'Transaction not found or amount mismatch. Retry payment.',
      });
    }

    // Mark transaction as used (replay protection) — persist to Supabase + local cache
    usedTransactions.add(txId);
    if (isSupabaseConfigured()) {
      await dbMarkTransactionUsed(txId, { network, publisherKey: publisher, amount });
    }

    // Calculate fees (flat 5%)
    const feePercent = getEffectiveFeePercent();
    const platformFee = amount * (feePercent / 100);
    const publisherReceives = amount - platformFee;

    // Persist updated revenue to Supabase
    if (publisherData) {
      publisherData.revenue.total_gross = (publisherData.revenue.total_gross || 0) + amount;
      publisherData.revenue.total_net = (publisherData.revenue.total_net || 0) + publisherReceives;
      publisherData.revenue.platform_fees_paid = (publisherData.revenue.platform_fees_paid || 0) + platformFee;
      setPublisher(publisher, { revenue: publisherData.revenue }).catch(e =>
        console.error('Revenue update failed (non-fatal):', e.message)
      );
    }

    // Get access mode settings from publisher
    const accessMode = publisherData?.settings?.access_mode || 'session';
    const accessDuration = publisherData?.settings?.access_duration || '1h';

    // Generate access token with mode
    const token = generateAccessToken({
      publisher,
      resource,
      amount,
      tx: txId,
      network,
      agent: agent_id || 'unknown',
    }, {
      mode: accessMode,
      duration: accessDuration,
    });

    // Calculate token info for response
    const tokenInfo = {
      mode: accessMode,
      duration: accessDuration,
      scope: accessMode === 'pass' ? 'all endpoints' : (resource || 'single resource'),
      uses: accessMode === 'per-request' ? 1 : 'unlimited within duration',
    };

    // Record for analytics
    await recordPayment({
      publisher,
      amount,
      platform_fee: platformFee,
      publisher_receives: publisherReceives,
      resource,
      tx_signature: txId,
      network,
      agent_id,
      agent_type: req.headers['user-agent'],
      access_mode: accessMode,
      timestamp: Date.now(),
    });

    // Return success with token
    res.json({
      success: true,
      token,
      expires_in: accessMode === 'per-request' ? 300 : (typeof accessDuration === 'number' ? accessDuration : parseInt(process.env.TOKEN_EXPIRY || '3600')),
      access: tokenInfo,
      payment_summary: {
        total_paid: amount,
        publisher_received: publisherReceives,
        platform_fee: platformFee,
      },
      agent_instructions: accessMode === 'per-request' 
        ? `Single-use token. Add to Authorization header: Bearer ${token}`
        : `Add this token to your Authorization header: Bearer ${token}`,
      retry: {
        url: resource,
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      },
    });

  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({
      error: 'Payment processing failed',
      agent_hint: 'Internal error. Retry in a few seconds.',
    });
  }
});

/**
 * GET /api/pay/quote
 * Get a payment quote (for agents to check before paying)
 * Returns publisher's wallet for direct payment + platform fee info
 */
router.get('/quote', async (req, res) => {
  const { publisher: publisherKey, resource, network } = req.query;

  if (!network || !['solana', 'base'].includes(network)) {
    return res.status(400).json({
      error: 'Network required',
      message: "Specify network query param: 'solana' or 'base'",
      supported_networks: ['solana', 'base'],
      agent_hint: "Add &network=solana or &network=base to the quote URL.",
    });
  }
  
  // Look up publisher to get their wallet and pricing
  const publisherData = await getPublisher(publisherKey);
  
  if (!publisherData) {
    return res.status(404).json({
      error: 'Publisher not found',
      agent_hint: 'Invalid publisher key in the 402 response',
    });
  }

  const amount = Math.max(parseFloat(req.query.amount) || publisherData.settings?.default_amount || 0.05, MINIMUM_AMOUNT);
  const feePercent = getEffectiveFeePercent();
  const platformFee = amount * (feePercent / 100);
  const publisherReceives = amount - platformFee;

  // Access mode info
  const accessMode = publisherData.settings?.access_mode || 'session';
  const accessDuration = publisherData.settings?.access_duration || '1h';

  const baseResponse = {
    amount,
    currency: 'USDC',
    resource,
    valid_for: 300,
    supported_networks: ['solana', 'base'],
    fee_breakdown: {
      total: amount,
      publisher_receives: publisherReceives,
      platform_fee: platformFee,
      platform_fee_percent: feePercent,
    },
    access: {
      mode: accessMode,
      duration: accessDuration,
      description: accessMode === 'per-request' 
        ? 'Single use - token valid for 1 request only'
        : accessMode === 'pass'
        ? `Site pass - full access to all endpoints for ${accessDuration}`
        : `Session - access to this resource for ${accessDuration}`,
    },
    publisher: {
      name: publisherData.name,
      id: publisherData.id,
    },
  };

  // Get publisher's wallet for the requested network
  const publisherWallet = network === 'base' 
    ? publisherData.wallets?.base 
    : publisherData.wallets?.solana || publisherData.wallet_address;

  if (!publisherWallet) {
    return res.status(400).json({
      error: `Publisher has no ${network} wallet configured`,
      supported_networks: Object.keys(publisherData.wallets || {}),
      agent_hint: 'Try a different network or contact the publisher',
    });
  }

  if (network === 'base') {
    // Check platform wallet is configured
    if (!PLATFORM_BASE_WALLET) {
      console.error('PLATFORM_BASE_WALLET not configured');
    }
    
    res.json({
      ...baseResponse,
      network: 'base',
      chain_id: 8453,
      // Two-transfer payment: publisher + platform fee
      payments: [
        {
          recipient: 'publisher',
          wallet: publisherWallet,
          amount: publisherReceives,
        },
        {
          recipient: 'platform_fee',
          wallet: PLATFORM_BASE_WALLET || 'NOT_CONFIGURED',
          amount: platformFee,
        },
      ],
      // Legacy single-wallet for simpler agents (publisher gets full amount, settles fee later)
      receiver_wallet: publisherWallet,
      usdc_contract: BASE_USDC_ADDRESS,
      agent_instructions: `Send ${amount} USDC to ${publisherWallet} on Base, then POST tx_hash to /api/pay with network=base`,
    });
  } else {
    // Check platform wallet is configured
    if (!PLATFORM_SOLANA_WALLET) {
      console.error('PLATFORM_SOLANA_WALLET not configured');
    }
    
    res.json({
      ...baseResponse,
      network: 'solana',
      payments: [
        {
          recipient: 'publisher',
          wallet: publisherWallet,
          amount: publisherReceives,
        },
        {
          recipient: 'platform_fee', 
          wallet: PLATFORM_SOLANA_WALLET || 'NOT_CONFIGURED',
          amount: platformFee,
        },
      ],
      receiver_wallet: publisherWallet,
      agent_instructions: `Send ${amount} USDC to ${publisherWallet} on Solana, then POST tx signature to /api/pay`,
    });
  }
});

/**
 * POST /api/pay/intent
 * Create a payment intent (returns transaction to sign)
 * For agents that want pre-built transactions
 */
router.post('/intent', async (req, res) => {
  const { publisher: publisherKey, amount, resource, payer_wallet, network } = req.body;

  if (!network || !['solana', 'base'].includes(network)) {
    return res.status(400).json({
      error: 'Network required',
      message: "Specify network: 'solana' or 'base'",
      supported_networks: ['solana', 'base'],
      agent_hint: "Include 'network' field set to 'solana' or 'base' in your intent request.",
    });
  }

  if (!payer_wallet) {
    return res.status(400).json({
      error: 'payer_wallet required',
      supported_networks: ['solana', 'base'],
      agent_hint: `Provide your ${network === 'base' ? 'Base (0x)' : 'Solana'} wallet address to receive a transaction to sign`,
    });
  }

  // Look up publisher
  const publisherData = await getPublisher(publisherKey);
  if (!publisherData) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  const paymentAmount = Math.max(parseFloat(amount) || publisherData.settings?.default_amount || 0.05, MINIMUM_AMOUNT);
  const feePercent = getEffectiveFeePercent();
  const platformFee = paymentAmount * (feePercent / 100);
  const publisherReceives = paymentAmount - platformFee;

  const publisherWallet = network === 'base'
    ? publisherData.wallets?.base
    : publisherData.wallets?.solana || publisherData.wallet_address;

  if (network === 'base') {
    res.json({
      intent_id: `intent_base_${Date.now()}`,
      amount: paymentAmount,
      currency: 'USDC',
      network: 'base',
      chain_id: 8453,
      payer: payer_wallet,
      usdc_contract: BASE_USDC_ADDRESS,
      fee_breakdown: {
        total: paymentAmount,
        publisher_receives: publisherReceives,
        platform_fee: platformFee,
        fee_percent: feePercent,
      },
      // Two transactions for proper fee splitting
      transactions: [
        {
          recipient: 'publisher',
          to: BASE_USDC_ADDRESS,
          value: '0x0',
          data: encodeUSDCTransfer(publisherWallet, publisherReceives),
          description: `${publisherReceives} USDC to publisher`,
        },
        {
          recipient: 'platform_fee',
          to: BASE_USDC_ADDRESS,
          value: '0x0', 
          data: encodeUSDCTransfer(PLATFORM_BASE_WALLET, platformFee),
          description: `${platformFee} USDC platform fee`,
        },
      ],
      // Legacy single transaction (full amount to publisher)
      transaction: {
        to: BASE_USDC_ADDRESS,
        value: '0x0',
        data: encodeUSDCTransfer(publisherWallet, paymentAmount),
      },
      expires_at: Date.now() + 300000,
      agent_instructions: 'Sign and submit the transaction(s) on Base, then POST tx_hash to /api/pay with network=base',
    });
  } else {
    res.json({
      intent_id: `intent_sol_${Date.now()}`,
      amount: paymentAmount,
      currency: 'USDC',
      network: 'solana',
      payer: payer_wallet,
      fee_breakdown: {
        total: paymentAmount,
        publisher_receives: publisherReceives,
        platform_fee: platformFee,
      },
      payments: [
        { recipient: 'publisher', wallet: publisherWallet, amount: publisherReceives },
        { recipient: 'platform_fee', wallet: PLATFORM_SOLANA_WALLET, amount: platformFee },
      ],
      // In production: return serialized multi-instruction transaction
      transaction_message: 'Base64 encoded transaction would go here',
      expires_at: Date.now() + 300000,
      agent_instructions: 'Sign and submit the transaction, then POST signature to /api/pay',
    });
  }
});

/**
 * Verify a Solana transaction — checks existence, recency, USDC mint, recipient, and amount
 */
async function verifySolanaPayment(signature, expectedAmount, receiverWallet) {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) return { valid: false, reason: 'Transaction not found' };
    if (tx.meta?.err) return { valid: false, reason: 'Transaction failed' };

    // Recency check
    if (tx.blockTime) {
      const txAgeSeconds = Math.floor(Date.now() / 1000) - tx.blockTime;
      if (txAgeSeconds > TX_MAX_AGE_SECONDS) {
        return { valid: false, reason: `Transaction too old (${txAgeSeconds}s ago, max ${TX_MAX_AGE_SECONDS}s)` };
      }
      if (txAgeSeconds < -60) {
        return { valid: false, reason: 'Transaction timestamp is in the future' };
      }
    }

    // Verify USDC was received by the publisher wallet using token balance deltas
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];

    let receivedAmount = 0;
    for (const post of postBalances) {
      if (post.mint !== SOLANA_USDC_MINT) continue;
      if (post.owner !== receiverWallet) continue;
      const pre = preBalances.find(b => b.accountIndex === post.accountIndex);
      const delta = (post.uiTokenAmount?.uiAmount || 0) - (pre?.uiTokenAmount?.uiAmount || 0);
      if (delta > 0) { receivedAmount = delta; break; }
    }

    if (receivedAmount === 0) {
      return { valid: false, reason: 'No USDC transfer to publisher wallet found in transaction' };
    }
    // Allow 1% tolerance for rounding
    if (receivedAmount < expectedAmount * 0.99) {
      return { valid: false, reason: `Insufficient USDC: received ${receivedAmount}, expected ${expectedAmount}` };
    }

    return { valid: true, amount: receivedAmount, block: tx.slot, blockTime: tx.blockTime };

  } catch (error) {
    console.error('Solana verification error:', error);
    return { valid: false, reason: 'Verification error' };
  }
}

/**
 * Verify a Base (Ethereum L2) transaction
 */
async function verifyBasePayment(txHash, expectedAmount, receiverWallet) {
  try {
    // Fetch transaction receipt from Base RPC
    const response = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });

    const { result: receipt } = await response.json();

    if (!receipt) {
      return { valid: false, reason: 'Transaction not found or pending' };
    }

    if (receipt.status !== '0x1') {
      return { valid: false, reason: 'Transaction failed' };
    }

    // Recency check: fetch block timestamp and reject old transactions
    try {
      const blockResponse = await fetch(BASE_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getBlockByNumber',
          params: [receipt.blockNumber, false],
        }),
      });
      const { result: block } = await blockResponse.json();
      if (block?.timestamp) {
        const blockTimestamp = parseInt(block.timestamp, 16);
        const txAgeSeconds = Math.floor(Date.now() / 1000) - blockTimestamp;
        if (txAgeSeconds > TX_MAX_AGE_SECONDS) {
          return { valid: false, reason: `Transaction too old (${txAgeSeconds}s ago, max ${TX_MAX_AGE_SECONDS}s)` };
        }
      }
    } catch (blockErr) {
      console.error('Block timestamp fetch error (non-fatal):', blockErr.message);
    }

    // Verify it's a USDC Transfer event to the publisher wallet
    const usdcTransferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const receiverPadded = receiverWallet.toLowerCase().replace('0x', '').padStart(64, '0');

    const transferLog = receipt.logs?.find(log =>
      log.address?.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() &&
      log.topics?.[0] === usdcTransferTopic &&
      log.topics?.[2]?.toLowerCase().includes(receiverPadded)
    );

    if (!transferLog) {
      return { valid: false, reason: 'USDC transfer to publisher wallet not found in transaction' };
    }

    // Decode amount (USDC = 6 decimals on Base)
    const amountRaw = BigInt(transferLog.data);
    const amountUsdc = Number(amountRaw) / 1e6;

    // Allow 1% tolerance for rounding
    if (amountUsdc < expectedAmount * 0.99) {
      return { valid: false, reason: `Insufficient USDC: received ${amountUsdc}, expected ${expectedAmount}` };
    }

    return {
      valid: true,
      amount: amountUsdc,
      block: parseInt(receipt.blockNumber, 16),
      network: 'base',
    };

  } catch (error) {
    console.error('Base verification error:', error);
    return { valid: false, reason: 'Verification error' };
  }
}

/**
 * Encode ERC20 transfer call data for USDC
 */
function encodeUSDCTransfer(to, amount) {
  // transfer(address,uint256) selector: 0xa9059cbb
  const selector = 'a9059cbb';
  const toAddress = to.toLowerCase().replace('0x', '').padStart(64, '0');
  // USDC has 6 decimals
  const amountWei = BigInt(Math.floor(amount * 1e6)).toString(16).padStart(64, '0');
  return `0x${selector}${toAddress}${amountWei}`;
}

export { router as paymentRoutes };
