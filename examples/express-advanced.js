/**
 * Example: Express app with advanced toll configuration
 */

import express from 'express';
import tollbooth from '@agenttoll/sdk';

const app = express();
app.use(express.json());

// ============================================
// OPTION 1: Toll only specific paths
// ============================================
app.use(tollbooth('pk_live_xxx', {
  paths: ['/api/premium/*', '/data/*'],
  amount: 0.01,
}));

// ============================================
// OPTION 2: Free for humans, toll for agents
// ============================================
app.use('/api/research', tollbooth.agentsOnly('pk_live_xxx', {
  amount: 0.05,
}));

// ============================================
// OPTION 3: Protect individual routes
// ============================================
app.get('/api/expensive', 
  tollbooth.protect('pk_live_xxx', { amount: 0.05 }),
  (req, res) => {
    res.json({ data: 'Very expensive data' });
  }
);

// ============================================
// OPTION 4: Custom logic based on payment
// ============================================
app.get('/api/smart', 
  tollbooth('pk_live_xxx', { amount: 0.01 }),
  (req, res) => {
    if (req.tollPaid) {
      // Paid user - give premium response
      res.json({ 
        quality: 'premium',
        data: { full: 'dataset', with: 'all', fields: true }
      });
    } else {
      // Free tier (if you allow it)
      res.json({ 
        quality: 'basic',
        data: { preview: 'only' }
      });
    }
  }
);

// ============================================
// OPTION 5: With webhook on payment
// ============================================
app.use('/api/tracked', tollbooth('pk_live_xxx', {
  amount: 0.05,
  onPayment: (paymentInfo) => {
    console.log(`Payment received: ${paymentInfo.amount} from ${paymentInfo.agent}`);
    // Log to your analytics, send notification, etc.
  },
}));

// Free routes (no middleware)
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/public', (req, res) => res.json({ data: 'Free public data' }));

app.listen(3000);
