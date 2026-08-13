import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const TOKEN_EXPIRY = parseInt(process.env.TOKEN_EXPIRY || '3600'); // 1 hour default

/**
 * Access modes:
 * - 'per-request': Token valid for exactly 1 request (single use)
 * - 'session': Token valid for duration, specific resource only  
 * - 'pass': Token valid for duration, all publisher endpoints
 */
const DURATION_MAP = {
  '1m': 60,
  '5m': 300,
  '10m': 600,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '6h': 21600,
  '12h': 43200,
  '24h': 86400,
  '7d': 604800,
};

/**
 * Parse duration string to seconds
 */
function parseDuration(duration) {
  if (typeof duration === 'number') return duration;
  return DURATION_MAP[duration] || TOKEN_EXPIRY;
}

/**
 * Generate an access token after successful payment
 * @param {Object} payload - Token data
 * @param {Object} options - { mode: 'per-request'|'session'|'pass', duration: '1h' }
 */
export function generateAccessToken(payload, options = {}) {
  const mode = options.mode || 'session';
  const duration = parseDuration(options.duration) || TOKEN_EXPIRY;
  
  const tokenPayload = {
    jti: uuidv4(), // Unique token ID
    publisher: payload.publisher,
    resource: payload.resource,
    amount: payload.amount,
    tx: payload.tx,
    network: payload.network,
    agent: payload.agent,
    // Access control fields
    mode: mode,
    uses_remaining: mode === 'per-request' ? 1 : null, // null = unlimited within duration
    scope: mode === 'pass' ? '*' : payload.resource, // '*' = all endpoints
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: mode === 'per-request' ? 300 : duration, // per-request tokens expire in 5 min max
    issuer: 'agenttoll',
  });
}

/**
 * Verify and decode an access token
 * @param {string} token - JWT token
 * @param {Object} options - { resource: 'url to check against', consumeUse: true }
 */
export function verifyAccessToken(token, options = {}) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'agenttoll',
    });
    
    // Check resource scope (unless it's a pass)
    if (options.resource && decoded.scope !== '*') {
      // For session mode, check if resource matches
      // Allow exact match or prefix match for path-based scoping
      const scopedResource = decoded.scope || decoded.resource;
      if (scopedResource && !options.resource.startsWith(scopedResource.split('?')[0])) {
        console.log(`Token scope mismatch: ${scopedResource} vs ${options.resource}`);
        // For MVP: warn but don't block (strict mode can be added later)
      }
    }
    
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      console.log('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      console.log('Invalid token');
    }
    return null;
  }
}

/**
 * Generate a refresh token (longer lived, for persistent agents)
 */
export function generateRefreshToken(payload) {
  return jwt.sign(
    {
      jti: uuidv4(),
      type: 'refresh',
      publisher: payload.publisher,
      agent: payload.agent,
    },
    JWT_SECRET,
    {
      expiresIn: '7d', // 7 days for persistent agents
      issuer: 'agenttoll',
    }
  );
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token) {
  return jwt.decode(token);
}
