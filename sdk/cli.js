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
    // Interactive — ask for both, require at least one
    if (!solanaWallet) {
      solanaWallet = await ask('Solana wallet (or press Enter to skip)', '');
    }
    if (!baseWallet) {
      baseWallet = await ask('Base wallet 0x (or press Enter to skip)', '');
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

    // Write to .env
    writeKeyToEnv(data.api_key, data.secret_key);

    // Success output
    console.log('\n✅ Done! Keys written to .env\n');
    console.log('  ┌──────────────────────────────────────────────────┐');
    console.log(`  │  API Key:     ${data.api_key}  │`);
    console.log(`  │  Secret Key:  ${data.secret_key}  │`);
    console.log('  └──────────────────────────────────────────────────┘');
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
  --yes, -y  Skip all prompts

  At least one wallet (--solana or --base) is required.

Dashboard: ${DASHBOARD_URL}
Docs:      ${DOCS_URL}
`);
    if (command) {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
}
