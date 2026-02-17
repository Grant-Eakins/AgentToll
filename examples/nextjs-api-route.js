/**
 * Example: Next.js API route with toll middleware
 * 
 * File: app/api/premium/route.js (App Router)
 */

import { tollMiddleware } from '@agenttoll/sdk/edge';

const toll = tollMiddleware('pk_live_xxx', {
  amount: 0.005,
  freeForHumans: true,
});

export async function GET(request) {
  // Check toll first
  const tollResponse = await toll(request, () => null);
  if (tollResponse) return tollResponse; // 402 response

  // Paid or human - serve content
  return Response.json({
    premium: true,
    data: {
      message: 'This is premium content',
      timestamp: new Date().toISOString(),
    }
  });
}

export async function POST(request) {
  const tollResponse = await toll(request, () => null);
  if (tollResponse) return tollResponse;

  const body = await request.json();
  
  return Response.json({
    received: body,
    processed: true,
  });
}
