import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { 
  isSupabaseConfigured, 
  createPublisher as dbCreatePublisher, 
  getPublisherByKey as dbGetPublisher,
  updatePublisher as dbUpdatePublisher,
  countPublishers as dbCountPublishers 
} from '../utils/supabase.js';

const router = Router();

// In-memory fallback when Supabase is not configured
const publishersMemory = new Map();

// Helper to get publisher (from Supabase or memory)
export async function getPublisher(apiKey) {
  if (isSupabaseConfigured()) {
    return await dbGetPublisher(apiKey);
  }
  return publishersMemory.get(apiKey);
}

// Helper to set publisher (to Supabase or memory)
async function setPublisher(apiKey, publisher, isNew = false) {
  if (isSupabaseConfigured()) {
    if (isNew) {
      return await dbCreatePublisher(publisher);
    } else {
      return await dbUpdatePublisher(apiKey, publisher);
    }
  }
  publishersMemory.set(apiKey, publisher);
  return publisher;
}

// Export for backwards compatibility (platform stats)
export const publishers = publishersMemory;

// Export count function for analytics
export async function getPublisherCount() {
  if (isSupabaseConfigured()) {
    return await dbCountPublishers();
  }
  return publishersMemory.size;
}

/**
 * POST /api/publisher/register
 * Register a new publisher with multi-network wallet support
 */
router.post('/register', async (req, res) => {
  const { name, website, email, wallet_address, wallets } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email required' });
  }

  // Require at least one wallet
  if (!wallet_address && !wallets?.solana && !wallets?.base) {
    return res.status(400).json({ 
      error: 'At least one wallet address required',
      hint: 'Provide wallet_address (Solana) or wallets: { solana: "...", base: "0x..." }',
    });
  }

  const apiKey = `pk_live_${uuidv4().replace(/-/g, '')}`;
  const secretKey = `sk_live_${uuidv4().replace(/-/g, '')}`;

  const publisher = {
    id: uuidv4(),
    name,
    website,
    email,
    wallet_address, // Legacy: Solana wallet
    wallets: {
      solana: wallets?.solana || wallet_address,
      base: wallets?.base || null,
    },
    api_key: apiKey,
    secret_key: secretKey,
    created_at: Date.now(),
    settings: {
      default_amount: 0.005,
      free_for_humans: false,
      paths: ['*'],
      custom_fee_percent: null, // null = use platform default, or set 0-15 for custom
      // Access control mode
      access_mode: 'session', // 'per-request', 'session', 'pass'
      access_duration: '1h',  // Duration for session/pass modes
    },
    // Tier (affects fees)
    tier: 'standard', // 'standard' (5%), 'premium' (3%), 'enterprise' (custom)
    // Revenue tracking
    revenue: {
      total_gross: 0,
      total_net: 0,
      platform_fees_paid: 0,
      pending_settlement: 0,
    },
  };

  // Save to database or memory
  await setPublisher(apiKey, publisher, true);

  res.json({
    success: true,
    publisher_id: publisher.id,
    api_key: apiKey,
    secret_key: secretKey,
    integration: {
      one_liner: `app.use(require('@agenttoll/sdk')('${apiKey}'))`,
      edge: `import { tollgate } from '@agenttoll/sdk/edge'\nexport default tollgate('${apiKey}')`,
    },
    note: 'Save your secret key - it will not be shown again',
  });
});

/**
 * GET /api/publisher/me
 * Get current publisher info
 */
router.get('/me', async (req, res) => {
  const apiKey = req.headers['x-publisher-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const publisher = await getPublisher(apiKey);
  
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  // Don't return secret key
  const { secret_key, ...safe } = publisher;
  res.json(safe);
});

/**
 * PATCH /api/publisher/settings
 * Update publisher settings
 */
router.patch('/settings', async (req, res) => {
  const apiKey = req.headers['x-publisher-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const publisher = await getPublisher(apiKey);
  
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  const { default_amount, free_for_humans, paths, wallet_address, wallets, custom_fee_percent, access_mode, access_duration } = req.body;

  if (default_amount !== undefined) publisher.settings.default_amount = default_amount;
  if (free_for_humans !== undefined) publisher.settings.free_for_humans = free_for_humans;
  if (paths !== undefined) publisher.settings.paths = paths;
  
  // Access mode configuration
  if (access_mode !== undefined) {
    const validModes = ['per-request', 'session', 'pass'];
    if (!validModes.includes(access_mode)) {
      return res.status(400).json({ 
        error: 'Invalid access_mode',
        valid_modes: validModes,
        hint: 'per-request=1 use, session=time-limited to resource, pass=time-limited all access',
      });
    }
    publisher.settings.access_mode = access_mode;
  }
  
  if (access_duration !== undefined) {
    const validDurations = ['1m', '5m', '10m', '30m', '1h', '2h', '6h', '12h', '24h', '7d'];
    if (!validDurations.includes(access_duration) && typeof access_duration !== 'number') {
      return res.status(400).json({ 
        error: 'Invalid access_duration',
        valid_durations: validDurations,
        hint: 'Use format like "1h", "24h", or seconds as number',
      });
    }
    publisher.settings.access_duration = access_duration;
  }
  
  // Custom fee requires enterprise tier or platform approval
  if (custom_fee_percent !== undefined) {
    if (publisher.tier !== 'enterprise') {
      return res.status(403).json({ 
        error: 'Custom fees require enterprise tier',
        current_tier: publisher.tier,
        hint: 'Contact @0xgrante on X for enterprise pricing',
      });
    }
    if (custom_fee_percent < 0 || custom_fee_percent > 15) {
      return res.status(400).json({ error: 'Fee must be between 0-15%' });
    }
    publisher.settings.custom_fee_percent = custom_fee_percent;
  }
  if (wallet_address !== undefined) {
    publisher.wallet_address = wallet_address;
    publisher.wallets.solana = wallet_address;
  }
  if (wallets?.solana !== undefined) publisher.wallets.solana = wallets.solana;
  if (wallets?.base !== undefined) publisher.wallets.base = wallets.base;

  await setPublisher(apiKey, publisher);

  res.json({ success: true, settings: publisher.settings, wallets: publisher.wallets });
});

/**
 * GET /api/publisher/revenue
 * Get revenue breakdown and settlement status
 */
router.get('/revenue', async (req, res) => {
  const apiKey = req.headers['x-publisher-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const publisher = await getPublisher(apiKey);
  
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  const defaultFeePercent = parseFloat(process.env.PLATFORM_FEE_PERCENT || '5');
  
  // Calculate effective fee based on tier
  let effectiveFeePercent;
  if (publisher.settings.custom_fee_percent !== null && publisher.settings.custom_fee_percent !== undefined) {
    effectiveFeePercent = publisher.settings.custom_fee_percent;
  } else if (publisher.tier === 'premium') {
    effectiveFeePercent = 3;
  } else if (publisher.tier === 'enterprise') {
    effectiveFeePercent = 1;
  } else {
    effectiveFeePercent = defaultFeePercent;
  }

  res.json({
    publisher_id: publisher.id,
    publisher_name: publisher.name,
    tier: publisher.tier,
    wallets: publisher.wallets,
    fees: {
      effective_fee_percent: effectiveFeePercent,
      default_fee_percent: defaultFeePercent,
      custom_fee_percent: publisher.settings.custom_fee_percent,
      tier_discount: publisher.tier !== 'standard' ? `${publisher.tier} tier` : null,
    },
    revenue: publisher.revenue,
    payment_flow: 'direct',
    note: 'Payments are sent directly to your wallet. Platform fee is deducted at payment time.',
  });
});

/**
 * PATCH /api/publisher/wallets
 * Update wallet addresses for different networks
 */
router.patch('/wallets', async (req, res) => {
  const apiKey = req.headers['x-publisher-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const publisher = await getPublisher(apiKey);
  
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  const { solana, base } = req.body;

  if (solana) {
    publisher.wallets.solana = solana;
    publisher.wallet_address = solana; // Keep legacy field in sync
  }
  if (base) {
    // Validate Base address format
    if (!base.startsWith('0x') || base.length !== 42) {
      return res.status(400).json({ error: 'Invalid Base wallet address (must be 0x + 40 hex chars)' });
    }
    publisher.wallets.base = base;
  }

  await setPublisher(apiKey, publisher);

  res.json({
    success: true,
    wallets: publisher.wallets,
    note: 'Wallet addresses updated. New payments will go to these addresses.',
  });
});

/**
 * POST /api/publisher/webhook
 * Set up payment webhooks
 */
router.post('/webhook', async (req, res) => {
  const apiKey = req.headers['x-publisher-key'];
  const { webhook_url, events } = req.body;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const publisher = await getPublisher(apiKey);
  
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  publisher.webhook = {
    url: webhook_url,
    events: events || ['payment.completed', 'payment.failed'],
    secret: `whsec_${uuidv4().replace(/-/g, '')}`,
  };

  await setPublisher(apiKey, publisher);

  res.json({
    success: true,
    webhook_secret: publisher.webhook.secret,
    note: 'Use this secret to verify webhook signatures',
  });
});

export { router as publisherRoutes };
