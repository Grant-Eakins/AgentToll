import { Router } from 'express';
import { getAnalytics, getAgentStats, getRevenueStats, getPlatformStats, recordAgentStopped, getAgentStoppedCount, getAgentStopsData, addSSEClient, getSSEClientCount } from '../utils/analytics.js';

const router = Router();

/**
 * GET /api/analytics
 * Get analytics for a publisher
 */
router.get('/', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];
  
  if (!publisherKey) {
    return res.status(401).json({ error: 'Publisher key required' });
  }

  const timeframe = req.query.timeframe || '24h';
  const analytics = await getAnalytics(publisherKey, timeframe);

  res.json(analytics);
});

/**
 * GET /api/analytics/agents
 * Get AgentToll/agent-specific analytics
 */
router.get('/agents', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];
  
  if (!publisherKey) {
    return res.status(401).json({ error: 'Publisher key required' });
  }

  const stats = await getAgentStats(publisherKey);
  res.json(stats);
});

/**
 * GET /api/analytics/revenue
 * Get revenue breakdown
 */
router.get('/revenue', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];
  
  if (!publisherKey) {
    return res.status(401).json({ error: 'Publisher key required' });
  }

  const timeframe = req.query.timeframe || '7d';
  const revenue = await getRevenueStats(publisherKey, timeframe);

  res.json(revenue);
});

/**
 * GET /api/analytics/moltbook
 * AgentToll ecosystem traffic analytics
 * Tracks traffic from AgentToll agents that came via AgentToll social network
 */
router.get('/moltbook', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];
  
  if (!publisherKey) {
    return res.status(401).json({ error: 'Publisher key required' });
  }

  const timeframe = req.query.timeframe || '24h';
  const stats = await getAgentStats(publisherKey);

  // Extract AgentToll-specific data
  const agenttollData = stats.by_agent_type?.agenttoll || { count: 0, revenue: 0, unique_agents: 0 };
  const openclawData = stats.by_agent_type?.openclaw || { count: 0, revenue: 0, unique_agents: 0 };

  res.json({
    timeframe,
    agenttoll_traffic: {
      total_payments: agenttollData.count + openclawData.count,
      total_revenue: agenttollData.revenue + openclawData.revenue,
      unique_agents: agenttollData.unique_agents + openclawData.unique_agents,
    },
    by_framework: {
      agenttoll: agenttollData,
      openclaw: openclawData,
    },
    top_agenttoll_agents: stats.top_paying_agents?.filter(a => 
      a.type === 'agenttoll' || a.type === 'openclaw'
    ).slice(0, 10) || [],
    // Referral tracking (when implemented)
    referrals: {
      from_moltbook_posts: 0,
      from_agent_recommendations: 0,
      note: 'Referral tracking requires agents to include X-AgentToll-Ref header',
    },
    insights: {
      agenttoll_share_percent: stats.summary?.total_agent_payments > 0 
        ? ((agenttollData.count + openclawData.count) / stats.summary.total_agent_payments * 100).toFixed(1)
        : 0,
      avg_agenttoll_payment: agenttollData.count > 0 
        ? (agenttollData.revenue / agenttollData.count).toFixed(4)
        : 0,
    },
  });
});

/**
 * GET /api/analytics/platform
 * Public endpoint - platform-wide stats for the homepage
 * No authentication required
 */
router.get('/platform', async (req, res) => {
  const stats = await getPlatformStats();
  res.json(stats);
});

/**
 * POST /api/analytics/agent-stopped
 * Record when an agent is stopped (402 returned)
 * Called by the SDK when blocking an agent
 */
router.post('/agent-stopped', async (req, res) => {
  try {
    const { publisher, resource, agent_id, agent_type, user_agent, amount_required } = req.body;
    
    if (!publisher) {
      return res.status(400).json({ error: 'Publisher key required' });
    }
    
    await recordAgentStopped({
      publisher,
      resource,
      agent_id,
      agent_type,
      user_agent,
      amount_required,
      timestamp: Date.now(),
    });
    
    const totalStopped = await getAgentStoppedCount();
    
    res.json({ 
      success: true, 
      total_agents_stopped: totalStopped 
    });
  } catch (error) {
    console.error('Error recording agent stopped:', error);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

/**
 * GET /api/analytics/agents-stopped
 * Get total agents stopped count
 */
router.get('/agents-stopped', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];
  const timeframe = req.query.timeframe;
  
  // Get total platform-wide count
  const totalStopped = await getAgentStoppedCount();
  
  // If publisher key provided, also get their specific count
  let publisherStopped = null;
  if (publisherKey) {
    const since = timeframe ? Date.now() - parseTimeframe(timeframe) : null;
    const stops = await getAgentStopsData(publisherKey, since);
    publisherStopped = stops.length;
  }
  
  res.json({
    total_agents_stopped: totalStopped,
    publisher_agents_stopped: publisherStopped,
    updated_at: new Date().toISOString(),
  });
});

/**
 * GET /api/analytics/agents-stopped/live
 * Server-Sent Events endpoint for real-time agent stopped updates
 */
router.get('/agents-stopped/live', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Disable Nagle's algorithm for real-time delivery
  res.flushHeaders();
  
  // Add this client to SSE subscribers
  addSSEClient(res);
  
  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// Helper function for timeframe parsing
function parseTimeframe(tf) {
  const match = tf.match(/^(\d+)(h|d|w|m)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  
  const num = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    case 'w': return num * 7 * 24 * 60 * 60 * 1000;
    case 'm': return num * 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

export { router as analyticsRoutes };
