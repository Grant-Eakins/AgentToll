import { Router } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { generateAccessToken } from '../utils/jwt.js';
import { recordPayment } from '../utils/analytics.js';
import { getPublisher } from './publisher.js';

const router = Router();

// Solana configuration
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC);

// Base (Ethereum L2) configuration
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base

// Platform fee configuration
const DEFAULT_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '5'); // 5% default
const PLATFORM_SOLANA_WALLET = process.env.PLATFORM_SOLANA_WALLET;
const PLATFORM_BASE_WALLET = process.env.PLATFORM_BASE_WALLET;

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
 * Calculate effective fee percent for a publisher based on tier and custom settings
 */
function getEffectiveFeePercent(publisherData) {
  if (!publisherData) return DEFAULT_FEE_PERCENT;
  
  // Custom fee takes priority (enterprise tier)
  if (publisherData.settings?.custom_fee_percent !== null && 
      publisherData.settings?.custom_fee_percent !== undefined) {
    return publisherData.settings.custom_fee_percent;
  }
  
  // Tier-based discounts
  switch (publisherData.tier) {
    case 'premium': return 3;
    case 'enterprise': return 1;
    default: return DEFAULT_FEE_PERCENT;
  }
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
 *   - network: 'solana' or 'base' (default: 'solana')
 *   - agent_id: (optional) AgentToll/agent identifier
 */
router.post('/', async (req, res) => {
  try {
    const { publisher, amount, resource, tx_signature, tx_hash, network = 'solana', agent_id } = req.body;

    // Validate required fields
    const txId = network === 'base' ? tx_hash : tx_signature;
    if (!publisher || !txId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['publisher', network === 'base' ? 'tx_hash' : 'tx_signature'],
        supported_networks: ['solana', 'base'],
        agent_hint: `Provide your ${network === 'base' ? 'Base transaction hash' : 'Solana transaction signature'} after sending payment`,
      });
    }

    // Verify the payment based on network
    let verification;
    if (network === 'base') {
      verification = await verifyBasePayment(tx_hash, amount);
    } else {
      verification = await verifySolanaPayment(tx_signature, amount);
    }
    
    if (!verification.valid) {
      return res.status(402).json({
        error: 'Payment verification failed',
        reason: verification.reason,
        network,
        agent_hint: 'Transaction not found or amount mismatch. Retry payment.',
      });
    }

    // Look up publisher and calculate fees based on their tier
    const publisherData = await getPublisher(publisher);
    const feePercent = getEffectiveFeePercent(publisherData);
    const platformFee = amount * (feePercent / 100);
    const publisherReceives = amount - platformFee;

    // Update publisher revenue (in production: use database transactions)
    if (publisherData) {
      publisherData.revenue.total_gross += amount;
      publisherData.revenue.total_net += publisherReceives;
      publisherData.revenue.platform_fees_paid += platformFee;
      // Note: revenue updates are tracked via payment records in Supabase
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
  const { publisher: publisherKey, resource, network = 'solana' } = req.query;
  
  // Look up publisher to get their wallet and pricing
  const publisherData = await getPublisher(publisherKey);
  
  if (!publisherData) {
    return res.status(404).json({
      error: 'Publisher not found',
      agent_hint: 'Invalid publisher key in the 402 response',
    });
  }

  const amount = parseFloat(req.query.amount) || publisherData.settings?.default_amount || 0.005;
  const feePercent = getEffectiveFeePercent(publisherData);
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
      tier: publisherData.tier,
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
  const { publisher: publisherKey, amount, resource, payer_wallet, network = 'solana' } = req.body;

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

  const paymentAmount = parseFloat(amount) || publisherData.settings?.default_amount || 0.005;
  const feePercent = getEffectiveFeePercent(publisherData);
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
 * Verify a Solana transaction
 */
async function verifySolanaPayment(signature, expectedAmount) {
  try {
    // Get transaction details
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { valid: false, reason: 'Transaction not found' };
    }

    if (tx.meta?.err) {
      return { valid: false, reason: 'Transaction failed' };
    }

    // In production: verify USDC transfer amount and recipient
    // For now, accept confirmed transactions
    return { 
      valid: true, 
      amount: expectedAmount,
      block: tx.slot,
    };

  } catch (error) {
    console.error('Solana verification error:', error);
    return { valid: false, reason: 'Verification error' };
  }
}

/**
 * Verify a Base (Ethereum L2) transaction
 */
async function verifyBasePayment(txHash, expectedAmount) {
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

    // Verify it's a USDC transfer to our receiver wallet
    const usdcTransferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer event
    const receiverPadded = BASE_RECEIVER_WALLET?.toLowerCase().replace('0x', '').padStart(64, '0');

    const transferLog = receipt.logs?.find(log => 
      log.address?.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase() &&
      log.topics?.[0] === usdcTransferTopic &&
      log.topics?.[2]?.toLowerCase().includes(receiverPadded)
    );

    if (!transferLog) {
      return { valid: false, reason: 'USDC transfer to receiver not found in transaction' };
    }

    // Decode amount from log data (USDC has 6 decimals on Base)
    const amountRaw = BigInt(transferLog.data);
    const amountUsdc = Number(amountRaw) / 1e6;

    // In production: verify amount matches expected
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
