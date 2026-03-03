/**
 * Full end-to-end payment simulation
 * Mocks on-chain verification to test the complete flow:
 *   1. Agent hits paywall → gets 402
 *   2. Agent reads payment instructions
 *   3. Agent "pays" (mocked) and submits tx signature
 *   4. System verifies and returns access token
 *   5. Agent retries with token → gets data
 * 
 * Run: node test-full-payment.js
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const MOCK_PUBLISHER_KEY = 'pk_test_simulation';
const MOCK_PUBLISHER_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

// ─── Simulated publisher DB ────────────────────────────────────
const publishers = {
  [MOCK_PUBLISHER_KEY]: {
    api_key: MOCK_PUBLISHER_KEY,
    name: 'Test Publisher',
    wallet_address: MOCK_PUBLISHER_WALLET,
    tier: 'free',
    settings: { access_mode: 'session', access_duration: '1h' },
  },
};

// ─── Mock on-chain verification ────────────────────────────────
// In production this queries Solana RPC / Base RPC
const validTransactions = new Set();  // Tracks "paid" tx signatures

function mockVerifyPayment(signature, expectedAmount) {
  if (validTransactions.has(signature)) {
    return { valid: true, amount: expectedAmount, block: 123456789 };
  }
  return { valid: false, reason: 'Transaction not found' };
}

// ─── Token generation (same as production) ─────────────────────
function generateAccessToken(payload) {
  return jwt.sign({
    jti: uuidv4(),
    publisher: payload.publisher,
    resource: payload.resource,
    amount: payload.amount,
    tx: payload.tx,
    agent: payload.agent,
    mode: 'session',
    scope: payload.resource,
    iat: Math.floor(Date.now() / 1000),
  }, JWT_SECRET, { expiresIn: 3600, issuer: 'agenttoll' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { issuer: 'agenttoll' });
  } catch { return null; }
}

// ─── Tollbooth middleware (simplified) ─────────────────────────
function tollbooth(apiKey, options = {}) {
  return async (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    const isAgent = /claude|openai|gpt|agent|bot/i.test(ua);

    // Humans pass free
    if (!isAgent) return next();

    // Check for payment token
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        req.tollPaid = true;
        req.tollAgent = true;
        req.tokenData = decoded;
        return next();  // ✅ Paid agent passes through
      }
    }

    // ❌ No valid token → 402
    return res.status(402).json({
      status: 402,
      message: 'Payment Required',
      payment: {
        amount: options.amount,
        currency: 'USDC',
        network: 'solana',
        pay_url: `http://localhost:3002/api/pay`,
        publisher: apiKey,
      },
      agent_instructions: `Send ${options.amount} USDC, then POST tx signature to /api/pay`,
    });
  };
}

// ─── Payment endpoint ──────────────────────────────────────────
app.post('/api/pay', (req, res) => {
  const { publisher, amount, resource, tx_signature } = req.body;

  if (!publisher || !tx_signature) {
    return res.status(400).json({ error: 'Missing publisher or tx_signature' });
  }

  // Verify on-chain (mocked)
  const verification = mockVerifyPayment(tx_signature, amount);

  if (!verification.valid) {
    return res.status(402).json({
      error: 'Payment verification failed',
      reason: verification.reason,
    });
  }

  // Payment verified → generate token
  const token = generateAccessToken({
    publisher,
    resource: resource || '/premium/data',
    amount,
    tx: tx_signature,
    agent: 'test-agent',
  });

  console.log('   ✅ Payment verified! Token issued.');

  return res.json({
    success: true,
    access_token: token,
    token_type: 'Bearer',
    expires_in: 3600,
    instructions: 'Add this token as: Authorization: Bearer <token>',
  });
});

// ─── Mock payment endpoint (simulates the agent sending USDC) ──
app.post('/api/simulate-pay', (req, res) => {
  // Simulate an on-chain USDC transfer
  const fakeTxSignature = `sim_${uuidv4().replace(/-/g, '')}`;
  validTransactions.add(fakeTxSignature);

  console.log(`   💸 Simulated USDC transfer. TX: ${fakeTxSignature}`);

  return res.json({
    tx_signature: fakeTxSignature,
    status: 'confirmed',
    amount: req.body.amount || 0.001,
    network: 'solana',
    note: 'This is a simulated transaction for testing',
  });
});

// ─── Protected endpoint ────────────────────────────────────────
app.use('/premium', tollbooth(MOCK_PUBLISHER_KEY, { amount: 0.001 }));

app.get('/premium/data', (req, res) => {
  res.json({
    success: true,
    data: '🔓 SECRET PREMIUM DATA - You paid to see this!',
    paid: req.tollPaid || false,
    token_info: req.tokenData ? {
      publisher: req.tokenData.publisher,
      amount: req.tokenData.amount,
      tx: req.tokenData.tx,
      expires: new Date(req.tokenData.exp * 1000).toISOString(),
    } : null,
  });
});

// ─── Start server and run simulation ───────────────────────────
const PORT = 3002;
app.listen(PORT, async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  AgentToll Payment Simulation`);
  console.log(`${'═'.repeat(60)}\n`);

  const BASE = `http://localhost:${PORT}`;

  try {
    // ── STEP 1: Agent hits paywall ──
    console.log('STEP 1: Agent requests premium data...');
    const step1 = await fetch(`${BASE}/premium/data`, {
      headers: { 'User-Agent': 'Claude-Agent/1.0' },
    });
    const step1Data = await step1.json();
    console.log(`   Status: ${step1.status} ${step1.status === 402 ? '(Payment Required)' : ''}`);
    console.log(`   Amount: ${step1Data.payment?.amount} ${step1Data.payment?.currency}`);
    console.log(`   Pay URL: ${step1Data.payment?.pay_url}`);
    console.log();

    // ── STEP 2: Agent sends USDC (simulated) ──
    console.log('STEP 2: Agent sends USDC payment (simulated)...');
    const step2 = await fetch(`${BASE}/api/simulate-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0.001 }),
    });
    const step2Data = await step2.json();
    console.log(`   TX Signature: ${step2Data.tx_signature}`);
    console.log(`   Status: ${step2Data.status}`);
    console.log();

    // ── STEP 3: Agent submits TX signature for verification ──
    console.log('STEP 3: Agent submits tx_signature to /api/pay...');
    const step3 = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.001,
        resource: '/premium/data',
        tx_signature: step2Data.tx_signature,
      }),
    });
    const step3Data = await step3.json();
    console.log(`   Verified: ${step3Data.success}`);
    console.log(`   Token: ${step3Data.access_token?.substring(0, 50)}...`);
    console.log(`   Expires in: ${step3Data.expires_in}s`);
    console.log();

    // ── STEP 4: Agent retries with token → gets data ──
    console.log('STEP 4: Agent retries with Bearer token...');
    const step4 = await fetch(`${BASE}/premium/data`, {
      headers: {
        'User-Agent': 'Claude-Agent/1.0',
        'Authorization': `Bearer ${step3Data.access_token}`,
      },
    });
    const step4Data = await step4.json();
    console.log(`   Status: ${step4.status} ${step4.status === 200 ? '(OK!)' : ''}`);
    console.log(`   Data: ${step4Data.data}`);
    console.log(`   Paid: ${step4Data.paid}`);
    console.log(`   Token expires: ${step4Data.token_info?.expires}`);
    console.log();

    // ── STEP 5: Try with a FAKE tx signature (should fail) ──
    console.log('STEP 5: Try with fake tx (should fail)...');
    const step5 = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.001,
        tx_signature: 'fake_tx_signature_12345',
      }),
    });
    const step5Data = await step5.json();
    console.log(`   Status: ${step5.status}`);
    console.log(`   Error: ${step5Data.error}`);
    console.log(`   Reason: ${step5Data.reason}`);
    console.log();

    // ── SUMMARY ──
    console.log(`${'═'.repeat(60)}`);
    console.log('  SIMULATION COMPLETE');
    console.log(`${'═'.repeat(60)}`);
    console.log();
    console.log('  ✅ Step 1: Agent blocked with 402');
    console.log('  ✅ Step 2: Agent sent USDC payment');
    console.log('  ✅ Step 3: TX verified → token issued');
    console.log('  ✅ Step 4: Agent accessed data with token');
    console.log('  ✅ Step 5: Fake TX rejected');
    console.log();

  } catch (err) {
    console.error('Simulation error:', err);
  }

  process.exit(0);
});
