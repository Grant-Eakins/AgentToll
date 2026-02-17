// AgentToll - Frontend JavaScript

// Mobile menu toggle
function toggleMenu() {
  const navLinks = document.querySelector('.nav-links');
  navLinks.classList.toggle('active');
}

// Format currency
function formatUSD(amount) {
  if (amount >= 1000000) {
    return '$' + (amount / 1000000).toFixed(2) + 'M';
  } else if (amount >= 1000) {
    return '$' + (amount / 1000).toFixed(2) + 'K';
  }
  return '$' + amount.toFixed(2);
}

// Fetch and display live platform stats
async function fetchPlatformStats() {
  try {
    const res = await fetch('/api/analytics/platform');
    const data = await res.json();
    
    document.getElementById('stat-publishers').textContent = data.publishers || 0;
    document.getElementById('stat-volume').textContent = formatUSD(data.total_volume_usdc || 0);
    document.getElementById('stat-publisher-earnings').textContent = formatUSD(data.publisher_earnings_usdc || 0);
    document.getElementById('stat-platform-revenue').textContent = formatUSD(data.platform_revenue_usdc || 0);
  } catch (err) {
    console.log('Stats unavailable');
  }
}

// Demo simulation
let demoState = 'initial';
let demoRunning = false;

function runDemo() {
  if (demoRunning) return;
  
  const responsePanel = document.getElementById('demo-response');
  const btn = document.querySelector('.demo-btn');
  const btnText = document.getElementById('demo-btn-text');
  
  if (demoState === 'initial') {
    demoRunning = true;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    
    // Step 1: Show payment detection
    responsePanel.style.opacity = '0.5';
    setTimeout(() => {
      responsePanel.innerHTML = `
        <div class="demo-header">
          <span class="demo-label">Response</span>
          <span class="demo-status status-pending">●●●</span>
        </div>
        <pre class="demo-code"><code>Verifying payment on Solana...

<span class="demo-check">✓</span> USDC transfer detected
<span class="demo-pending">○</span> Confirming transaction...
<span class="demo-pending">○</span> Issuing access token...</code></pre>
      `;
      responsePanel.style.opacity = '1';
      btnText.textContent = 'Verifying...';
    }, 100);
    
    // Step 2: Transaction confirmed
    setTimeout(() => {
      responsePanel.innerHTML = `
        <div class="demo-header">
          <span class="demo-label">Response</span>
          <span class="demo-status status-pending">●●●</span>
        </div>
        <pre class="demo-code"><code>Verifying payment on Solana...

<span class="demo-check">✓</span> USDC transfer detected
<span class="demo-check">✓</span> Tx: 5K7x...9vN2 confirmed
<span class="demo-pending">○</span> Issuing access token...</code></pre>
      `;
      btnText.textContent = 'Confirming...';
    }, 800);
    
    // Step 3: Token issued
    setTimeout(() => {
      responsePanel.innerHTML = `
        <div class="demo-header">
          <span class="demo-label">Response</span>
          <span class="demo-status status-pending">●●●</span>
        </div>
        <pre class="demo-code"><code>Verifying payment on Solana...

<span class="demo-check">✓</span> USDC transfer detected
<span class="demo-check">✓</span> Tx: 5K7x...9vN2 confirmed
<span class="demo-check">✓</span> Access token issued</code></pre>
      `;
      btnText.textContent = 'Token issued!';
    }, 1400);
    
    // Step 4: Show success response
    setTimeout(() => {
      responsePanel.innerHTML = `
        <div class="demo-header">
          <span class="demo-label">Response</span>
          <span class="demo-status status-200">200 OK</span>
        </div>
        <pre class="demo-code"><code>{
  "city": "Tokyo",
  "temperature": 18,
  "condition": "Partly Cloudy",
  "humidity": 65,
  "wind_speed": 12,
  "_toll": {
    "paid": 0.001,
    "currency": "USDC",
    "tx": "5K7x...9vN2"
  }
}</code></pre>
      `;
      demoState = 'paid';
      demoRunning = false;
      btn.disabled = false;
      btn.style.opacity = '1';
      btnText.textContent = '↺ Reset demo';
    }, 2000);
    
  } else {
    // Reset to initial 402 state
    responsePanel.style.opacity = '0.5';
    setTimeout(() => {
      responsePanel.innerHTML = `
        <div class="demo-header">
          <span class="demo-label">Response</span>
          <span class="demo-status status-402">402</span>
        </div>
        <pre class="demo-code"><code>{
  "error": "payment_required",
  "payment": {
    "amount": "0.001",
    "currency": "USDC",
    "network": "solana",
    "recipient": "8xK7...9vN2"
  }
}</code></pre>
      `;
      responsePanel.style.opacity = '1';
      demoState = 'initial';
      btnText.textContent = '▶ Simulate payment';
    }, 150);
  }
}

// Smooth scroll for anchor links
document.addEventListener('DOMContentLoaded', () => {
  // Fetch live stats on load and every 30 seconds
  fetchPlatformStats();
  setInterval(fetchPlatformStats, 30000);
  
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        const navHeight = 64;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
      document.querySelector('.nav-links')?.classList.remove('active');
    });
  });
});

// Console
console.log('%c⚡ AgentToll', 'font-size: 20px; font-weight: bold; color: #111827');
console.log('%cAPI monetization for AI agents', 'font-size: 12px; color: #6b7280;');
console.log('%cDocs: /docs | API Reference: /api/docs', 'font-size: 11px; color: #9ca3af;');
