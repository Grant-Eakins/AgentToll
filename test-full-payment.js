/**
 * Full end-to-end payment simulation
 * Tests the complete flow with all protections:
 *   1. Agent hits paywall → gets 402 with supported_networks
 *   2. Agent reads payment instructions
 *   3. Agent "pays" (mocked) and submits tx signature + network
 *   4. System verifies recency + returns access token
 *   5. Agent retries with token → gets data
 *   6. Replay protection: same tx rejected
 *   7. Missing network → rejected
 *   8. Fake tx → rejected
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
    settings: { access_mode: 'session', access_duration: '1h' },
  },
};

// ─── Mock on-chain verification ────────────────────────────────
const validTransactions = new Map();  // tx → { amount, network, timestamp }
const usedTransactions = new Set();   // replay protection

const TX_MAX_AGE_SECONDS = 600; // 10 minutes

function mockVerifyPayment(signature, expectedAmount) {
  const tx = validTransactions.get(signature);
  if (!tx) {
    return { valid: false, reason: 'Transaction not found' };
  }
  // Recency check
  const ageSeconds = Math.floor(Date.now() / 1000) - Math.floor(tx.timestamp / 1000);
  if (ageSeconds > TX_MAX_AGE_SECONDS) {
    return { valid: false, reason: `Transaction too old (${ageSeconds}s ago, max ${TX_MAX_AGE_SECONDS}s)` };
  }
  return { valid: true, amount: tx.amount, block: 123456789, network: tx.network };
}

// ─── Token generation (same as production) ─────────────────────
function generateAccessToken(payload) {
  return jwt.sign({
    jti: uuidv4(),
    publisher: payload.publisher,
    resource: payload.resource,
    amount: payload.amount,
    tx: payload.tx,
    network: payload.network,
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
    if (!isAgent) return next();

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        req.tollPaid = true;
        req.tollAgent = true;
        req.tokenData = decoded;
        return next();
      }
    }

    return res.status(402).json({
      status: 402,
      message: 'Payment Required',
      payment: {
        amount: options.amount,
        currency: 'USDC',
        supported_networks: ['solana', 'base'],
        pay_url: `http://localhost:3002/api/pay`,
        publisher: apiKey,
      },
      agent_instructions: `Send ${options.amount} USDC on solana or base, then POST tx signature + network to /api/pay`,
    });
  };
}

// ─── Payment endpoint ──────────────────────────────────────────
app.post('/api/pay', (req, res) => {
  const { publisher, amount, resource, tx_signature, network } = req.body;

  // Network is REQUIRED
  if (!network || !['solana', 'base'].includes(network)) {
    return res.status(400).json({
      error: 'Network required',
      message: "Specify network: 'solana' or 'base'",
      supported_networks: ['solana', 'base'],
    });
  }

  if (!publisher || !tx_signature) {
    return res.status(400).json({ error: 'Missing publisher or tx_signature' });
  }

  // Replay protection
  if (usedTransactions.has(tx_signature)) {
    return res.status(409).json({
      error: 'Transaction already used',
      agent_hint: 'This transaction signature has already been redeemed. Send a new payment.',
    });
  }

  // Verify on-chain (mocked)
  const verification = mockVerifyPayment(tx_signature, amount);

  if (!verification.valid) {
    return res.status(402).json({
      error: 'Payment verification failed',
      reason: verification.reason,
    });
  }

  // Mark as used
  usedTransactions.add(tx_signature);

  // Payment verified → generate token
  const token = generateAccessToken({
    publisher,
    resource: resource || '/premium/data',
    amount,
    tx: tx_signature,
    network,
    agent: 'test-agent',
  });

  console.log(`   ✅ Payment verified on ${network}! Token issued.`);

  return res.json({
    success: true,
    access_token: token,
    token_type: 'Bearer',
    expires_in: 3600,
    network,
    instructions: 'Add this token as: Authorization: Bearer <token>',
  });
});

// ─── Mock payment endpoint (simulates the agent sending USDC) ──
app.post('/api/simulate-pay', (req, res) => {
  const network = req.body.network;
  if (!network || !['solana', 'base'].includes(network)) {
    return res.status(400).json({ error: "Specify network: 'solana' or 'base'" });
  }

  const fakeTxSignature = `sim_${network}_${uuidv4().replace(/-/g, '')}`;
  validTransactions.set(fakeTxSignature, {
    amount: req.body.amount || 0.05,
    network,
    timestamp: Date.now(),
  });

  console.log(`   💸 Simulated ${network.toUpperCase()} USDC transfer. TX: ${fakeTxSignature}`);

  return res.json({
    tx_signature: fakeTxSignature,
    status: 'confirmed',
    amount: req.body.amount || 0.05,
    network,
  });
});

// ─── Protected endpoint ────────────────────────────────────────
app.use('/premium', tollbooth(MOCK_PUBLISHER_KEY, { amount: 0.05 }));

app.get('/premium/data', (req, res) => {
  res.json({
    success: true,
    data: '🔓 SECRET PREMIUM DATA - You paid to see this!',
    paid: req.tollPaid || false,
    token_info: req.tokenData ? {
      publisher: req.tokenData.publisher,
      amount: req.tokenData.amount,
      network: req.tokenData.network,
      tx: req.tokenData.tx,
      expires: new Date(req.tokenData.exp * 1000).toISOString(),
    } : null,
  });
});

// ─── Start server and run simulation ───────────────────────────
const PORT = 3002;
app.listen(PORT, async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  AgentToll E2E Payment Simulation`);
  console.log(`  Tests: 402 block, network required, pay, verify,`);
  console.log(`         token access, replay rejection, fake tx rejection`);
  console.log(`${'═'.repeat(60)}\n`);

  const BASE = `http://localhost:${PORT}`;
  let pass = 0;
  let fail = 0;

  function check(label, condition) {
    if (condition) { pass++; console.log(`   ✅ ${label}`); }
    else { fail++; console.log(`   ❌ FAIL: ${label}`); }
  }

  try {
    // ── STEP 1: Agent hits paywall ──
    console.log('STEP 1: Agent requests premium data...');
    const step1 = await fetch(`${BASE}/premium/data`, {
      headers: { 'User-Agent': 'Claude-Agent/1.0' },
    });
    const step1Data = await step1.json();
    check(`Got 402 (status: ${step1.status})`, step1.status === 402);
    check(`Shows supported_networks`, Array.isArray(step1Data.payment?.supported_networks));
    check(`Amount is $${step1Data.payment?.amount}`, step1Data.payment?.amount === 0.05);
    console.log();

    // ── STEP 2: Pay WITHOUT network → should fail ──
    console.log('STEP 2: Submit payment without network (should fail)...');
    const step2 = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.05,
        tx_signature: 'some_tx_123',
      }),
    });
    const step2Data = await step2.json();
    check(`Rejected: ${step2Data.error}`, step2.status === 400 && step2Data.error === 'Network required');
    console.log();

    // ── STEP 3: Agent sends USDC on Base (simulated) ──
    console.log('STEP 3: Agent sends 0.05 USDC on Base (simulated)...');
    const step3 = await fetch(`${BASE}/api/simulate-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0.05, network: 'base' }),
    });
    const step3Data = await step3.json();
    check(`Got TX: ${step3Data.tx_signature?.substring(0, 30)}...`, !!step3Data.tx_signature);
    check(`Network: ${step3Data.network}`, step3Data.network === 'base');
    console.log();

    // ── STEP 4: Submit TX for verification with network=base ──
    console.log('STEP 4: Submit tx_signature + network=base to /api/pay...');
    const step4 = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.05,
        resource: '/premium/data',
        tx_signature: step3Data.tx_signature,
        network: 'base',
      }),
    });
    const step4Data = await step4.json();
    check(`Payment verified: ${step4Data.success}`, step4Data.success === true);
    check(`Network in response: ${step4Data.network}`, step4Data.network === 'base');
    check(`Token issued`, !!step4Data.access_token);
    console.log();

    // ── STEP 5: Agent retries with token → gets data ──
    console.log('STEP 5: Agent retries with Bearer token...');
    const step5 = await fetch(`${BASE}/premium/data`, {
      headers: {
        'User-Agent': 'Claude-Agent/1.0',
        'Authorization': `Bearer ${step4Data.access_token}`,
      },
    });
    const step5Data = await step5.json();
    check(`Got 200 (status: ${step5.status})`, step5.status === 200);
    check(`Got secret data`, step5Data.data?.includes('SECRET PREMIUM DATA'));
    check(`Token shows network: ${step5Data.token_info?.network}`, step5Data.token_info?.network === 'base');
    console.log();

    // ── STEP 6: Replay attack → same TX again (should fail) ──
    console.log('STEP 6: Replay attack — resubmit same tx_signature...');
    const step6 = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.05,
        tx_signature: step3Data.tx_signature,
        network: 'base',
      }),
    });
    const step6Data = await step6.json();
    check(`Replay rejected (409): ${step6Data.error}`, step6.status === 409);
    console.log();

    // ── STEP 7: Fake TX (should fail) ──
    console.log('STEP 7: Fake tx_signature (should fail)...');
    const step7 = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.05,
        tx_signature: 'fake_tx_signature_12345',
        network: 'solana',
      }),
    });
    const step7Data = await step7.json();
    check(`Fake tx rejected: ${step7Data.reason}`, step7.status === 402);
    console.log();

    // ── STEP 8: Solana payment (test both networks) ──
    console.log('STEP 8: Pay on Solana (verify both networks work)...');
    const step8a = await fetch(`${BASE}/api/simulate-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0.05, network: 'solana' }),
    });
    const step8aData = await step8a.json();
    const step8b = await fetch(`${BASE}/api/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher: MOCK_PUBLISHER_KEY,
        amount: 0.05,
        resource: '/premium/data',
        tx_signature: step8aData.tx_signature,
        network: 'solana',
      }),
    });
    const step8bData = await step8b.json();
    check(`Solana payment verified: ${step8bData.success}`, step8bData.success === true);
    check(`Solana network in response: ${step8bData.network}`, step8bData.network === 'solana');
    console.log();

    // ── SUMMARY ──
    console.log(`${'═'.repeat(60)}`);
    console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
    console.log(`${'═'.repeat(60)}`);
    console.log();
    console.log('  Step 1: Agent blocked with 402 + supported_networks');
    console.log('  Step 2: Missing network → 400 error');
    console.log('  Step 3: Simulated Base USDC payment');
    console.log('  Step 4: TX verified with network=base → token');
    console.log('  Step 5: Agent accessed data with token');
    console.log('  Step 6: Replay attack blocked (409)');
    console.log('  Step 7: Fake TX rejected (402)');
    console.log('  Step 8: Solana payment also works');
    console.log();

    if (fail === 0) {
      console.log('  🎉 ALL TESTS PASSED');
    } else {
      console.log(`  ⚠️  ${fail} TEST(S) FAILED`);
    }
    console.log();

  } catch (err) {
    console.error('Simulation error:', err);
  }

  process.exit(0);
});
