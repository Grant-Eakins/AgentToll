/**
 * Supabase client for AgentToll
 * Handles database connections for publishers, payments, and analytics
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('⚠️  Supabase not configured - using in-memory storage');
}

// Create Supabase client
export const supabase = SUPABASE_URL && SUPABASE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

/**
 * Check if Supabase is available
 */
export function isSupabaseConfigured() {
  return !!supabase;
}

// ==========================================
// PUBLISHER OPERATIONS
// ==========================================

/**
 * Create a new publisher
 */
export async function createPublisher(publisher) {
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('publishers')
    .insert({
      id: publisher.id,
      name: publisher.name,
      email: publisher.email,
      website: publisher.website,
      wallet_address: publisher.wallet_address,
      wallets: publisher.wallets,
      api_key: publisher.api_key,
      secret_key: publisher.secret_key,
      settings: publisher.settings,
      tier: publisher.tier,
      revenue: publisher.revenue,
      created_at: new Date(publisher.created_at).toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase createPublisher error:', error);
    return null;
  }
  return data;
}

/**
 * Get publisher by API key
 */
export async function getPublisherByKey(apiKey) {
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('publishers')
    .select('*')
    .eq('api_key', apiKey)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Supabase getPublisher error:', error);
  }
  return data;
}

/**
 * Update publisher
 */
export async function updatePublisher(apiKey, updates) {
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('publishers')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('api_key', apiKey)
    .select()
    .single();

  if (error) {
    console.error('Supabase updatePublisher error:', error);
    return null;
  }
  return data;
}

/**
 * Get all publishers (for platform stats)
 */
export async function getAllPublishers() {
  if (!supabase) return [];
  
  const { data, error } = await supabase
    .from('publishers')
    .select('id, name, created_at, tier');

  if (error) {
    console.error('Supabase getAllPublishers error:', error);
    return [];
  }
  return data || [];
}

/**
 * Count all publishers
 */
export async function countPublishers() {
  if (!supabase) return 0;
  
  const { count, error } = await supabase
    .from('publishers')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Supabase countPublishers error:', error);
    return 0;
  }
  return count || 0;
}

// ==========================================
// PAYMENT OPERATIONS
// ==========================================

/**
 * Record a payment
 */
export async function insertPayment(payment) {
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('payments')
    .insert({
      id: payment.id,
      publisher_key: payment.publisher,
      amount: payment.amount,
      currency: payment.currency || 'USDC',
      network: payment.network || 'solana',
      tx_signature: payment.tx_signature,
      agent_id: payment.agent_id,
      agent_type: payment.agent_type,
      resource: payment.resource,
      platform_fee: payment.platform_fee,
      publisher_receives: payment.publisher_receives,
      created_at: new Date(payment.timestamp).toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insertPayment error:', error);
    return null;
  }
  return data;
}

/**
 * Get payments for analytics
 */
export async function getPayments(publisherKey = null, since = null) {
  if (!supabase) return [];
  
  let query = supabase.from('payments').select('*');
  
  if (publisherKey) {
    query = query.eq('publisher_key', publisherKey);
  }
  if (since) {
    query = query.gte('created_at', new Date(since).toISOString());
  }
  
  query = query.order('created_at', { ascending: false });
  
  const { data, error } = await query;

  if (error) {
    console.error('Supabase getPayments error:', error);
    return [];
  }
  return data || [];
}

/**
 * Get platform-wide payment stats
 */
export async function getPaymentStats() {
  if (!supabase) return { total: 0, volume: 0, platformRevenue: 0, publisherEarnings: 0 };
  
  const { data, error } = await supabase
    .from('payments')
    .select('amount, platform_fee, publisher_receives');

  if (error) {
    console.error('Supabase getPaymentStats error:', error);
    return { total: 0, volume: 0, platformRevenue: 0, publisherEarnings: 0 };
  }

  const stats = (data || []).reduce((acc, p) => ({
    total: acc.total + 1,
    volume: acc.volume + (p.amount || 0),
    platformRevenue: acc.platformRevenue + (p.platform_fee || p.amount * 0.05),
    publisherEarnings: acc.publisherEarnings + (p.publisher_receives || p.amount * 0.95),
  }), { total: 0, volume: 0, platformRevenue: 0, publisherEarnings: 0 });

  return stats;
}

// ==========================================
// ACCESS LOG OPERATIONS
// ==========================================

/**
 * Record an access event
 */
export async function insertAccess(access) {
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('accesses')
    .insert({
      id: access.id,
      publisher_key: access.publisher,
      resource: access.resource,
      agent_id: access.agent,
      created_at: new Date(access.timestamp).toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insertAccess error:', error);
    return null;
  }
  return data;
}

/**
 * Get access logs
 */
export async function getAccesses(publisherKey = null, since = null) {
  if (!supabase) return [];
  
  let query = supabase.from('accesses').select('*');
  
  if (publisherKey) {
    query = query.eq('publisher_key', publisherKey);
  }
  if (since) {
    query = query.gte('created_at', new Date(since).toISOString());
  }
  
  const { data, error } = await query;

  if (error) {
    console.error('Supabase getAccesses error:', error);
    return [];
  }
  return data || [];
}

console.log(supabase ? '✅ Supabase connected' : '⚠️  Supabase not configured - using in-memory fallback');
