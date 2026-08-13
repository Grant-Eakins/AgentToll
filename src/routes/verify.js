import { Router } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { recordAccess } from '../utils/analytics.js';

const router = Router();

// Track used per-request token JTIs; TTL matches the 5-min token expiry
const usedPerRequestTokens = new Set();

/**
 * POST /api/verify
 * Verify an access token (called by publisher middleware)
 * 
 * Body:
 *   - token: JWT access token
 * 
 * Headers:
 *   - X-Publisher-Key: Publisher API key
 */
router.post('/', async (req, res) => {
  try {
    const { token } = req.body;
    const publisherKey = req.headers['x-publisher-key'];

    if (!token) {
      return res.status(400).json({
        valid: false,
        error: 'Token required',
      });
    }

    // Verify the token
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({
        valid: false,
        error: 'Invalid or expired token',
        agent_hint: 'Token expired or invalid. Make a new payment.',
      });
    }

    // Enforce single-use for per-request tokens
    if (decoded.mode === 'per-request') {
      if (usedPerRequestTokens.has(decoded.jti)) {
        return res.status(401).json({
          valid: false,
          error: 'Token already used',
          agent_hint: 'Per-request tokens are single-use. Make a new payment.',
        });
      }
      usedPerRequestTokens.add(decoded.jti);
    }

    // Optionally check publisher match
    if (publisherKey && decoded.publisher !== publisherKey) {
      return res.status(401).json({
        valid: false,
        error: 'Token not valid for this publisher',
      });
    }

    // Record access for analytics
    await recordAccess({
      publisher: decoded.publisher,
      resource: decoded.resource,
      agent: decoded.agent,
      timestamp: Date.now(),
    });

    res.json({
      valid: true,
      publisher: decoded.publisher,
      resource: decoded.resource,
      expires_at: decoded.exp * 1000,
      remaining_seconds: Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)),
    });

  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({
      valid: false,
      error: 'Verification failed',
    });
  }
});

/**
 * GET /api/verify/check
 * Quick token validity check (lighter weight)
 */
router.get('/check', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;

  if (!token) {
    return res.json({ valid: false });
  }

  const decoded = verifyAccessToken(token);
  res.json({ 
    valid: !!decoded,
    expires_at: decoded ? decoded.exp * 1000 : null,
  });
});

export { router as verifyRoutes };
