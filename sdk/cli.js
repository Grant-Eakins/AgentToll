#!/usr/bin/env node

/**
 * AgentToll CLI — Frictionless API key generation
 * 
 * Usage:
 *   npx agenttoll init                              - Interactive setup
 *   npx agenttoll init <WALLET>                     - One-arg quick setup
 *   npx agenttoll init --wallet <ADDR> --name MyAPI - Fully scripted
 * 
 * Generates the same pk_live_ / sk_live_ keys as the web dashboard.
 * Keys work in the dashboard at https://www.agenttoll.xyz/dashboard
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { generateKeyPairSync, randomBytes, createHash, createECDH } from 'crypto';

const API_BASE = process.env.AGENTTOLL_API || 'https://toll.agenttoll.xyz';
const ENV_FILE = resolve(process.cwd(), '.env');
const DASHBOARD_URL = 'https://www.agenttoll.xyz/dashboard';
const DOCS_URL = 'https://www.agenttoll.xyz/docs';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ask(prompt, fallback) {
  return new Promise((resolve) => {
    const r = createInterface({ input: process.stdin, output: process.stdout });
    const display = fallback ? `${prompt} [${fallback}]: ` : `${prompt}: `;
    r.question(display, (answer) => {
      r.close();
      resolve(answer.trim() || fallback || '');
    });
  });
}

/** Detect project name from package.json or folder name */
function detectProjectName() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
    return pkg.name || basename(process.cwd());
  } catch {
    return basename(process.cwd());
  }
}

/** Detect if a string looks like a Solana or Base wallet */
function looksLikeWallet(s) {
  if (!s) return false;
  // Solana: base58, 32–44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return 'solana';
  // Base/ETH: 0x + 40 hex chars
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return 'base';
  return false;
}

function writeKeyToEnv(apiKey, secretKey) {
  let content = '';
  if (existsSync(ENV_FILE)) {
    content = readFileSync(ENV_FILE, 'utf-8');
  }

  const lines = content.split('\n');
  let hasApiKey = false;
  let hasSecretKey = false;

  const updated = lines.map((line) => {
    if (line.startsWith('AGENTTOLL_API_KEY=')) {
      hasApiKey = true;
      return `AGENTTOLL_API_KEY=${apiKey}`;
    }
    if (line.startsWith('AGENTTOLL_SECRET_KEY=')) {
      hasSecretKey = true;
      return `AGENTTOLL_SECRET_KEY=${secretKey}`;
    }
    return line;
  });

  if (!hasApiKey) updated.push(`AGENTTOLL_API_KEY=${apiKey}`);
  if (!hasSecretKey) updated.push(`AGENTTOLL_SECRET_KEY=${secretKey}`);

  const final = updated.filter((l, i, a) => i < a.length - 1 || l.trim()).join('\n') + '\n';
  writeFileSync(ENV_FILE, final);
}

/** Ask a numbered-choice question, return the selected value */
async function choose(prompt, options, defaultIndex = 0) {
  console.log(`\n  ${prompt}`);
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? '→' : ' ';
    console.log(`  ${marker} ${i + 1}) ${opt.label}${opt.desc ? ` — ${opt.desc}` : ''}`);
  });
  const answer = await ask(`  Choice (1-${options.length})`, String(defaultIndex + 1));
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) return options[idx].value;
  return options[defaultIndex].value;
}

// Base58 alphabet (Bitcoin/Solana)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Encode a Buffer to base58 (Solana address format) */
function base58Encode(buffer) {
  const bytes = Uint8Array.from(buffer);
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  // Leading zeros
  for (const byte of bytes) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
}

/** Generate a Solana wallet (Ed25519 keypair) using Node crypto */
function generateSolanaWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
  // Ed25519 SPKI DER: last 32 bytes are the raw public key
  const pubBytes = pubRaw.subarray(pubRaw.length - 32);
  const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });
  // Ed25519 PKCS8 DER: last 32 bytes are the raw private key (seed)
  const privBytes = privRaw.subarray(privRaw.length - 32);
  // Solana keypair format: 64 bytes = private seed (32) + public key (32)
  const keypairBytes = Buffer.concat([privBytes, pubBytes]);
  
  return {
    publicKey: base58Encode(pubBytes),
    privateKey: base58Encode(keypairBytes),
    privateKeyJson: JSON.stringify(Array.from(keypairBytes)),
  };
}

// ── Keccak-256 (minimal, for Ethereum address derivation) ────────────────────
// Based on the Keccak sponge construction (FIPS 202 / SHA-3 variant)

const KECCAK_ROUNDS = 24;
const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROTATIONS = [
  [0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]
];

function keccak256(inputBytes) {
  const rate = 136; // (1600 - 256*2) / 8 for keccak-256
  const capacity = 64;
  const state = new BigUint64Array(25);
  
  // Pad: input || 0x01 || 0x00...00 || 0x80
  const inputLen = inputBytes.length;
  const padLen = rate - (inputLen % rate);
  const padded = new Uint8Array(inputLen + padLen);
  padded.set(inputBytes);
  padded[inputLen] = 0x01;
  padded[padded.length - 1] |= 0x80;
  
  // Absorb
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) {
        lane |= BigInt(padded[offset + i * 8 + b]) << BigInt(b * 8);
      }
      state[i] ^= lane;
    }
    keccakF1600(state);
  }
  
  // Squeeze (only need 32 bytes)
  const hash = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const lane = state[i];
    for (let b = 0; b < 8; b++) {
      hash[i * 8 + b] = Number((lane >> BigInt(b * 8)) & 0xFFn);
    }
  }
  return hash;
}

function keccakF1600(state) {
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    // θ step
    const C = new BigUint64Array(5);
    for (let x = 0; x < 5; x++) {
      C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    const D = new BigUint64Array(5);
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rot64(C[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + y * 5] ^= D[x];
      }
    }
    // ρ and π steps
    const B = new BigUint64Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + ((2 * x + 3 * y) % 5) * 5] = rot64(state[x + y * 5], KECCAK_ROTATIONS[x][y]);
      }
    }
    // χ step
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + y * 5] = B[x + y * 5] ^ ((~B[(x + 1) % 5 + y * 5]) & B[(x + 2) % 5 + y * 5]);
      }
    }
    // ι step
    state[0] ^= KECCAK_RC[round];
  }
}

function rot64(x, n) {
  n = n % 64;
  if (n === 0) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & 0xFFFFFFFFFFFFFFFFn;
}

/** Generate a Base (Ethereum) wallet using secp256k1 + keccak256 */
function generateBaseWallet() {
  const privKeyBytes = randomBytes(32);
  const privKeyHex = '0x' + privKeyBytes.toString('hex');
  
  // Generate public key from private key using Node's ECDH
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(privKeyBytes);
  // Uncompressed public key (65 bytes: 04 + x + y), skip the 04 prefix
  const pubKeyUncompressed = ecdh.getPublicKey(null, 'uncompressed');
  const pubKeyBytes = pubKeyUncompressed.subarray(1); // 64 bytes (x + y)
  
  // Ethereum address = last 20 bytes of keccak256(pubKey)
  const hash = keccak256(pubKeyBytes);
  const addressBytes = hash.subarray(12); // last 20 bytes
  const address = '0x' + Buffer.from(addressBytes).toString('hex');
  
  // Checksum address (EIP-55)
  const addressLower = address.substring(2).toLowerCase();
  const addressHash = keccak256(Buffer.from(addressLower, 'ascii'));
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    const hashByte = addressHash[Math.floor(i / 2)];
    const nibble = (i % 2 === 0) ? (hashByte >> 4) : (hashByte & 0x0f);
    checksummed += nibble >= 8 ? addressLower[i].toUpperCase() : addressLower[i];
  }
  
  return {
    address: checksummed,
    privateKey: privKeyHex,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function init(flags) {
  console.log('\n⚡ AgentToll Setup\n');

  // Check if already configured
  if (existsSync(ENV_FILE)) {
    const env = readFileSync(ENV_FILE, 'utf-8');
    const match = env.match(/AGENTTOLL_API_KEY=(pk_live_\w+)/);
    if (match) {
      console.log(`  Already configured: ${match[1]}`);
      console.log(`  Dashboard: ${DASHBOARD_URL}\n`);
      const overwrite = flags.yes ? 'n' : await ask('  Generate a new key? (y/N)', 'n');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('  Nothing changed.\n');
        process.exit(0);
      }
    }
  }

  // ── Gather wallets (at least one required) ──

  const defaultName = detectProjectName();
  let name = flags.name || defaultName;
  let email = flags.email || null;
  let solanaWallet = flags.solana || process.env.SOLANA_WALLET || null;
  let baseWallet = flags.base || process.env.BASE_WALLET || null;
  const settings = {};

  // Legacy --wallet flag: auto-detect type
  if (flags.wallet && !solanaWallet && !baseWallet) {
    const type = looksLikeWallet(flags.wallet);
    if (type === 'base') baseWallet = flags.wallet;
    else solanaWallet = flags.wallet;
  }

  if (flags.yes) {
    // Fully non-interactive — need at least one wallet
    if (!solanaWallet && !baseWallet) {
      console.error('❌ --yes mode requires at least one wallet:');
      console.error('   --solana <addr>  or  --base <0x...>  or  --wallet <addr>');
      process.exit(1);
    }
  } else {
    // Interactive — ask for wallets, offer auto-generation
    if (!solanaWallet && !baseWallet) {
      console.log('  How would you like to receive payments?\n');
      const walletChoice = await choose('Solana wallet:', [
        { label: 'Paste my existing wallet', value: 'paste', desc: 'Phantom, Solflare, etc.' },
        { label: 'Generate a new wallet for me', value: 'generate', desc: 'creates keypair locally' },
        { label: 'Skip Solana (use Base only)', value: 'skip' },
      ], 0);

      if (walletChoice === 'generate') {
        console.log('\n  🔑 Generating Solana wallet...\n');
        const wallet = generateSolanaWallet();
        solanaWallet = wallet.publicKey;
        console.log(`  Public key:  ${wallet.publicKey}`);
        console.log(`  Private key: ${wallet.privateKey}`);
        console.log('');
        console.log('  ⚠️  SAVE YOUR PRIVATE KEY — it will NOT be shown again!');
        console.log('  Import it into Phantom or Solflare to access your funds.');
        console.log(`  Keypair JSON (for Solana CLI): ${wallet.privateKeyJson}`);
        console.log('');
        await ask('  Press Enter when you\'ve saved your private key', '');
      } else if (walletChoice === 'paste') {
        solanaWallet = await ask('  Solana wallet address');
      }
    }

    if (!baseWallet) {
      const baseChoice = await choose('Base (Ethereum L2) wallet:', [
        { label: 'Skip Base', value: 'skip', desc: 'Solana only' },
        { label: 'Paste my existing wallet', value: 'paste', desc: 'MetaMask, Coinbase, etc.' },
        { label: 'Generate a new wallet for me', value: 'generate', desc: 'creates keypair locally' },
      ], 0);

      if (baseChoice === 'generate') {
        console.log('\n  🔑 Generating Base wallet...\n');
        const wallet = generateBaseWallet();
        baseWallet = wallet.address;
        console.log(`  Address:     ${wallet.address}`);
        console.log(`  Private key: ${wallet.privateKey}`);
        console.log('');
        console.log('  ⚠️  SAVE YOUR PRIVATE KEY — it will NOT be shown again!');
        console.log('  Import it into MetaMask or Coinbase Wallet to access your funds.');
        console.log('');
        await ask('  Press Enter when you\'ve saved your private key', '');
      } else if (baseChoice === 'paste') {
        baseWallet = await ask('  Base wallet address (0x...)');
      }
    }

    if (!solanaWallet && !baseWallet) {
      console.error('❌ At least one wallet is required to receive payments');
      process.exit(1);
    }

    // Validate formats
    if (solanaWallet && !looksLikeWallet(solanaWallet)) {
      console.error('⚠️  Solana address looks unusual — submitting anyway');
    }
    if (baseWallet && looksLikeWallet(baseWallet) !== 'base') {
      console.error('⚠️  Base address should start with 0x — submitting anyway');
    }

    // Optionally ask name (pre-filled from package.json)
    name = await ask('Project name', defaultName);

    // Email is optional
    email = await ask('Email (optional, for receipts)', '');

    // ── Pricing & access config (all have defaults) ──

    settings.access_mode = await choose('Access mode:', [
      { label: 'Session', value: 'session', desc: 'token valid for this resource for the duration' },
      { label: 'Per-request', value: 'per-request', desc: 'token valid for 1 request only' },
      { label: 'Pass', value: 'pass', desc: 'full access to all endpoints for the duration' },
    ], 0);

    const priceLabel = settings.access_mode === 'per-request'
      ? 'Price per request in USDC'
      : `Price per ${settings.access_mode} in USDC`;
    const amount = await ask(priceLabel, '0.05');
    settings.default_amount = Math.max(parseFloat(amount) || 0.05, 0.05);

    if (settings.access_mode !== 'per-request') {
      settings.access_duration = await ask('Access duration', '1h');
    }

    const freeHumans = await ask('Let humans through for free? (y/N)', 'n');
    settings.free_for_humans = freeHumans.toLowerCase() === 'y';
  }

  const wallets = {};
  if (solanaWallet) wallets.solana = solanaWallet;
  if (baseWallet) wallets.base = baseWallet;

  // ── Register (same endpoint as web dashboard) ──

  console.log('\n📡 Registering...');

  try {
    const body = { name, wallet_address: solanaWallet || null, wallets };
    if (email) body.email = email;

    const res = await fetch(`${API_BASE}/api/publisher/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`\n❌ Registration failed: ${err.error || res.statusText}`);
      if (err.hint) console.error(`   ${err.hint}`);
      process.exit(1);
    }

    const data = await res.json();

    // Apply custom settings if any were configured
    if (Object.keys(settings).length > 0) {
      try {
        await fetch(`${API_BASE}/api/publisher/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Publisher-Key': data.api_key,
          },
          body: JSON.stringify(settings),
        });
      } catch {
        console.error('  ⚠️  Settings update failed — configure in dashboard');
      }
    }

    // Write to .env
    writeKeyToEnv(data.api_key, data.secret_key);

    // Success output
    console.log('\n✅ Done! Keys written to .env\n');
    console.log('  ┌──────────────────────────────────────────────────┐');
    console.log(`  │  API Key:     ${data.api_key}  │`);
    console.log(`  │  Secret Key:  ${data.secret_key}  │`);
    console.log('  └──────────────────────────────────────────────────┘');
    if (Object.keys(settings).length > 0) {
      console.log('');
      console.log('  Settings:');
      if (settings.default_amount) console.log(`    Price:       $${settings.default_amount} USDC`);
      if (settings.access_mode)    console.log(`    Mode:        ${settings.access_mode}`);
      if (settings.access_duration) console.log(`    Duration:    ${settings.access_duration}`);
      if (settings.free_for_humans) console.log(`    Humans:      free`);
    }
    console.log('');
    console.log('  Add one line to your server:');
    console.log('');
    console.log(`    import tollbooth from '@agenttoll/sdk'`);
    console.log(`    app.use(tollbooth(process.env.AGENTTOLL_API_KEY))`);
    console.log('');
    console.log(`  Dashboard:  ${DASHBOARD_URL}`);
    console.log(`  Docs:       ${DOCS_URL}`);
    console.log('');
    console.log('  Log into the dashboard with your API key above.');
    console.log('');

  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.cause?.code === 'ENOTFOUND') {
      console.error(`\n❌ Could not reach ${API_BASE}`);
      console.error('   Check your internet connection or set AGENTTOLL_API env var.');
    } else {
      console.error(`\n❌ ${err.message}`);
    }
    process.exit(1);
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

// Parse flags
const flags = {
  yes: args.includes('--yes') || args.includes('-y'),
  name: null,
  email: null,
  wallet: null,
  solana: null,
  base: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) flags.name = args[++i];
  if (args[i] === '--email' && args[i + 1]) flags.email = args[++i];
  if (args[i] === '--wallet' && args[i + 1]) flags.wallet = args[++i];
  if (args[i] === '--solana' && args[i + 1]) flags.solana = args[++i];
  if (args[i] === '--base' && args[i + 1]) flags.base = args[++i];
}

// Quick mode: `npx agenttoll init <WALLET>` — detect wallet as positional arg
if ((command === 'init' || command === 'setup') && args[1] && !args[1].startsWith('-')) {
  if (looksLikeWallet(args[1])) {
    flags.wallet = args[1];
  }
}

switch (command) {
  case 'init':
  case 'setup':
    init(flags);
    break;

  case 'version':
  case '--version':
  case '-v': {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
    console.log(pkg.version);
    break;
  }

  default:
    console.log(`
⚡ AgentToll CLI — Monetize your API for AI agents

Commands:
  init       Generate API key & write to .env

Usage:
  npx agenttoll init                                  Interactive setup
  npx agenttoll init <WALLET>                         Quick setup (auto-detect)
  npx agenttoll init --solana <ADDR> --base <0xADDR>  Both wallets
  npx agenttoll init -y --solana <ADDR>               Non-interactive

Options:
  --solana   Solana wallet address (receives USDC on Solana)
  --base     Base wallet address 0x (receives USDC on Base)
  --wallet   Auto-detect wallet type (shorthand for one wallet)
  --name     Project name (default: from package.json)
  --email    Contact email (optional)
  --yes, -y  Skip all prompts (uses defaults for pricing/access)

  At least one wallet (--solana or --base) is required.
  Pricing and access mode are configured interactively (or use defaults with -y).

Dashboard: ${DASHBOARD_URL}
Docs:      ${DOCS_URL}
`);
    if (command) {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
}
