import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { paymentRoutes } from './routes/payment.js';
import { verifyRoutes } from './routes/verify.js';
import { analyticsRoutes } from './routes/analytics.js';
import { publisherRoutes } from './routes/publisher.js';
import { docsRoutes } from './routes/docs.js';

dotenv.config();

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

// Request logging for analytics
app.use((req, res, next) => {
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'agenttoll', version: '1.0.0' });
});

// Platform configuration status (admin endpoint)
app.get('/api/config/status', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  
  // Simple admin check (in production: use proper auth)
  if (adminKey !== process.env.ADMIN_KEY && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Admin key required' });
  }

  const solanaConfigured = !!process.env.PLATFORM_SOLANA_WALLET;
  const baseConfigured = !!process.env.PLATFORM_BASE_WALLET;
  const atLeastOneWallet = solanaConfigured || baseConfigured;

  const config = {
    platform_wallets: {
      solana: {
        configured: solanaConfigured,
        wallet: process.env.PLATFORM_SOLANA_WALLET 
          ? `${process.env.PLATFORM_SOLANA_WALLET.slice(0, 8)}...${process.env.PLATFORM_SOLANA_WALLET.slice(-4)}`
          : 'NOT SET (Solana payments disabled)',
      },
      base: {
        configured: baseConfigured,
        wallet: process.env.PLATFORM_BASE_WALLET
          ? `${process.env.PLATFORM_BASE_WALLET.slice(0, 8)}...${process.env.PLATFORM_BASE_WALLET.slice(-4)}`
          : 'NOT SET (Base payments disabled)',
      },
    },
    supported_networks: [
      ...(solanaConfigured ? ['solana'] : []),
      ...(baseConfigured ? ['base'] : []),
    ],
    fee_percent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '5'),
    rpcs: {
      solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com (default)',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org (default)',
    },
    jwt_configured: !!process.env.JWT_SECRET && process.env.JWT_SECRET !== 'dev-secret-change-in-production',
    token_expiry_seconds: parseInt(process.env.TOKEN_EXPIRY || '3600'),
    warnings: [],
  };

  // Add warnings for missing config
  if (!atLeastOneWallet) {
    config.warnings.push('CRITICAL: No platform wallet configured - set PLATFORM_SOLANA_WALLET and/or PLATFORM_BASE_WALLET');
  }
  if (!config.jwt_configured) {
    config.warnings.push('JWT_SECRET not set or using default - tokens are insecure');
  }

  res.json(config);
});

// API Routes
app.use('/api/pay', paymentRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/publisher', publisherRoutes);
app.use('/api/docs', docsRoutes);

// Serve static HTML pages
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/docs.html'));
});

// Human-readable payment page (dynamic - needs query params)
app.get('/pay', (req, res) => {
  const { publisher, amount, resource } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AgentToll - Payment</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
        .card { border: 1px solid #e0e0e0; border-radius: 12px; padding: 24px; }
        .amount { font-size: 2em; font-weight: bold; color: #2563eb; }
        .btn { background: #2563eb; color: white; padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
        .btn:hover { background: #1d4ed8; }
        code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
        .agent-box { background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🚧 Toll Payment Required</h1>
        <p>Access to this resource requires a micropayment:</p>
        <p class="amount">${amount || '0.05'} USDC</p>
        <p>Resource: <code>${resource || 'N/A'}</code></p>
        <button class="btn" onclick="initPayment()">Pay with Solana</button>
        
        <div class="agent-box">
          <strong>🤖 AI Agent?</strong>
          <p>POST to <code>/api/pay</code> with your signed transaction:</p>
          <pre>{
  "publisher": "${publisher}",
  "amount": ${amount || 0.05},
  "resource": "${resource}",
  "tx_signature": "your_solana_tx_sig"
}</pre>
        </div>
      </div>
      <script>
        async function initPayment() {
          // Solana wallet connection logic
          alert('Connect your Solana wallet to pay');
        }
      </script>
    </body>
    </html>
  `);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚧 AgentToll running on port ${PORT}`);
  console.log(`   Homepage:         http://localhost:${PORT}`);
  console.log(`   Docs:             http://localhost:${PORT}/docs`);
  console.log(`   API Reference:    http://localhost:${PORT}/api/docs`);
  console.log(`   Payment endpoint: http://localhost:${PORT}/api/pay`);
});

export default app;
