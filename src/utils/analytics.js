/**
 * Analytics utilities for AgentToll
 * Uses Supabase for persistence with in-memory fallback
 */

// Import Supabase functions
import { 
  isSupabaseConfigured,
  insertPayment as dbInsertPayment,
  insertAccess as dbInsertAccess,
  getPayments as dbGetPayments,
  getAccesses as dbGetAccesses,
  getPaymentStats as dbGetPaymentStats,
  countPublishers as dbCountPublishers,
  insertAgentStop as dbInsertAgentStop,
  getAgentStopCount as dbGetAgentStopCount,
  getAgentStops as dbGetAgentStops
} from './supabase.js';

// Import publishers store for fallback
import { publishers, getPublisherCount } from '../routes/publisher.js';

// In-memory store fallback
const paymentsMemory = [];
const accessesMemory = [];
const agentStopsMemory = [];

// SSE clients for real-time updates
const sseClients = new Set();

/**
 * Record a payment event
 */
export async function recordPayment(data) {
  const payment = {
    ...data,
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  };
  
  if (isSupabaseConfigured()) {
    await dbInsertPayment(payment);
  } else {
    paymentsMemory.push(payment);
  }
  
  console.log(`[Analytics] Payment recorded: ${data.amount} USDC from ${data.agent_id || 'unknown'}`);
}

/**
 * Record an access event (token used)
 */
export async function recordAccess(data) {
  const access = {
    ...data,
    id: `access_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  };
  
  if (isSupabaseConfigured()) {
    await dbInsertAccess(access);
  } else {
    accessesMemory.push(access);
  }
}

/**
 * Record an agent stopped event (402 returned - agent blocked until payment)
 */
export async function recordAgentStopped(data) {
  const stopEvent = {
    ...data,
    id: `stop_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: data.timestamp || Date.now(),
  };
  
  if (isSupabaseConfigured()) {
    await dbInsertAgentStop(stopEvent);
  } else {
    agentStopsMemory.push(stopEvent);
  }
  
  // Broadcast to all SSE clients
  broadcastAgentStopped(stopEvent);
  
  console.log(`[Analytics] Agent stopped: ${data.agent_id || 'unknown'} at ${data.resource || 'unknown resource'}`);
}

/**
 * Get total agents stopped count (platform-wide)
 */
export async function getAgentStoppedCount() {
  if (isSupabaseConfigured()) {
    return await dbGetAgentStopCount();
  }
  return agentStopsMemory.length;
}

/**
 * Get agent stops data
 */
export async function getAgentStopsData(publisherKey = null, since = null) {
  if (isSupabaseConfigured()) {
    const data = await dbGetAgentStops(publisherKey, since);
    return data.map(s => ({
      ...s,
      publisher: s.publisher_key,
      timestamp: new Date(s.created_at).getTime(),
    }));
  }
  
  let stops = agentStopsMemory;
  if (publisherKey) {
    stops = stops.filter(s => s.publisher === publisherKey);
  }
  if (since) {
    stops = stops.filter(s => s.timestamp >= since);
  }
  return stops;
}

// ==========================================
// SSE (Server-Sent Events) for Real-Time Updates
// ==========================================

/**
 * Add an SSE client for real-time updates
 */
export function addSSEClient(res) {
  sseClients.add(res);
  
  // Send current count immediately
  getAgentStoppedCount().then(count => {
    res.write(`data: ${JSON.stringify({ type: 'init', agents_stopped: count })}\n\n`);
  });
  
  // Remove client on disconnect
  res.on('close', () => {
    sseClients.delete(res);
  });
}

/**
 * Broadcast agent stopped event to all SSE clients
 */
function broadcastAgentStopped(stopEvent) {
  const message = JSON.stringify({
    type: 'agent_stopped',
    timestamp: stopEvent.timestamp,
    publisher: stopEvent.publisher,
    agent_type: stopEvent.agent_type,
  });
  
  for (const client of sseClients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      // Client disconnected, remove from set
      sseClients.delete(client);
    }
  }
}

/**
 * Get current SSE client count
 */
export function getSSEClientCount() {
  return sseClients.size;
}

// Helper to get payments (from Supabase or memory)
async function getPaymentsData(publisherKey = null, since = null) {
  if (isSupabaseConfigured()) {
    const data = await dbGetPayments(publisherKey, since);
    // Convert Supabase format to expected format
    return data.map(p => ({
      ...p,
      publisher: p.publisher_key,
      timestamp: new Date(p.created_at).getTime(),
    }));
  }
  
  let payments = paymentsMemory;
  if (publisherKey) {
    payments = payments.filter(p => p.publisher === publisherKey);
  }
  if (since) {
    payments = payments.filter(p => p.timestamp >= since);
  }
  return payments;
}

// Helper to get accesses (from Supabase or memory)
async function getAccessesData(publisherKey = null, since = null) {
  if (isSupabaseConfigured()) {
    const data = await dbGetAccesses(publisherKey, since);
    return data.map(a => ({
      ...a,
      publisher: a.publisher_key,
      timestamp: new Date(a.created_at).getTime(),
    }));
  }
  
  let accesses = accessesMemory;
  if (publisherKey) {
    accesses = accesses.filter(a => a.publisher === publisherKey);
  }
  if (since) {
    accesses = accesses.filter(a => a.timestamp >= since);
  }
  return accesses;
}

/**
 * Get analytics for a publisher
 */
export async function getAnalytics(publisherKey, timeframe = '24h') {
  const now = Date.now();
  const timeMs = parseTimeframe(timeframe);
  const cutoff = now - timeMs;

  const relevantPayments = await getPaymentsData(publisherKey, cutoff);
  const relevantAccesses = await getAccessesData(publisherKey, cutoff);

  const totalRevenue = relevantPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const uniqueAgents = new Set(relevantPayments.map(p => p.agent_id)).size;

  // Agent type breakdown
  const agentTypes = {};
  relevantPayments.forEach(p => {
    const type = classifyAgent(p.agent_type);
    agentTypes[type] = (agentTypes[type] || 0) + 1;
  });

  return {
    timeframe,
    total_payments: relevantPayments.length,
    total_accesses: relevantAccesses.length,
    total_revenue_usdc: totalRevenue,
    unique_agents: uniqueAgents,
    agent_breakdown: agentTypes,
    top_resources: getTopResources(relevantPayments),
    hourly_payments: getHourlyBreakdown(relevantPayments, timeMs),
  };
}

/**
 * Get agent-specific stats (the AgentToll Analytics tab)
 */
export async function getAgentStats(publisherKey) {
  const relevantPayments = await getPaymentsData(publisherKey);

  // Classify all paying agents
  const agentStats = {};
  relevantPayments.forEach(p => {
    const type = classifyAgent(p.agent_type);
    if (!agentStats[type]) {
      agentStats[type] = { count: 0, revenue: 0, agents: new Set() };
    }
    agentStats[type].count++;
    agentStats[type].revenue += p.amount || 0;
    if (p.agent_id) agentStats[type].agents.add(p.agent_id);
  });

  // Convert Sets to counts
  Object.keys(agentStats).forEach(type => {
    agentStats[type].unique_agents = agentStats[type].agents.size;
    delete agentStats[type].agents;
  });

  return {
    summary: {
      total_agent_payments: relevantPayments.length,
      total_agent_revenue: relevantPayments.reduce((s, p) => s + (p.amount || 0), 0),
    },
    by_agent_type: agentStats,
    agenttoll_specific: {
      agenttoll_payments: relevantPayments.filter(p => /agenttoll/i.test(p.agent_type || '')).length,
      openclaw_payments: relevantPayments.filter(p => /openclaw|clawd/i.test(p.agent_type || '')).length,
    },
    top_paying_agents: getTopPayingAgents(relevantPayments),
  };
}

/**
 * Get revenue statistics
 */
export async function getRevenueStats(publisherKey, timeframe = '7d') {
  const timeMs = parseTimeframe(timeframe);
  const cutoff = Date.now() - timeMs;
  
  const relevantPayments = await getPaymentsData(publisherKey, cutoff);

  const dailyRevenue = {};
  relevantPayments.forEach(p => {
    const day = new Date(p.timestamp).toISOString().split('T')[0];
    dailyRevenue[day] = (dailyRevenue[day] || 0) + (p.amount || 0);
  });

  const totalRevenue = relevantPayments.reduce((s, p) => s + (p.amount || 0), 0);
  // Use actual recorded fees if available, otherwise estimate
  const totalPlatformFee = relevantPayments.reduce((s, p) => s + (p.platform_fee || p.amount * 0.05), 0);
  const totalPublisherReceived = relevantPayments.reduce((s, p) => s + (p.publisher_receives || p.amount * 0.95), 0);

  return {
    timeframe,
    gross_revenue_usdc: totalRevenue,
    platform_fee_usdc: totalPlatformFee,
    net_revenue_usdc: totalPublisherReceived,
    daily_breakdown: dailyRevenue,
    average_payment: relevantPayments.length > 0 ? totalRevenue / relevantPayments.length : 0,
    payment_count: relevantPayments.length,
  };
}

// Helper functions

function parseTimeframe(tf) {
  const match = tf.match(/^(\d+)(h|d|w|m)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h
  
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

function classifyAgent(userAgent) {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('agenttoll')) return 'agenttoll';
  if (ua.includes('openclaw') || ua.includes('clawd')) return 'openclaw';
  if (ua.includes('autogpt')) return 'autogpt';
  if (ua.includes('agentgpt')) return 'agentgpt';
  if (ua.includes('babyagi')) return 'babyagi';
  if (ua.includes('langchain')) return 'langchain';
  if (ua.includes('openai')) return 'openai-agent';
  if (ua.includes('anthropic')) return 'anthropic-agent';
  if (ua.includes('bot') || ua.includes('agent')) return 'other-agent';
  
  return 'unknown';
}

function getTopResources(payments) {
  const resources = {};
  payments.forEach(p => {
    if (p.resource) {
      resources[p.resource] = (resources[p.resource] || 0) + 1;
    }
  });
  
  return Object.entries(resources)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([resource, count]) => ({ resource, count }));
}

function getTopPayingAgents(payments) {
  const agents = {};
  payments.forEach(p => {
    const id = p.agent_id || 'unknown';
    if (!agents[id]) {
      agents[id] = { total: 0, count: 0, type: classifyAgent(p.agent_type) };
    }
    agents[id].total += p.amount || 0;
    agents[id].count++;
  });

  return Object.entries(agents)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([agent_id, stats]) => ({ agent_id, ...stats }));
}

function getHourlyBreakdown(payments, timeMs) {
  const hours = Math.min(Math.floor(timeMs / (60 * 60 * 1000)), 168); // max 1 week
  const now = Date.now();
  const breakdown = [];

  for (let i = 0; i < hours; i++) {
    const hourStart = now - (i + 1) * 60 * 60 * 1000;
    const hourEnd = now - i * 60 * 60 * 1000;
    const count = payments.filter(p => p.timestamp >= hourStart && p.timestamp < hourEnd).length;
    breakdown.unshift({
      hour: new Date(hourStart).toISOString(),
      payments: count,
    });
  }

  return breakdown.slice(-24); // Return last 24 hours max
}

/**
 * Get platform-wide public stats for homepage
 * In production: cache this and update every minute
 */
export async function getPlatformStats() {
  // Get publisher count from Supabase or memory
  const registeredPublishers = await getPublisherCount();
  
  // Get agents stopped count
  const agentsStopped = await getAgentStoppedCount();
  
  // Get payment stats
  let totalRevenue, platformRevenue, publisherEarnings, totalTransactions, uniqueAgents;
  
  if (isSupabaseConfigured()) {
    const stats = await dbGetPaymentStats();
    totalRevenue = stats.volume;
    platformRevenue = stats.platformRevenue;
    publisherEarnings = stats.publisherEarnings;
    totalTransactions = stats.total;
    
    // Get unique agents from all payments
    const allPayments = await dbGetPayments();
    uniqueAgents = new Set(allPayments.filter(p => p.agent_id).map(p => p.agent_id)).size;
  } else {
    // Fallback to in-memory
    const payments = paymentsMemory;
    totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    platformRevenue = payments.reduce((sum, p) => sum + (p.platform_fee || p.amount * 0.05), 0);
    publisherEarnings = payments.reduce((sum, p) => sum + (p.publisher_receives || p.amount * 0.95), 0);
    totalTransactions = payments.length;
    uniqueAgents = new Set(payments.filter(p => p.agent_id).map(p => p.agent_id)).size;
  }

  return {
    publishers: registeredPublishers,
    agents_stopped: agentsStopped,
    total_volume_usdc: totalRevenue,
    platform_revenue_usdc: platformRevenue,
    publisher_earnings_usdc: publisherEarnings,
    total_transactions: totalTransactions,
    unique_agents: uniqueAgents,
    updated_at: new Date().toISOString(),
  };
}
