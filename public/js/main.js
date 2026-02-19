// AgentToll - Frontend JavaScript

// Mobile menu toggle
function toggleMenu() {
  const navLinks = document.querySelector('.nav-links');
  navLinks.classList.toggle('active');
}

// ==========================================
// Scramble Typewriter Effect for Hero Title
// ==========================================
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*';

function scrambleTypewriter(element) {
  const text = element.dataset.text;
  const highlightRange = element.dataset.highlight.split(',').map(Number); // [start, end]
  const lines = text.split('|');
  
  let currentIndex = 0;
  let scrambleCount = 0;
  const maxScrambles = 3; // How many random chars before revealing
  const typeSpeed = 50; // ms per character
  const scrambleSpeed = 30; // ms per scramble iteration
  
  // Flatten all characters with metadata
  const allChars = [];
  let charIndex = 0;
  
  lines.forEach((line, lineIndex) => {
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const isHighlight = charIndex >= highlightRange[0] && charIndex < highlightRange[1];
      allChars.push({
        char: char,
        isSpace: char === ' ',
        isHighlight: isHighlight,
        lineBreakAfter: false
      });
      charIndex++;
    }
    if (lineIndex < lines.length - 1) {
      // Mark the last char of this line needs a line break after
      if (allChars.length > 0) {
        allChars[allChars.length - 1].lineBreakAfter = true;
      }
    }
  });
  
  // Build initial HTML structure
  function buildHTML() {
    let html = '';
    
    allChars.forEach((charData, idx) => {
      const highlightClass = charData.isHighlight ? ' highlight-char' : '';
      // Use data attribute to store the character, handle space specially
      const displayChar = charData.isSpace ? '&nbsp;' : '';
      html += `<span class="char${highlightClass}" data-idx="${idx}">${displayChar}</span>`;
      if (charData.lineBreakAfter) {
        html += '<br>';
      }
    });
    
    html += '<span class="cursor"></span>';
    return html;
  }
  
  element.innerHTML = buildHTML();
  
  const charElements = element.querySelectorAll('.char');
  const cursor = element.querySelector('.cursor');
  const totalChars = allChars.length;
  
  // Position cursor after a character
  function moveCursor(index) {
    if (index < charElements.length) {
      charElements[index].after(cursor);
    }
  }
  
  // Start cursor after first char position (before any typing)
  charElements[0].before(cursor);
  
  function getRandomChar() {
    return CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  
  function typeNextChar() {
    if (currentIndex >= totalChars) {
      // Done typing - move cursor to end, then hide after delay
      setTimeout(() => {
        cursor.style.display = 'none';
        // Apply permanent highlight to AI agent
        charElements.forEach((el, idx) => {
          if (allChars[idx].isHighlight) {
            el.classList.add('highlight');
          }
        });
      }, 1000);
      return;
    }
    
    const charData = allChars[currentIndex];
    const currentEl = charElements[currentIndex];
    const targetChar = charData.char;
    
    if (charData.isSpace) {
      // Skip scramble for spaces - already has &nbsp;
      currentEl.classList.add('revealed');
      moveCursor(currentIndex);
      currentIndex++;
      setTimeout(typeNextChar, typeSpeed / 2);
      return;
    }
    
    // Scramble phase
    scrambleCount = 0;
    
    function scramble() {
      if (scrambleCount < maxScrambles) {
        currentEl.textContent = getRandomChar();
        currentEl.classList.add('typing');
        scrambleCount++;
        setTimeout(scramble, scrambleSpeed);
      } else {
        // Reveal the actual character
        currentEl.textContent = targetChar;
        currentEl.classList.remove('typing');
        currentEl.classList.add('revealed');
        moveCursor(currentIndex);
        currentIndex++;
        setTimeout(typeNextChar, typeSpeed);
      }
    }
    
    scramble();
  }
  
  // Start after a small delay
  setTimeout(typeNextChar, 500);
}

// Initialize scramble typewriter on page load
document.addEventListener('DOMContentLoaded', () => {
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle && heroTitle.dataset.text) {
    scrambleTypewriter(heroTitle);
  }
});

// Format currency
function formatUSD(amount) {
  if (amount >= 1000000) {
    return '$' + (amount / 1000000).toFixed(2) + 'M';
  } else if (amount >= 1000) {
    return '$' + (amount / 1000).toFixed(2) + 'K';
  }
  return '$' + amount.toFixed(2);
}

// Format large numbers
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}

// Fetch and display live platform stats
async function fetchPlatformStats() {
  try {
    const res = await fetch('/api/analytics/platform');
    const data = await res.json();
    
    document.getElementById('stat-agents-stopped').textContent = formatNumber(data.agents_stopped || 0);
    document.getElementById('stat-publishers').textContent = data.publishers || 0;
    document.getElementById('stat-volume').textContent = formatUSD(data.total_volume_usdc || 0);
    document.getElementById('stat-publisher-earnings').textContent = formatUSD(data.publisher_earnings_usdc || 0);
    document.getElementById('stat-platform-revenue').textContent = formatUSD(data.platform_revenue_usdc || 0);
  } catch (err) {
    console.log('Stats unavailable');
  }
}

// Live SSE updates for agents stopped counter
let agentsStoppedCount = 0;

function connectLiveUpdates() {
  try {
    const evtSource = new EventSource('/api/analytics/agents-stopped/live');
    
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const el = document.getElementById('stat-agents-stopped');
      
      if (data.type === 'init') {
        agentsStoppedCount = data.agents_stopped;
        el.textContent = formatNumber(agentsStoppedCount);
      } else if (data.type === 'agent_stopped') {
        agentsStoppedCount++;
        el.textContent = formatNumber(agentsStoppedCount);
        // Brief highlight animation
        el.style.color = '#22c55e';
        setTimeout(() => { el.style.color = ''; }, 500);
      }
    };
    
    evtSource.onerror = () => {
      // Reconnect after 5 seconds on error
      evtSource.close();
      setTimeout(connectLiveUpdates, 5000);
    };
  } catch (err) {
    console.log('SSE unavailable');
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
  
  // Connect to SSE for real-time agents stopped updates
  connectLiveUpdates();
  
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

// ==================== 
// Registration Modal
// ====================

function openModal() {
  const modal = document.getElementById('register-modal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  
  // Reset to step 1
  document.getElementById('register-step-1').style.display = 'block';
  document.getElementById('register-step-2').style.display = 'none';
  document.getElementById('register-form').reset();
  document.getElementById('register-error').style.display = 'none';
}

function closeModal() {
  const modal = document.getElementById('register-modal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
});

async function submitRegistration(e) {
  e.preventDefault();
  
  const btn = document.getElementById('register-btn');
  const btnText = document.getElementById('register-btn-text');
  const errorDiv = document.getElementById('register-error');
  
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const website = document.getElementById('reg-website').value.trim();
  const solanaWallet = document.getElementById('reg-solana').value.trim();
  const baseWallet = document.getElementById('reg-base').value.trim();
  
  // Validate at least one wallet
  if (!solanaWallet && !baseWallet) {
    errorDiv.textContent = 'Please provide at least one wallet address (Solana or Base).';
    errorDiv.style.display = 'block';
    return;
  }
  
  // Disable button
  btn.disabled = true;
  btnText.textContent = 'Creating...';
  errorDiv.style.display = 'none';
  
  try {
    const response = await fetch('/api/publisher/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        email,
        website: website || undefined,
        wallet_address: solanaWallet || undefined,
        wallets: {
          solana: solanaWallet || undefined,
          base: baseWallet || undefined,
        },
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    
    // Success! Show step 2
    document.getElementById('register-step-1').style.display = 'none';
    document.getElementById('register-step-2').style.display = 'block';
    
    // Populate credentials
    document.getElementById('result-api-key').textContent = data.api_key;
    document.getElementById('result-secret-key').textContent = data.secret_key;
    document.getElementById('result-integration').textContent = 
      `npm install @agenttoll/sdk\n\n// In your server.js\nimport tollbooth from '@agenttoll/sdk';\n\napp.use(tollbooth('${data.api_key}', {\n  amount: 0.005,       // USDC per request\n  freeForHumans: true  // Let browsers through free\n}));`;
    
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Get API Key';
  }
}

function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  const text = element.textContent;
  
  navigator.clipboard.writeText(text).then(() => {
    // Show brief feedback
    const btn = element.parentElement.querySelector('.copy-btn');
    const originalText = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}
