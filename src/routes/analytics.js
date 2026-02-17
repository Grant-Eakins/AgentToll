import { Router } from 'express';
import { getAnalytics, getAgentStats, getRevenueStats, getPlatformStats } from '../utils/analytics.js';

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

export { router as analyticsRoutes };
