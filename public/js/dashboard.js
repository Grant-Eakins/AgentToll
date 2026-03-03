// AgentToll — Publisher Dashboard

let currentApiKey = null;
let sseConnection = null;

// ==========================================
// Authentication
// ==========================================

function dashboardLogin(e) {
  e.preventDefault();
  const apiKey = document.getElementById('api-key-input').value.trim();
  const errorDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const btnText = document.getElementById('login-btn-text');

  if (!apiKey) {
    errorDiv.textContent = 'Please enter your API key.';
    errorDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btnText.textContent = 'Loading...';
  errorDiv.style.display = 'none';

  // Verify the API key by fetching publisher info
  fetch('/api/publisher/me', {
    headers: { 'X-Publisher-Key': apiKey }
  })
    .then(res => {
      if (!res.ok) throw new Error('Invalid API key');
      return res.json();
    })
    .then(data => {
      currentApiKey = apiKey;
      sessionStorage.setItem('agenttoll_api_key', apiKey);
      showDashboard(data);
    })
    .catch(err => {
      errorDiv.textContent = err.message || 'Could not verify API key';
      errorDiv.style.display = 'block';
    })
    .finally(() => {
      btn.disabled = false;
      btnText.textContent = 'Open Dashboard';
    });
}

function dashboardLogout() {
  currentApiKey = null;
  sessionStorage.removeItem('agenttoll_api_key');
  if (sseConnection) {
    sseConnection.close();
    sseConnection = null;
  }
  document.getElementById('dash-login').style.display = 'flex';
  document.getElementById('dash-content').style.display = 'none';
}

// Auto-login if key is stored
document.addEventListener('DOMContentLoaded', () => {
  const savedKey = sessionStorage.getItem('agenttoll_api_key');
  if (savedKey) {
    document.getElementById('api-key-input').value = savedKey;
    fetch('/api/publisher/me', {
      headers: { 'X-Publisher-Key': savedKey }
    })
      .then(res => {
        if (!res.ok) throw new Error('Invalid');
        return res.json();
      })
      .then(data => {
        currentApiKey = savedKey;
        showDashboard(data);
      })
      .catch(() => {
        sessionStorage.removeItem('agenttoll_api_key');
      });
  }
});

// ==========================================
// Dashboard Display
// ==========================================

function showDashboard(publisherData) {
  document.getElementById('dash-login').style.display = 'none';
  document.getElementById('dash-content').style.display = 'block';

  // Populate publisher info
  populatePublisherInfo(publisherData);

  // Fetch analytics
  refreshDashboard();

  // Connect SSE for live blocked agents
  connectBlockedSSE();
}

function populatePublisherInfo(data) {
  // Header
  document.getElementById('dash-project-name').textContent = data.name || 'Dashboard';
  document.getElementById('dash-api-key-badge').textContent = truncateKey(currentApiKey);

  // Account info
  document.getElementById('info-project').textContent = data.name || '—';
  document.getElementById('info-email').textContent = data.email || '—';
  document.getElementById('info-website').textContent = data.website || '—';
  document.getElementById('info-access-mode').textContent = data.settings?.access_mode || 'session';
  document.getElementById('info-default-amount').textContent = data.settings?.default_amount
    ? `${data.settings.default_amount} USDC`
    : '—';
  document.getElementById('info-free-humans').textContent = data.settings?.free_for_humans ? 'Yes' : 'No';
  document.getElementById('info-created').textContent = data.created_at
    ? new Date(data.created_at).toLocaleDateString()
    : '—';

  // Wallets
  const solanaAddr = data.wallets?.solana || data.wallet_address;
  const baseAddr = data.wallets?.base;

  if (solanaAddr) {
    document.getElementById('wallet-solana-addr').textContent = solanaAddr;
    const status = document.getElementById('wallet-solana-status');
    status.textContent = 'Connected';
    status.className = 'dash-wallet-status connected';
  } else {
    document.getElementById('wallet-solana-addr').textContent = 'Not configured';
    const status = document.getElementById('wallet-solana-status');
    status.textContent = 'Not set';
    status.className = 'dash-wallet-status not-set';
  }

  if (baseAddr) {
    document.getElementById('wallet-base-addr').textContent = baseAddr;
    const status = document.getElementById('wallet-base-status');
    status.textContent = 'Connected';
    status.className = 'dash-wallet-status connected';
  } else {
    document.getElementById('wallet-base-addr').textContent = 'Not configured';
    const status = document.getElementById('wallet-base-status');
    status.textContent = 'Not set';
    status.className = 'dash-wallet-status not-set';
  }

  // Overall wallet status badge
  const walletStatusBadge = document.getElementById('wallet-status');
  if (solanaAddr || baseAddr) {
    walletStatusBadge.textContent = 'Active';
    walletStatusBadge.className = 'dash-badge dash-badge-green';
  } else {
    walletStatusBadge.textContent = 'No wallets';
    walletStatusBadge.className = 'dash-badge dash-badge-yellow';
  }
}

// ==========================================
// Data Fetching
// ==========================================

async function refreshDashboard() {
  if (!currentApiKey) return;
  const timeframe = document.getElementById('dash-timeframe').value;

  try {
    const [analytics, revenue, agentStats, blocked] = await Promise.all([
      fetchAPI(`/api/analytics?timeframe=${timeframe}`),
      fetchAPI(`/api/analytics/revenue?timeframe=${timeframe}`),
      fetchAPI('/api/analytics/agents'),
      fetchAPI(`/api/analytics/agents-stopped?timeframe=${timeframe}`),
    ]);

    // Update stat cards
    document.getElementById('dash-agents-blocked').textContent =
      formatNumber(blocked.publisher_agents_stopped ?? blocked.total_agents_stopped ?? 0);
    document.getElementById('dash-total-revenue').textContent =
      formatUSD(analytics.total_revenue_usdc || 0);
    document.getElementById('dash-net-revenue').textContent =
      formatUSD(revenue.net_revenue_usdc || 0);
    document.getElementById('dash-unique-agents').textContent =
      formatNumber(analytics.unique_agents || 0);
    document.getElementById('dash-total-payments').textContent =
      formatNumber(analytics.total_payments || 0);
    document.getElementById('dash-total-accesses').textContent =
      formatNumber(analytics.total_accesses || 0);

    // Agent breakdown
    renderAgentBreakdown(analytics.agent_breakdown || {});

    // Top resources
    renderTopResources(analytics.top_resources || []);

    // Revenue
    renderRevenue(revenue);

    // Fetch blocked agents list
    fetchBlockedAgents(timeframe);
  } catch (err) {
    console.error('Dashboard fetch error:', err);
  }
}

async function fetchAPI(path) {
  const res = await fetch(path, {
    headers: { 'X-Publisher-Key': currentApiKey }
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function fetchBlockedAgents(timeframe) {
  try {
    const data = await fetchAPI(`/api/analytics/agents-stopped/details?timeframe=${timeframe}`);
    renderBlockedAgents(data.stops || []);
  } catch {
    // Endpoint might not exist yet, leave as-is
  }
}

// ==========================================
// Rendering
// ==========================================

function renderAgentBreakdown(breakdown) {
  const container = document.getElementById('agent-breakdown-list');
  const entries = Object.entries(breakdown);

  if (entries.length === 0) {
    container.innerHTML = '<div class="dash-empty-state">No agent data yet</div>';
    return;
  }

  const maxCount = Math.max(...entries.map(([, v]) => v));
  container.innerHTML = entries
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const pct = maxCount > 0 ? (count / maxCount * 100) : 0;
      const typeClass = ['agenttoll', 'openclaw', 'openai-agent', 'anthropic-agent', 'langchain', 'unknown']
        .includes(type) ? type : 'other';
      return `
        <div class="dash-breakdown-item">
          <span class="dash-breakdown-label">${escapeHtml(type)}</span>
          <div class="dash-breakdown-bar-bg">
            <div class="dash-breakdown-bar-fill type-${typeClass}" style="width: ${pct}%"></div>
          </div>
          <span class="dash-breakdown-count">${count}</span>
        </div>`;
    })
    .join('');
}

function renderTopResources(resources) {
  const container = document.getElementById('top-resources-list');

  if (resources.length === 0) {
    container.innerHTML = '<div class="dash-empty-state">No resource data yet</div>';
    return;
  }

  container.innerHTML = resources
    .map((r, i) => `
      <div class="dash-resource-item">
        <span class="dash-resource-rank">#${i + 1}</span>
        <span class="dash-resource-path">${escapeHtml(r.resource)}</span>
        <span class="dash-resource-count">${r.count}</span>
        <span class="dash-resource-label">hits</span>
      </div>`)
    .join('');
}

function renderRevenue(revenue) {
  const gross = revenue.gross_revenue_usdc || 0;
  const net = revenue.net_revenue_usdc || 0;
  const fee = revenue.platform_fee_usdc || 0;

  document.getElementById('revenue-publisher').textContent = formatUSD(net);
  document.getElementById('revenue-platform-fee').textContent = formatUSD(fee);

  // Revenue bar
  const barPct = gross > 0 ? (net / gross * 100) : 0;
  document.getElementById('revenue-bar-fill').style.width = `${barPct}%`;

  // Daily chart
  const dailyContainer = document.getElementById('revenue-daily');
  const daily = revenue.daily_breakdown || {};
  const days = Object.entries(daily);

  if (days.length === 0) {
    dailyContainer.innerHTML = '<div class="dash-empty-state">No daily revenue data</div>';
    return;
  }

  const maxDayValue = Math.max(...days.map(([, v]) => v), 0.001);
  dailyContainer.innerHTML = days
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, amount]) => {
      const heightPct = (amount / maxDayValue * 80) + 5;
      const shortDay = day.slice(5); // MM-DD
      return `
        <div class="dash-daily-bar-wrap" title="${day}: $${amount.toFixed(4)} USDC">
          <div class="dash-daily-bar" style="height: ${heightPct}%"></div>
          <span class="dash-daily-label">${shortDay}</span>
        </div>`;
    })
    .join('');
}

function renderBlockedAgents(stops) {
  const container = document.getElementById('blocked-agents-list');

  if (stops.length === 0) {
    container.innerHTML = '<div class="dash-empty-state">No blocked agents recorded</div>';
    return;
  }

  container.innerHTML = stops
    .slice(0, 20)
    .map(s => `
      <div class="dash-blocked-item">
        <span class="dash-blocked-dot"></span>
        <div class="dash-blocked-info">
          <span class="dash-blocked-agent">${escapeHtml(s.agent_type || s.agent_id || 'Unknown agent')}</span>
          <span class="dash-blocked-resource">${escapeHtml(s.resource || '/')}</span>
        </div>
        <span class="dash-blocked-time">${timeAgo(s.timestamp)}</span>
      </div>`)
    .join('');
}

// ==========================================
// Live SSE for Blocked Agents
// ==========================================

function connectBlockedSSE() {
  if (sseConnection) {
    sseConnection.close();
  }

  try {
    sseConnection = new EventSource('/api/analytics/agents-stopped/live');

    sseConnection.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'agent_stopped') {
        // Increment blocked counter
        const el = document.getElementById('dash-agents-blocked');
        const current = parseInt(el.textContent.replace(/,/g, '')) || 0;
        el.textContent = formatNumber(current + 1);
        el.style.color = '#f85149';
        setTimeout(() => { el.style.color = ''; }, 600);

        // Add to blocked list
        prependBlockedAgent(data);
      }
    };

    sseConnection.onerror = () => {
      sseConnection.close();
      setTimeout(connectBlockedSSE, 5000);
    };
  } catch (err) {
    console.log('SSE unavailable for dashboard');
  }
}

function prependBlockedAgent(data) {
  const container = document.getElementById('blocked-agents-list');
  // Remove empty state if present
  const empty = container.querySelector('.dash-empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'dash-blocked-item';
  item.innerHTML = `
    <span class="dash-blocked-dot"></span>
    <div class="dash-blocked-info">
      <span class="dash-blocked-agent">${escapeHtml(data.agent_type || 'Unknown agent')}</span>
      <span class="dash-blocked-resource">${escapeHtml(data.resource || '/')}</span>
    </div>
    <span class="dash-blocked-time">just now</span>
  `;
  container.prepend(item);

  // Limit to 20 items
  while (container.children.length > 20) {
    container.lastElementChild.remove();
  }
}

// ==========================================
// Helpers
// ==========================================

function formatUSD(amount) {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(2) + 'K';
  return '$' + amount.toFixed(4);
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function truncateKey(key) {
  if (!key) return '';
  return key.length > 20 ? key.slice(0, 12) + '...' + key.slice(-4) : key;
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Mobile menu toggle
function toggleMenu() {
  const navLinks = document.querySelector('.nav-links');
  navLinks.classList.toggle('active');
}

// Expose to global scope for onclick handlers
window.dashboardLogin = dashboardLogin;
window.dashboardLogout = dashboardLogout;
window.refreshDashboard = refreshDashboard;
window.toggleMenu = toggleMenu;
