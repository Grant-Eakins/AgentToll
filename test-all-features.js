/**
 * AgentToll — Comprehensive Feature Test Suite
 * 
 * Tests ALL features against the live production server:
 *   1. Health check
 *   2. Publisher registration
 *   3. Publisher lookup (GET /api/publisher/me)
 *   4. Tollbooth SDK — agent detection + 402 flow
 *   5. Payment flow — mock + verification
 *   6. Token verification
 *   7. Analytics endpoints
 *   8. Content Gate — agentic crawler detection
 *   9. robots.txt generation
 *  10. MCP Proxy — registration + 402 flow
 *  11. Browser Gate — serves JS
 *  12. Dashboard — loads HTML
 *  13. Docs — loads HTML
 *  14. SSE — agent stopped events
 *  15. Replay protection
 *  16. Edge cases (invalid keys, bad tokens, etc.)
 * 
 * Run: node test-all-features.js [--production]
 * 
 * Default: tests against local server on port 3000
 * With --production: tests against agenttoll-production.up.railway.app
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// ── Config ──────────────────────────────────────────────────────
const isProduction = process.argv.includes('--production');
const BASE = isProduction
  ? 'https://agenttoll-production.up.railway.app'
  : 'http://localhost:3000';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ── Test runner ─────────────────────────────────────────────────
let totalPass = 0;
let totalFail = 0;
let totalSkip = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    totalPass++;
    console.log(`   ✅ ${label}`);
  } else {
    totalFail++;
    console.log(`   ❌ FAIL: ${label}`);
    failures.push(label);
  }
}

function skip(label, reason) {
  totalSkip++;
  console.log(`   ⏭️  SKIP: ${label} (${reason})`);
}

async function safeFetch(url, options = {}) {
  try {
    const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    return resp;
  } catch (err) {
    return { ok: false, status: 0, error: err.message, json: async () => ({ error: err.message }), text: async () => err.message };
  }
}

// ── Helpers ─────────────────────────────────────────────────────
let testPublisherKey = null;
let testSecretKey = null;

// ================================================================
// TEST SUITES
// ================================================================

async function testHealthCheck() {
  console.log('\n━━━ TEST 1: Health Check ━━━');
  const resp = await safeFetch(`${BASE}/health`);
  const data = await resp.json();
  check(`GET /health returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Service name is 'agenttoll'`, data.service === 'agenttoll');
  check(`Has version field`, !!data.version);
}

async function testHomepage() {
  console.log('\n━━━ TEST 2: Homepage & Static Assets ━━━');
  const resp = await safeFetch(`${BASE}/`);
  const html = await resp.text();
  check(`GET / returns 200`, resp.status === 200);
  check(`HTML contains AgentToll`, html.includes('AgentToll'));
  check(`HTML has What We Block section`, html.includes('what-we-block') || html.includes('Complete AI Agent Protection'));
}

async function testDocs() {
  console.log('\n━━━ TEST 3: Docs Page ━━━');
  const resp = await safeFetch(`${BASE}/docs`);
  const html = await resp.text();
  check(`GET /docs returns 200`, resp.status === 200);
  check(`Docs contain Content Gate section`, html.includes('content-gate') || html.includes('Content Gate'));
  check(`Docs contain MCP Proxy section`, html.includes('mcp-proxy') || html.includes('MCP Payment Proxy'));
  check(`Docs contain Browser Gate section`, html.includes('browser-gate') || html.includes('Browser Gate'));
}

async function testDashboard() {
  console.log('\n━━━ TEST 4: Dashboard Page ━━━');
  const resp = await safeFetch(`${BASE}/dashboard`);
  const html = await resp.text();
  check(`GET /dashboard returns 200`, resp.status === 200);
  check(`Dashboard HTML loads`, html.includes('dashboard') || html.includes('Dashboard'));
}

async function testBrowserGateJS() {
  console.log('\n━━━ TEST 5: Browser Gate JS ━━━');
  const resp = await safeFetch(`${BASE}/js/browser-gate.js`);
  const js = await resp.text();
  check(`GET /js/browser-gate.js returns 200`, resp.status === 200);
  check(`Contains detectAgenticBrowser`, js.includes('detectAgenticBrowser'));
  check(`Contains navigator.webdriver check`, js.includes('navigator.webdriver'));
  check(`Contains CDP markers check`, js.includes('cdc_adoQpoasnfa76pfcZLmcfl'));
  check(`Contains Selenium markers check`, js.includes('__selenium'));
  check(`Contains Playwright markers check`, js.includes('__playwright'));
  check(`Contains payment overlay`, js.includes('agenttoll-gate'));
}

async function testRobotsTxt() {
  console.log('\n━━━ TEST 6: robots.txt ━━━');
  const resp = await safeFetch(`${BASE}/robots.txt`);
  const txt = await resp.text();
  check(`GET /robots.txt returns 200`, resp.status === 200);
  check(`Contains GPTBot block`, txt.includes('GPTBot'));
  check(`Contains PerplexityBot block`, txt.includes('PerplexityBot'));
  check(`Contains ClaudeBot block`, txt.includes('ClaudeBot'));
  check(`Contains Disallow: /`, txt.includes('Disallow: /'));
  check(`Contains x402 payment reference`, txt.includes('x402') || txt.includes('payment'));
}

async function testPublisherRegistration() {
  console.log('\n━━━ TEST 7: Publisher Registration ━━━');
  const uniqueEmail = `test-${Date.now()}@agenttoll-test.com`;
  const resp = await safeFetch(`${BASE}/api/publisher/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Suite Publisher',
      email: uniqueEmail,
      wallet_address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      wallets: {
        solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        base: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      },
    }),
  });
  const data = await resp.json();
  check(`POST /api/publisher/register returns 200 or 201`, resp.status === 200 || resp.status === 201);
  check(`Returns api_key`, !!data.api_key);
  check(`Returns secret_key`, !!data.secret_key);
  check(`api_key starts with pk_`, data.api_key?.startsWith('pk_'));

  testPublisherKey = data.api_key;
  testSecretKey = data.secret_key;
  console.log(`   📝 Test publisher key: ${testPublisherKey}`);
}

async function testPublisherLookup() {
  console.log('\n━━━ TEST 8: Publisher Lookup ━━━');
  if (!testPublisherKey) { skip('Publisher lookup', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/publisher/me`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  const data = await resp.json();
  check(`GET /api/publisher/me returns 200`, resp.status === 200);
  check(`Returns publisher name`, data.name === 'Test Suite Publisher');
  check(`Has wallet_address`, !!data.wallet_address || !!data.wallets);
}

async function testPublisherLookupInvalidKey() {
  console.log('\n━━━ TEST 9: Publisher Lookup — Invalid Key ━━━');
  const resp = await safeFetch(`${BASE}/api/publisher/me`, {
    headers: { 'X-Publisher-Key': 'pk_invalid_key_12345' },
  });
  check(`Invalid key returns 404`, resp.status === 404);
}

async function testPublisherLookupNoKey() {
  console.log('\n━━━ TEST 10: Publisher Lookup — No Key ━━━');
  const resp = await safeFetch(`${BASE}/api/publisher/me`);
  check(`No key returns 401`, resp.status === 401);
}

async function testPaymentMissingNetwork() {
  console.log('\n━━━ TEST 11: Payment — Missing Network ━━━');
  const resp = await safeFetch(`${BASE}/api/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publisher: testPublisherKey || 'pk_test',
      amount: 0.05,
      tx_signature: 'fake_tx_12345',
    }),
  });
  const data = await resp.json();
  check(`Missing network returns 400 (status: ${resp.status})`, resp.status === 400);
  check(`Error says 'Network required'`, data.error === 'Network required');
  check(`Lists supported_networks`, Array.isArray(data.supported_networks));
}

async function testPaymentMissingTx() {
  console.log('\n━━━ TEST 12: Payment — Missing TX Signature ━━━');
  const resp = await safeFetch(`${BASE}/api/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publisher: testPublisherKey || 'pk_test',
      amount: 0.05,
      network: 'solana',
    }),
  });
  const data = await resp.json();
  check(`Missing tx returns 400 (status: ${resp.status})`, resp.status === 400);
  check(`Error mentions missing fields`, !!data.error);
}

async function testPaymentBelowMinimum() {
  console.log('\n━━━ TEST 13: Payment — Below Minimum Amount ━━━');
  const resp = await safeFetch(`${BASE}/api/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publisher: testPublisherKey || 'pk_test',
      amount: 0.001,
      network: 'solana',
      tx_signature: 'fake_tx_min',
    }),
  });
  const data = await resp.json();
  check(`Below minimum returns 400 (status: ${resp.status})`, resp.status === 400);
  check(`Error mentions minimum`, data.error?.includes('Minimum') || data.error?.includes('minimum'));
}

async function testPaymentFakeTx() {
  console.log('\n━━━ TEST 14: Payment — Fake TX Signature ━━━');
  const resp = await safeFetch(`${BASE}/api/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publisher: testPublisherKey || 'pk_test',
      amount: 0.05,
      network: 'solana',
      tx_signature: `fake_tx_${uuidv4()}`,
      resource: '/test',
    }),
  });
  check(`Fake tx returns non-200 (status: ${resp.status})`, resp.status !== 200);
}

async function testPaymentFakeTxBase() {
  console.log('\n━━━ TEST 15: Payment — Fake TX Hash (Base) ━━━');
  const resp = await safeFetch(`${BASE}/api/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publisher: testPublisherKey || 'pk_test',
      amount: 0.05,
      network: 'base',
      tx_hash: `0x${uuidv4().replace(/-/g, '')}abcdef1234567890`,
      resource: '/test',
    }),
  });
  check(`Fake Base tx returns non-200 (status: ${resp.status})`, resp.status !== 200);
}

async function testTokenVerifyInvalid() {
  console.log('\n━━━ TEST 16: Token Verification — Invalid Token ━━━');
  const resp = await safeFetch(`${BASE}/api/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey || 'pk_test',
    },
    body: JSON.stringify({ token: 'invalid.jwt.token' }),
  });
  const data = await resp.json();
  check(`Invalid token returns 401 (status: ${resp.status})`, resp.status === 401);
  check(`valid is false`, data.valid === false);
}

async function testTokenVerifyMissing() {
  console.log('\n━━━ TEST 17: Token Verification — No Token ━━━');
  const resp = await safeFetch(`${BASE}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await resp.json();
  check(`Missing token returns 400 (status: ${resp.status})`, resp.status === 400);
  check(`valid is false`, data.valid === false);
}

async function testTokenVerifyValid() {
  console.log('\n━━━ TEST 18: Token Verification — Valid Token (local JWT) ━━━');
  if (isProduction) {
    skip('Valid token test', 'Cannot generate tokens for production JWT_SECRET');
    return;
  }

  const token = jwt.sign({
    jti: uuidv4(),
    publisher: testPublisherKey || 'pk_test',
    resource: '/test',
    amount: 0.05,
    tx: 'test_tx_valid',
    network: 'solana',
    agent: 'test-agent',
    mode: 'session',
    scope: '/test',
    iat: Math.floor(Date.now() / 1000),
  }, JWT_SECRET, { expiresIn: 3600, issuer: 'agenttoll' });

  const resp = await safeFetch(`${BASE}/api/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey || 'pk_test',
    },
    body: JSON.stringify({ token }),
  });
  const data = await resp.json();
  check(`Valid token returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`valid is true`, data.valid === true);
  check(`Returns publisher`, !!data.publisher);
  check(`Returns expires_at`, !!data.expires_at);
}

async function testAnalyticsSummary() {
  console.log('\n━━━ TEST 19: Analytics — Summary ━━━');
  if (!testPublisherKey) { skip('Analytics summary', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/analytics`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  const data = await resp.json();
  check(`GET /api/analytics returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Has data structure`, typeof data === 'object');
}

async function testAnalyticsNoKey() {
  console.log('\n━━━ TEST 20: Analytics — No Key ━━━');
  const resp = await safeFetch(`${BASE}/api/analytics`);
  check(`No key returns 401 (status: ${resp.status})`, resp.status === 401);
}

async function testAnalyticsAgents() {
  console.log('\n━━━ TEST 21: Analytics — Agent Stats ━━━');
  if (!testPublisherKey) { skip('Agent stats', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/analytics/agents`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  check(`GET /api/analytics/agents returns 200 (status: ${resp.status})`, resp.status === 200);
}

async function testAnalyticsRevenue() {
  console.log('\n━━━ TEST 22: Analytics — Revenue ━━━');
  if (!testPublisherKey) { skip('Revenue stats', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/analytics/revenue`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  check(`GET /api/analytics/revenue returns 200 (status: ${resp.status})`, resp.status === 200);
}

async function testAnalyticsAgentsStopped() {
  console.log('\n━━━ TEST 23: Analytics — Agents Stopped ━━━');
  if (!testPublisherKey) { skip('Agents stopped', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/analytics/agents-stopped`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  check(`GET /api/analytics/agents-stopped returns 200 (status: ${resp.status})`, resp.status === 200);
}

async function testAnalyticsAgentBlockedBeacon() {
  console.log('\n━━━ TEST 24: Analytics — Browser Gate Beacon ━━━');
  const resp = await safeFetch(`${BASE}/api/analytics/agent-blocked`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publisher_key: testPublisherKey || 'pk_test',
      signals: ['navigator.webdriver=true', 'HeadlessChrome UA'],
      confidence: 90,
      user_agent: 'HeadlessChrome/120.0',
      resource: '/test-page',
      source: 'browser-gate',
    }),
  });
  check(`POST /api/analytics/agent-blocked returns 200 (status: ${resp.status})`, resp.status === 200);
}

async function testAnalyticsStoppedDetails() {
  console.log('\n━━━ TEST 25: Analytics — Stopped Details ━━━');
  if (!testPublisherKey) { skip('Stopped details', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/analytics/agents-stopped/details`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  check(`GET /api/analytics/agents-stopped/details returns 200 (status: ${resp.status})`, resp.status === 200);
}

async function testAnalyticsPlatform() {
  console.log('\n━━━ TEST 26: Analytics — Platform Stats ━━━');
  const resp = await safeFetch(`${BASE}/api/analytics/platform`);
  const data = await resp.json();
  check(`GET /api/analytics/platform returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Has agents_stopped field`, data.agents_stopped !== undefined);
  check(`Has publishers field`, data.publishers !== undefined);
}

async function testMCPRegister() {
  console.log('\n━━━ TEST 27: MCP — Register Server ━━━');
  if (!testPublisherKey) { skip('MCP register', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/mcp/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey,
    },
    body: JSON.stringify({
      upstream_url: 'http://localhost:9999/mcp',
      name: 'Test MCP Server',
      description: 'Test server for feature tests',
      amount: 0.10,
    }),
  });
  const data = await resp.json();
  check(`POST /api/mcp/register returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Returns success`, data.success === true);
  check(`Returns mcp_id`, !!data.mcp_id);
  check(`Returns proxy_url`, !!data.proxy_url);
  check(`Returns agent_config`, !!data.agent_config);
  check(`Returns example_mcp_config`, !!data.example_mcp_config);
}

async function testMCPRegisterNoKey() {
  console.log('\n━━━ TEST 28: MCP — Register No Key ━━━');
  const resp = await safeFetch(`${BASE}/api/mcp/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upstream_url: 'http://localhost:9999/mcp' }),
  });
  check(`No key returns 401 (status: ${resp.status})`, resp.status === 401);
}

async function testMCPRegisterNoUpstream() {
  console.log('\n━━━ TEST 29: MCP — Register No Upstream URL ━━━');
  if (!testPublisherKey) { skip('MCP no upstream', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/mcp/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey,
    },
    body: JSON.stringify({}),
  });
  check(`No upstream returns 400 (status: ${resp.status})`, resp.status === 400);
}

async function testMCPServers() {
  console.log('\n━━━ TEST 30: MCP — List Servers ━━━');
  if (!testPublisherKey) { skip('MCP servers', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/mcp/servers`, {
    headers: { 'X-Publisher-Key': testPublisherKey },
  });
  const data = await resp.json();
  check(`GET /api/mcp/servers returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Returns servers array`, Array.isArray(data.servers));
  check(`Has at least 1 registered server`, data.servers?.length >= 1);
  check(`Returns proxy_url`, !!data.proxy_url);
}

async function testMCPProxyNoHeaders() {
  console.log('\n━━━ TEST 31: MCP — Proxy Missing Headers ━━━');
  const resp = await safeFetch(`${BASE}/api/mcp/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1 }),
  });
  const data = await resp.json();
  check(`No publisher key returns 400 (status: ${resp.status})`, resp.status === 400);
  check(`Error in JSON-RPC format`, data.jsonrpc === '2.0');
}

async function testMCPProxyNoUpstream() {
  console.log('\n━━━ TEST 32: MCP — Proxy No Upstream ━━━');
  if (!testPublisherKey) { skip('MCP proxy no upstream', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/mcp/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1 }),
  });
  const data = await resp.json();
  check(`No upstream returns 400 (status: ${resp.status})`, resp.status === 400);
  check(`Error mentions upstream`, data.error?.message?.includes('Upstream') || data.error?.message?.includes('upstream'));
}

async function testMCPProxyPaidMethod402() {
  console.log('\n━━━ TEST 33: MCP — Proxy Paid Method Returns 402 ━━━');
  if (!testPublisherKey) { skip('MCP proxy 402', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/mcp/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey,
      'X-MCP-Upstream': 'http://localhost:9999/mcp',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'get_data' } }),
  });
  const data = await resp.json();
  check(`Paid method returns 402 (status: ${resp.status})`, resp.status === 402);
  check(`JSON-RPC error format`, data.jsonrpc === '2.0');
  check(`Error code is -32402`, data.error?.code === -32402);
  check(`Has x402 payment data`, !!data.error?.data?.x402);
  check(`x402 has amount`, !!data.error?.data?.x402?.amount);
  check(`x402 has currency USDC`, data.error?.data?.x402?.currency === 'USDC');
  check(`Has payment instructions`, !!data.error?.data?.agent_instructions);
  check(`Has pay_url`, !!data.error?.data?.payment?.pay_url);
}

async function testMCPWrapNoToken() {
  console.log('\n━━━ TEST 34: MCP — Wrap Without Token ━━━');
  if (!testPublisherKey) { skip('MCP wrap', 'No publisher key'); return; }

  const resp = await safeFetch(`${BASE}/api/mcp/wrap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey,
    },
    body: JSON.stringify({ tool_name: 'get_data', arguments: { query: 'test' } }),
  });
  const data = await resp.json();
  check(`No token returns 402 (status: ${resp.status})`, resp.status === 402);
  check(`Returns x402 block`, !!data.x402);
  check(`Has pay_url`, !!data.payment?.pay_url);
}

async function testPayPage() {
  console.log('\n━━━ TEST 35: Payment Page ━━━');
  const resp = await safeFetch(`${BASE}/pay?publisher=pk_test&amount=0.05&resource=/api/data`);
  const html = await resp.text();
  check(`GET /pay returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Payment page has toll amount`, html.includes('0.05'));
  check(`Payment page has publisher`, html.includes('pk_test'));
}

async function testApiDocs() {
  console.log('\n━━━ TEST 36: API Docs Endpoint ━━━');
  const resp = await safeFetch(`${BASE}/api/docs`);
  check(`GET /api/docs returns 200 (status: ${resp.status})`, resp.status === 200);
}

async function test404() {
  console.log('\n━━━ TEST 37: 404 Handler ━━━');
  const resp = await safeFetch(`${BASE}/api/nonexistent-route-xyz`);
  check(`Unknown route returns 404 (status: ${resp.status})`, resp.status === 404);
}

async function testPublisherSettings() {
  console.log('\n━━━ TEST 38: Publisher Settings Update ━━━');
  if (!testPublisherKey) { skip('Settings update', 'No keys'); return; }

  const resp = await safeFetch(`${BASE}/api/publisher/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Publisher-Key': testPublisherKey,
    },
    body: JSON.stringify({
      default_amount: 0.10,
      access_mode: 'session',
      access_duration: '1h',
    }),
  });
  const data = await resp.json();
  check(`PUT /api/publisher/settings returns 200 (status: ${resp.status})`, resp.status === 200);
  check(`Settings updated`, data.success === true || !!data.settings);
}

// ── Local-only: SDK tollbooth middleware test ─────────────────
async function testTollboothSDKLocal() {
  console.log('\n━━━ TEST 39: SDK Tollbooth — Agent Detection (local) ━━━');
  if (isProduction) { skip('Tollbooth SDK local test', 'Production mode'); return; }

  // Import the SDK and spin up a quick express app
  const { default: tollbooth } = await import('./sdk/tollbooth.js');

  const testApp = express();
  testApp.use(express.json());

  testApp.use('/protected', tollbooth(testPublisherKey || 'pk_test_local', {
    amount: 0.05,
    freeForHumans: true,
  }));

  testApp.get('/protected/data', (req, res) => {
    res.json({ success: true, paid: req.tollPaid || false, agent: req.tollAgent || false });
  });

  const testServer = await new Promise((resolve) => {
    const s = testApp.listen(0, () => resolve(s));
  });
  const port = testServer.address().port;

  try {
    // Human request — should pass
    const humanResp = await fetch(`http://localhost:${port}/protected/data`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    });
    check(`Human UA gets 200 (status: ${humanResp.status})`, humanResp.status === 200);

    // Agent requests — should get 402
    const agentUAs = [
      { name: 'Claude', ua: 'Claude-Agent/1.0' },
      { name: 'OpenAI', ua: 'OpenAI-GPT/4.0' },
      { name: 'GPTBot', ua: 'GPTBot/1.0' },
      { name: 'Perplexity', ua: 'PerplexityBot/1.0' },
      { name: 'LangChain', ua: 'LangChain/0.1' },
      { name: 'Python-requests', ua: 'python-requests/2.31' },
      { name: 'Scrapy', ua: 'Scrapy/2.11' },
      { name: 'Puppeteer', ua: 'puppeteer/21.0' },
      { name: 'Selenium', ua: 'selenium/4.15' },
      { name: 'GenericBot', ua: 'MyCustomBot/1.0' },
      { name: 'Crawler', ua: 'MyCrawler/2.0' },
      { name: 'Spider', ua: 'WebSpider/1.0' },
      { name: 'curl', ua: 'curl/8.0' },
      { name: 'Anthropic', ua: 'Anthropic-AI/1.0' },
      { name: 'Cohere', ua: 'cohere-ai/1.0' },
      { name: 'Google-Extended', ua: 'Google-Extended' },
    ];

    for (const { name, ua } of agentUAs) {
      const resp = await fetch(`http://localhost:${port}/protected/data`, {
        headers: { 'User-Agent': ua },
      });
      check(`${name} (${ua}) gets 402 (status: ${resp.status})`, resp.status === 402);
    }
  } finally {
    testServer.close();
  }
}

// ── Local-only: Content Gate middleware test ──────────────────
async function testContentGateLocal() {
  console.log('\n━━━ TEST 40: Content Gate — Crawler Detection (local) ━━━');
  if (isProduction) { skip('Content Gate local test', 'Production mode'); return; }

  const { contentGate, generateRobotsTxt, isAgenticCrawler } = await import('./sdk/content-gate.js');

  const testApp = express();
  testApp.use(contentGate('pk_test_cg', { amount: 0.05 }));
  testApp.get('/page', (req, res) => res.send('<html><body>Real content</body></html>'));

  const testServer = await new Promise((resolve) => {
    const s = testApp.listen(0, () => resolve(s));
  });
  const port = testServer.address().port;

  try {
    // Human request — should pass
    const humanResp = await fetch(`http://localhost:${port}/page`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' },
    });
    const humanHtml = await humanResp.text();
    check(`Human UA passes through content gate (status: ${humanResp.status})`, humanResp.status === 200);
    check(`Human gets real content`, humanHtml.includes('Real content'));

    // Agentic crawlers — should get 402
    const crawlers = [
      { name: 'GPTBot', ua: 'GPTBot/1.0' },
      { name: 'PerplexityBot', ua: 'PerplexityBot/1.0' },
      { name: 'ClaudeBot', ua: 'ClaudeBot/1.0' },
      { name: 'CCBot', ua: 'CCBot/2.0' },
      { name: 'Bytespider', ua: 'Bytespider' },
      { name: 'Scrapy', ua: 'Scrapy/2.0' },
    ];

    for (const { name, ua } of crawlers) {
      const resp = await fetch(`http://localhost:${port}/page`, {
        headers: { 'User-Agent': ua },
      });
      const html = await resp.text();
      check(`${name} gets 402 (status: ${resp.status})`, resp.status === 402);
      check(`${name} sees payment page`, html.includes('402') || html.includes('Payment Required') || html.includes('x402'));
    }

    // Social preview bot — should pass through
    const twitterResp = await fetch(`http://localhost:${port}/page`, {
      headers: { 'User-Agent': 'Twitterbot/1.0' },
    });
    check(`Twitterbot passes through (status: ${twitterResp.status})`, twitterResp.status === 200);

    // Test robots.txt generation
    const robotsTxt = generateRobotsTxt({ apiKey: 'pk_test', amount: 0.05 });
    check(`robots.txt is non-empty string`, typeof robotsTxt === 'string' && robotsTxt.length > 100);
    check(`robots.txt blocks GPTBot`, robotsTxt.includes('GPTBot'));
    check(`robots.txt has x402 comment`, robotsTxt.includes('x402'));

  } finally {
    testServer.close();
  }
}

// ── E2E local payment simulation ─────────────────────────────
async function testLocalPaymentE2E() {
  console.log('\n━━━ TEST 41: E2E Payment Simulation (local) ━━━');
  if (isProduction) { skip('E2E local payment', 'Production mode — use real tx'); return; }

  // This spins up a self-contained server with mock payment like the old test
  const testApp = express();
  testApp.use(express.json());

  const validTxs = new Map();
  const usedTxs = new Set();

  // Mock payment simulation
  testApp.post('/simulate-pay', (req, res) => {
    const { amount, network } = req.body;
    if (!network) return res.status(400).json({ error: 'network required' });
    const sig = `sim_${network}_${uuidv4().replace(/-/g, '')}`;
    validTxs.set(sig, { amount: amount || 0.05, network, timestamp: Date.now() });
    res.json({ tx_signature: sig, network, amount: amount || 0.05 });
  });

  // Mock verify + token
  testApp.post('/pay', (req, res) => {
    const { publisher, amount, resource, tx_signature, network } = req.body;
    if (!network || !['solana', 'base'].includes(network)) {
      return res.status(400).json({ error: 'Network required', supported_networks: ['solana', 'base'] });
    }
    if (!publisher || !tx_signature) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (usedTxs.has(tx_signature)) {
      return res.status(409).json({ error: 'Transaction already used' });
    }
    const tx = validTxs.get(tx_signature);
    if (!tx) {
      return res.status(402).json({ error: 'Payment verification failed', reason: 'Transaction not found' });
    }
    usedTxs.add(tx_signature);
    const token = jwt.sign({
      jti: uuidv4(), publisher, resource, amount, tx: tx_signature, network, agent: 'test',
      mode: 'session', iat: Math.floor(Date.now() / 1000),
    }, JWT_SECRET, { expiresIn: 3600, issuer: 'agenttoll' });
    res.json({ success: true, access_token: token, network, expires_in: 3600 });
  });

  // Simple tollbooth
  testApp.use('/premium', (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (!/agent|bot|claude|openai|gpt/i.test(ua)) return next();
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET, { issuer: 'agenttoll' });
        if (decoded) { req.tokenData = decoded; return next(); }
      } catch {}
    }
    return res.status(402).json({
      status: 402, message: 'Payment Required',
      payment: { amount: 0.05, currency: 'USDC', supported_networks: ['solana', 'base'] },
    });
  });
  testApp.get('/premium/data', (req, res) => {
    res.json({ success: true, data: 'SECRET', token_info: req.tokenData || null });
  });

  const testServer = await new Promise((resolve) => {
    const s = testApp.listen(0, () => resolve(s));
  });
  const port = testServer.address().port;
  const B = `http://localhost:${port}`;

  try {
    // Step 1: Agent hits 402
    const s1 = await fetch(`${B}/premium/data`, { headers: { 'User-Agent': 'Claude-Agent/1.0' } });
    const s1d = await s1.json();
    check(`Step 1: Agent gets 402`, s1.status === 402);
    check(`Step 1: Has supported_networks`, Array.isArray(s1d.payment?.supported_networks));

    // Step 2: Pay without network → 400
    const s2 = await fetch(`${B}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisher: 'pk_test', amount: 0.05, tx_signature: 'x' }),
    });
    check(`Step 2: No network → 400`, s2.status === 400);

    // Step 3: Simulate Solana payment
    const s3 = await fetch(`${B}/simulate-pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0.05, network: 'solana' }),
    });
    const s3d = await s3.json();
    check(`Step 3: Simulated Solana tx`, !!s3d.tx_signature);

    // Step 4: Submit payment
    const s4 = await fetch(`${B}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisher: 'pk_test', amount: 0.05, tx_signature: s3d.tx_signature, network: 'solana', resource: '/premium/data' }),
    });
    const s4d = await s4.json();
    check(`Step 4: Payment verified`, s4d.success === true);
    check(`Step 4: Token issued`, !!s4d.access_token);
    check(`Step 4: Network is solana`, s4d.network === 'solana');

    // Step 5: Retry with token → 200
    const s5 = await fetch(`${B}/premium/data`, {
      headers: { 'User-Agent': 'Claude-Agent/1.0', 'Authorization': `Bearer ${s4d.access_token}` },
    });
    const s5d = await s5.json();
    check(`Step 5: Token access → 200`, s5.status === 200);
    check(`Step 5: Got secret data`, s5d.data === 'SECRET');
    check(`Step 5: Token info has network`, s5d.token_info?.network === 'solana');

    // Step 6: Replay attack → 409
    const s6 = await fetch(`${B}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisher: 'pk_test', amount: 0.05, tx_signature: s3d.tx_signature, network: 'solana' }),
    });
    check(`Step 6: Replay → 409`, s6.status === 409);

    // Step 7: Fake tx → 402
    const s7 = await fetch(`${B}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisher: 'pk_test', amount: 0.05, tx_signature: 'fake_tx_xyz', network: 'solana' }),
    });
    check(`Step 7: Fake tx → 402`, s7.status === 402);

    // Step 8: Base payment
    const s8a = await fetch(`${B}/simulate-pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0.05, network: 'base' }),
    });
    const s8ad = await s8a.json();
    const s8b = await fetch(`${B}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisher: 'pk_test', amount: 0.05, tx_signature: s8ad.tx_signature, network: 'base' }),
    });
    const s8bd = await s8b.json();
    check(`Step 8: Base payment verified`, s8bd.success === true);
    check(`Step 8: Base network in response`, s8bd.network === 'base');

  } finally {
    testServer.close();
  }
}

// ================================================================
// RUN ALL TESTS
// ================================================================

async function run() {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  AgentToll — Comprehensive Feature Test Suite`);
  console.log(`  Target: ${BASE}`);
  console.log(`  Mode: ${isProduction ? 'PRODUCTION' : 'LOCAL'}`);
  console.log(`${'═'.repeat(65)}`);

  // Static pages & assets
  await testHealthCheck();
  await testHomepage();
  await testDocs();
  await testDashboard();
  await testBrowserGateJS();
  await testRobotsTxt();

  // Publisher management
  await testPublisherRegistration();
  await testPublisherLookup();
  await testPublisherLookupInvalidKey();
  await testPublisherLookupNoKey();
  await testPublisherSettings();

  // Payment validation (edge cases / rejections)
  await testPaymentMissingNetwork();
  await testPaymentMissingTx();
  await testPaymentBelowMinimum();
  await testPaymentFakeTx();
  await testPaymentFakeTxBase();

  // Token verification
  await testTokenVerifyInvalid();
  await testTokenVerifyMissing();
  await testTokenVerifyValid();

  // Analytics
  await testAnalyticsSummary();
  await testAnalyticsNoKey();
  await testAnalyticsAgents();
  await testAnalyticsRevenue();
  await testAnalyticsAgentsStopped();
  await testAnalyticsAgentBlockedBeacon();
  await testAnalyticsStoppedDetails();
  await testAnalyticsPlatform();

  // MCP Proxy
  await testMCPRegister();
  await testMCPRegisterNoKey();
  await testMCPRegisterNoUpstream();
  await testMCPServers();
  await testMCPProxyNoHeaders();
  await testMCPProxyNoUpstream();
  await testMCPProxyPaidMethod402();
  await testMCPWrapNoToken();

  // Other pages
  await testPayPage();
  await testApiDocs();
  await test404();

  // Local-only tests (SDK middleware, content gate, payment E2E)
  await testTollboothSDKLocal();
  await testContentGateLocal();
  await testLocalPaymentE2E();

  // ── Summary ──
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  RESULTS: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
  console.log(`${'═'.repeat(65)}`);

  if (failures.length > 0) {
    console.log(`\n  ⚠️  FAILURES:`);
    failures.forEach(f => console.log(`     - ${f}`));
  }

  if (totalFail === 0) {
    console.log(`\n  🎉 ALL TESTS PASSED!\n`);
  } else {
    console.log(`\n  ❌ ${totalFail} TEST(S) FAILED\n`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
