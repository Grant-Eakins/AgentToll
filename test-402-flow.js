/**
 * Test script to verify 402 payment flow
 * Run: node test-402-flow.js
 */

import express from 'express';
import tollbooth from './sdk/tollbooth.js';

const app = express();
app.use(express.json());

// Use your actual API key from registration
const API_KEY = process.env.TEST_API_KEY || 'pk_live_98dd61f83d994bcda220f4a14279f970';

// Apply tollbooth to premium routes
app.use('/premium', tollbooth(API_KEY, {
  amount: 0.001,
  freeForHumans: true, // Only agents pay
}));

// Premium endpoint
app.get('/premium/data', (req, res) => {
  res.json({
    success: true,
    data: 'This is premium data!',
    paid: req.tollPaid || false,
    agent: req.tollAgent || false,
  });
});

// Free endpoint for comparison
app.get('/free', (req, res) => {
  res.json({ message: 'This is free!' });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🧪 Test server running on port ${PORT}`);
  console.log(`\n📋 Test the 402 flow:\n`);
  console.log(`1. Free endpoint (always works):`);
  console.log(`   curl http://localhost:${PORT}/free\n`);
  console.log(`2. Premium as human (should work - freeForHumans: true):`);
  console.log(`   curl http://localhost:${PORT}/premium/data\n`);
  console.log(`3. Premium as AI agent (should return 402):`);
  console.log(`   curl -H "User-Agent: Claude-Agent/1.0" http://localhost:${PORT}/premium/data\n`);
  console.log(`4. Premium as x402-capable agent (returns payment details):`);
  console.log(`   curl -H "User-Agent: OpenAI-Agent" -H "X-402-Capable: true" http://localhost:${PORT}/premium/data\n`);
});
