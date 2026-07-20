(function () {
  // Inject page_script.js into main world to capture fetch stream
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page_script.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  let widgetContainer = null;
  let detailsCard = null;
  let isCardOpen = false;
  let currentData = null;

  function getColorClass(percentage) {
    if (percentage < 50) return { stroke: '#10b981', bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30' };
    if (percentage < 80) return { stroke: '#f59e0b', bg: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/30' };
    return { stroke: '#f43f5e', bg: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/30' };
  }

  function formatNumber(num) {
    return new Intl.NumberFormat().format(num || 0);
  }

  function createWidget() {
    if (widgetContainer) return;

    widgetContainer = document.createElement('div');
    widgetContainer.id = 'chatgpt-token-usage-badge';
    widgetContainer.className = 'gpt-token-badge';
    widgetContainer.setAttribute('title', 'Click to view ChatGPT context token breakdown');

    widgetContainer.innerHTML = `
      <div class="gpt-token-ring-container">
        <svg class="w-8 h-8 -rotate-90 transform" viewBox="0 0 36 36">
          <path class="text-slate-800" stroke-width="3.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          <path id="gpt-token-ring-path" stroke-linecap="round" stroke-width="3.5" stroke="#10b981" fill="none" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        </svg>
        <span id="gpt-token-pct-text" class="absolute text-[10px] font-bold text-slate-200">0%</span>
      </div>
      <div class="flex flex-col text-left leading-tight">
        <span class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Context</span>
        <span id="gpt-token-count-text" class="text-xs font-bold text-slate-100">0 / 128k</span>
      </div>
    `;

    detailsCard = document.createElement('div');
    detailsCard.id = 'chatgpt-token-usage-details';
    detailsCard.className = 'gpt-token-details-card hidden';

    document.body.appendChild(widgetContainer);
    document.body.appendChild(detailsCard);

    widgetContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      isCardOpen = !isCardOpen;
      renderDetailsCard();
    });

    document.addEventListener('click', (e) => {
      if (isCardOpen && !detailsCard.contains(e.target) && !widgetContainer.contains(e.target)) {
        isCardOpen = false;
        detailsCard.classList.add('hidden');
      }
    });
  }

  function updateWidgetUI(data) {
    createWidget();
    currentData = data;

    const ringPath = document.getElementById('gpt-token-ring-path');
    const pctText = document.getElementById('gpt-token-pct-text');
    const countText = document.getElementById('gpt-token-count-text');

    const color = getColorClass(data.percentage);

    if (ringPath) {
      ringPath.setAttribute('stroke-dasharray', `${data.percentage}, 100`);
      ringPath.setAttribute('stroke', color.stroke);
    }

    if (pctText) {
      pctText.innerText = `${Math.round(data.percentage)}%`;
    }

    if (countText) {
      const formattedTotal = formatNumber(data.totalTokens);
      const formattedLimit = Math.round(data.limit / 1000) + 'k';
      countText.innerText = `${formattedTotal} / ${formattedLimit}`;
    }

    if (isCardOpen) {
      renderDetailsCard();
    }
  }

  function renderDetailsCard() {
    if (!detailsCard) return;

    if (!isCardOpen || !currentData) {
      detailsCard.classList.add('hidden');
      return;
    }

    detailsCard.classList.remove('hidden');

    const color = getColorClass(currentData.percentage);
    const breakdown = currentData.breakdown || {};
    const remainingTokens = Math.max(0, currentData.limit - currentData.totalTokens);

    detailsCard.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full ${color.bg}"></span>
          <h3 class="text-sm font-bold text-slate-100">Context Window Usage</h3>
        </div>
        <span class="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono">${currentData.modelSlug}</span>
      </div>

      <div class="space-y-1.5">
        <div class="flex justify-between text-xs">
          <span class="text-slate-400">Total Tokens</span>
          <span class="font-bold text-slate-100">${formatNumber(currentData.totalTokens)} / ${formatNumber(currentData.limit)}</span>
        </div>
        <div class="gpt-token-progress-bar">
          <div class="gpt-token-progress-fill ${color.bg}" style="width: ${currentData.percentage}%"></div>
        </div>
        <div class="flex justify-between text-[11px] text-slate-400 pt-0.5">
          <span>${currentData.percentage}% filled</span>
          <span>${formatNumber(remainingTokens)} remaining</span>
        </div>
      </div>

      <div class="border-t border-slate-800/80 pt-3 space-y-2 text-xs">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Token Breakdown</div>
        
        <div class="flex justify-between items-center py-1 border-b border-slate-800/40">
          <span class="text-slate-300 flex items-center gap-1.5">💬 User Messages</span>
          <span class="font-mono text-slate-200 font-medium">${formatNumber(breakdown.user || 0)}</span>
        </div>

        <div class="flex justify-between items-center py-1 border-b border-slate-800/40">
          <span class="text-slate-300 flex items-center gap-1.5">🤖 Assistant Responses</span>
          <span class="font-mono text-slate-200 font-medium">${formatNumber(breakdown.assistant || 0)}</span>
        </div>

        <div class="flex justify-between items-center py-1 border-b border-slate-800/40">
          <span class="text-slate-300 flex items-center gap-1.5">🔍 Tool & Search Outputs</span>
          <span class="font-mono text-amber-300 font-medium">${formatNumber(breakdown.tool || 0)}</span>
        </div>

        <div class="flex justify-between items-center py-1 border-b border-slate-800/40">
          <span class="text-slate-300 flex items-center gap-1.5">🧠 Reasoning / Thoughts</span>
          <span class="font-mono text-purple-300 font-medium">${formatNumber(breakdown.thought || 0)}</span>
        </div>

        <div class="flex justify-between items-center py-1">
          <span class="text-slate-300 flex items-center gap-1.5">⚙️ System Prompt</span>
          <span class="font-mono text-slate-400 font-medium">${formatNumber(breakdown.system || 0)}</span>
        </div>
      </div>

      <div class="border-t border-slate-800/80 pt-2 text-[10px] text-slate-500 flex justify-between items-center">
        <span>Updated real-time via SSE</span>
        <button id="gpt-token-close-btn" class="hover:text-slate-300 transition-colors">Close</button>
      </div>
    `;

    document.getElementById('gpt-token-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      isCardOpen = false;
      detailsCard.classList.add('hidden');
    });
  }

  // Listen for messages from main world page_script.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'CHATGPT_TOKEN_USAGE_UPDATE') {
      updateWidgetUI(event.data.data);
    }
  });

  // Fallback initial DOM scan if fetch was missed
  window.addEventListener('DOMContentLoaded', () => {
    createWidget();
  });
})();
