/**
 * Example: Express app with one-line toll integration
 * 
 * This shows how easy it is to add AgentToll to any Express app
 */

import express from 'express';
import tollbooth from '@agenttoll/sdk'; // npm install @agenttoll/sdk

const app = express();

// ============================================
// ONE LINE INTEGRATION - That's it!
// ============================================
app.use(tollbooth('pk_live_your_api_key_here'));

// Your existing routes work as normal
app.get('/', (req, res) => {
  res.json({ message: 'Welcome! This content is toll-gated.' });
});

app.get('/api/data', (req, res) => {
  res.json({ 
    data: 'Premium data that agents pay to access',
    paid: req.tollPaid || false,
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
