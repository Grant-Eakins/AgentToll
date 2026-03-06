/**
 * AgentToll — MCP Payment Proxy
 * 
 * Acts as a payment gateway between MCP clients (AI agents) and MCP servers (data sources).
 * When an agent calls an MCP tool through this proxy, the proxy:
 *   1. Checks for a valid payment token
 *   2. If no token, returns a 402 with payment instructions
 *   3. If token is valid, forwards the request to the upstream MCP server
 *   4. Returns the upstream response to the agent
 * 
 * This enables any MCP server to be monetized without modification.
 * 
 * Usage:
 *   POST /api/mcp/proxy
 *   Headers: X-Publisher-Key, X-MCP-Upstream, Authorization (optional)
 *   Body: Standard MCP JSON-RPC request
 */

import { Router } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { getPublisher, setPublisher } from './publisher.js';

const router = Router();

const TOLL_API_BASE = process.env.TOLL_API_URL || 'https://www.agenttoll.xyz';

/**
 * POST /api/mcp/proxy
 * Proxy an MCP request through the payment gate
 * 
 * Headers:
 *   X-Publisher-Key: Publisher's API key (who owns this MCP server)
 *   X-MCP-Upstream: URL of the upstream MCP server (e.g., http://localhost:8080/mcp)
 *   Authorization: Bearer <payment_token> (optional, obtained after payment)
 * 
 * Body: Standard JSON-RPC 2.0 MCP request
 */
router.post('/proxy', async (req, res) => {
  try {
    const publisherKey = req.headers['x-publisher-key'];
    const upstreamUrl = req.headers['x-mcp-upstream'];
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!publisherKey) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'X-Publisher-Key header required',
        },
        id: req.body?.id || null,
      });
    }

    if (!upstreamUrl) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'X-MCP-Upstream header required. Provide the URL of the MCP server to proxy to.',
        },
        id: req.body?.id || null,
      });
    }

    // Look up publisher
    const publisher = await getPublisher(publisherKey);
    if (!publisher) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Publisher not found' },
        id: req.body?.id || null,
      });
    }

    const amount = publisher.settings?.default_amount || 0.05;
    const mcpMethod = req.body?.method || '';

    // Allow free methods (discovery/listing)
    const freeMethods = [
      'initialize',
      'notifications/initialized',
      'tools/list',
      'resources/list',
      'prompts/list',
      'ping',
    ];

    if (freeMethods.includes(mcpMethod)) {
      // Forward directly without payment
      return await forwardToUpstream(req, res, upstreamUrl);
    }

    // For paid methods, check token
    if (token) {
      try {
        const decoded = verifyAccessToken(token);
        if (decoded && decoded.publisher === publisherKey) {
          // Valid token — forward request
          return await forwardToUpstream(req, res, upstreamUrl);
        }
      } catch {
        // Invalid token, fall through to 402
      }
    }

    // No valid token — return 402 in MCP-compatible format
    const payUrl = `${TOLL_API_BASE}/pay?publisher=${publisherKey}&amount=${amount}&resource=mcp:${encodeURIComponent(mcpMethod)}`;

    return res.status(402).json({
      jsonrpc: '2.0',
      error: {
        code: -32402,
        message: 'Payment Required',
        data: {
          x402: {
            version: 1,
            amount: amount,
            currency: 'USDC',
            supported_networks: ['solana', 'base'],
            description: `Access to MCP method: ${mcpMethod}`,
          },
          payment: {
            amount: amount,
            currency: 'USDC',
            supported_networks: ['solana', 'base'],
            pay_url: payUrl,
            api_endpoint: `${TOLL_API_BASE}/api/pay`,
          },
          agent_instructions: `This MCP tool requires payment. Pay ${amount} USDC via the pay_url, then retry with the returned token in Authorization header.`,
          retry: {
            headers: {
              'Authorization': 'Bearer <token_from_payment>',
            },
          },
        },
      },
      id: req.body?.id || null,
    });

  } catch (error) {
    console.error('MCP proxy error:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal proxy error' },
      id: req.body?.id || null,
    });
  }
});

/**
 * POST /api/mcp/register
 * Register an MCP server to be paywalled through the proxy
 * Returns the proxy URL that agents should connect to
 */
router.post('/register', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];
  const { upstream_url, name, description, amount, free_methods } = req.body;

  if (!publisherKey) {
    return res.status(401).json({ error: 'Publisher key required' });
  }

  const publisher = await getPublisher(publisherKey);
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  if (!upstream_url) {
    return res.status(400).json({ error: 'upstream_url required' });
  }

  // Store MCP server config on publisher
  if (!publisher.mcp_servers) publisher.mcp_servers = [];

  const mcpId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const mcpConfig = {
    id: mcpId,
    name: name || 'MCP Server',
    description: description || '',
    upstream_url,
    amount: amount || publisher.settings?.default_amount || 0.05,
    free_methods: free_methods || ['initialize', 'tools/list', 'resources/list', 'prompts/list', 'ping'],
    created_at: Date.now(),
  };

  publisher.mcp_servers.push(mcpConfig);

  // Persist to Supabase / memory
  try {
    await setPublisher(publisherKey, { mcp_servers: publisher.mcp_servers });
  } catch (err) {
    console.error('Failed to persist MCP server config:', err);
  }

  const proxyUrl = `${TOLL_API_BASE}/api/mcp/proxy`;

  res.json({
    success: true,
    mcp_id: mcpId,
    proxy_url: proxyUrl,
    agent_config: {
      note: 'Agents should connect to this proxy URL instead of your direct MCP server',
      url: proxyUrl,
      headers: {
        'X-Publisher-Key': publisherKey,
        'X-MCP-Upstream': upstream_url,
        'Content-Type': 'application/json',
      },
    },
    example_mcp_config: {
      mcpServers: {
        [name || 'my-server']: {
          url: proxyUrl,
          headers: {
            'X-Publisher-Key': publisherKey,
            'X-MCP-Upstream': upstream_url,
          },
        },
      },
    },
    integration_steps: [
      '1. Add the proxy URL to your MCP client config (Claude Desktop, etc.)',
      '2. Set the X-Publisher-Key and X-MCP-Upstream headers',
      '3. Agents will see 402 responses for paid tools and can use pay_toll to pay',
      '4. After payment, agents retry with Authorization: Bearer <token>',
    ],
  });
});

/**
 * GET /api/mcp/servers
 * List registered MCP servers for a publisher
 */
router.get('/servers', async (req, res) => {
  const publisherKey = req.headers['x-publisher-key'];

  if (!publisherKey) {
    return res.status(401).json({ error: 'Publisher key required' });
  }

  const publisher = await getPublisher(publisherKey);
  if (!publisher) {
    return res.status(404).json({ error: 'Publisher not found' });
  }

  res.json({
    servers: publisher.mcp_servers || [],
    proxy_url: `${TOLL_API_BASE}/api/mcp/proxy`,
  });
});

/**
 * POST /api/mcp/wrap
 * One-shot: wrap a single MCP tool call with payment verification
 * For use when the MCP server itself wants to check payment inline
 */
router.post('/wrap', async (req, res) => {
  try {
    const publisherKey = req.headers['x-publisher-key'];
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { tool_name, arguments: toolArgs } = req.body;

    if (!publisherKey) {
      return res.status(401).json({ error: 'Publisher key required' });
    }

    const publisher = await getPublisher(publisherKey);
    if (!publisher) {
      return res.status(404).json({ error: 'Publisher not found' });
    }

    const amount = publisher.settings?.default_amount || 0.05;

    // Verify token
    if (!token) {
      const payUrl = `${TOLL_API_BASE}/pay?publisher=${publisherKey}&amount=${amount}&resource=mcp:${encodeURIComponent(tool_name || 'unknown')}`;
      return res.status(402).json({
        error: 'payment_required',
        message: `Tool "${tool_name}" requires payment of ${amount} USDC`,
        x402: {
          version: 1,
          amount,
          currency: 'USDC',
          supported_networks: ['solana', 'base'],
        },
        payment: {
          pay_url: payUrl,
          api_endpoint: `${TOLL_API_BASE}/api/pay`,
        },
      });
    }

    try {
      const decoded = verifyAccessToken(token);
      if (decoded && decoded.publisher === publisherKey) {
        return res.json({
          authorized: true,
          tool_name,
          message: 'Payment verified. Proceed with tool execution.',
        });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid or expired payment token' });
    }

    return res.status(401).json({ error: 'Invalid payment token' });
  } catch (error) {
    console.error('MCP wrap error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Forward request to upstream MCP server
 */
async function forwardToUpstream(req, res, upstreamUrl) {
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward relevant headers
        ...(req.headers['x-agent-type'] ? { 'X-Agent-Type': req.headers['x-agent-type'] } : {}),
        ...(req.headers['x-agenttoll-id'] ? { 'X-AgentToll-Id': req.headers['x-agenttoll-id'] } : {}),
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstreamResponse.json();
    res.status(upstreamResponse.status).json(data);
  } catch (error) {
    console.error('MCP upstream error:', error);
    res.status(502).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Failed to reach upstream MCP server',
        data: { upstream_url: upstreamUrl },
      },
      id: req.body?.id || null,
    });
  }
}

export { router as mcpProxyRoutes };
