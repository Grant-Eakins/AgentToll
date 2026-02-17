/**
 * Example: Cloudflare Worker with toll gating
 * 
 * Deploy: wrangler deploy
 */

import { tollgate } from '@agenttoll/sdk/edge';

// ============================================
// ONE LINE - Wraps your entire worker
// ============================================
export default tollgate('pk_live_your_api_key', {
  amount: 0.005,
  freeForHumans: true, // Humans browse free, AgentToll pays
  
  handler: async (request) => {
    const url = new URL(request.url);
    
    if (url.pathname === '/api/data') {
      return Response.json({
        data: 'Premium data from Cloudflare Worker',
        timestamp: Date.now(),
      });
    }
    
    if (url.pathname === '/') {
      return new Response('Welcome to the toll-gated API', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
});
