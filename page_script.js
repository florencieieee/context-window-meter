(function () {
  if (window.__chatgpt_token_tracker_injected) return;
  window.__chatgpt_token_tracker_injected = true;

  console.log('[ChatGPT Token Tracker] Injected into MAIN world context.');

  const MODEL_CONTEXT_LIMITS = {
    'gpt-5-6-thinking': 200000,
    'gpt-5': 200000,
    'o1': 200000,
    'o1-preview': 128000,
    'o1-mini': 128000,
    'o3-mini': 200000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16384,
    'default': 128000
  };

  function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const words = text.match(/\w+/g) || [];
    const nonWords = text.match(/[^\w\s]+/g) || [];
    const estimated = Math.ceil(words.length * 1.3 + nonWords.length * 1.1 + (text.length * 0.05));
    return Math.max(0, Math.round(estimated));
  }

  function getContextLimit(modelSlug) {
    if (!modelSlug) return MODEL_CONTEXT_LIMITS['default'];
    const slug = modelSlug.toLowerCase();
    for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
      if (slug.includes(key)) return limit;
    }
    return MODEL_CONTEXT_LIMITS['default'];
  }

  function processStreamText(fullText, url) {
    let modelSlug = 'gpt-4o';
    const textByRole = {
      user: '',
      assistant: '',
      system: '',
      tool: '',
      thought: ''
    };

    const uniqueMessages = new Set();
    const blocks = fullText.split(/\r?\n\r?\n/);

    for (const blockStr of blocks) {
      const lines = blockStr.split(/\r?\n/).filter(l => !l.startsWith(':'));
      if (!lines.length) continue;

      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith('event:')) continue;
        if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5));
        } else {
          dataLines.push(line);
        }
      }

      let rawJson = dataLines.join('\n').trim();
      if (!rawJson || rawJson === '[DONE]' || rawJson.startsWith('[DONE')) continue;

      try {
        const obj = JSON.parse(rawJson);
        if (!obj || typeof obj !== 'object') continue;

        // Model metadata detection
        if (obj.type === 'server_ste_metadata' && obj.metadata?.model_slug) {
          modelSlug = obj.metadata.model_slug;
        }

        // Direct input message
        if (obj.input_message) {
          const im = obj.input_message;
          const role = im.author?.role || 'user';
          const parts = im.content?.parts || [];
          for (const p of parts) {
            if (typeof p === 'string') {
              textByRole[role] = (textByRole[role] || '') + p;
            }
          }
        }

        // Full message node payload
        const v = obj.v;
        if (v && typeof v === 'object' && v.message) {
          const msg = v.message;
          const role = msg.author?.role || 'assistant';
          const msgId = msg.id;
          const parts = msg.content?.parts || [];

          let fullPartText = '';
          for (const p of parts) {
            if (typeof p === 'string') fullPartText += p;
            else if (typeof p === 'object') fullPartText += JSON.stringify(p);
          }

          if (msgId && !uniqueMessages.has(msgId)) {
            uniqueMessages.add(msgId);
            const targetRole = role === 'tool' ? 'tool' : role === 'system' ? 'system' : role === 'user' ? 'user' : 'assistant';
            textByRole[targetRole] = (textByRole[targetRole] || '') + fullPartText;
          }
        }

        // Incremental streaming delta updates
        const o = obj.o;
        const p = obj.p;
        if (o === 'append' && typeof v === 'string') {
          if (p === '/message/content/thoughts') {
            textByRole.thought += v;
          } else if (p === '/message/content/text' || (p && p.includes('/message/content/parts/'))) {
            textByRole.assistant += v;
          }
        }
      } catch (e) {
        // Safe skip invalid chunk JSON
      }
    }

    let totalTokens = 0;
    const breakdown = {};

    for (const [role, text] of Object.entries(textByRole)) {
      const tokens = estimateTokens(text);
      breakdown[role] = tokens;
      totalTokens += tokens;
    }

    const limit = getContextLimit(modelSlug);
    const percentage = Math.min(100, (totalTokens / limit) * 100);

    window.postMessage(
      {
        type: 'CHATGPT_TOKEN_USAGE_UPDATE',
        data: {
          totalTokens,
          limit,
          percentage: parseFloat(percentage.toFixed(2)),
          modelSlug,
          breakdown,
          charCount: Object.values(textByRole).reduce((a, b) => a + b.length, 0),
          updatedAt: new Date().toISOString()
        }
      },
      '*'
    );
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/backend-api/f/conversation/resume') || url.includes('/backend-api/conversation')) {
        const cloned = response.clone();
        cloned.text().then(text => {
          if (text) processStreamText(text, url);
        }).catch(err => console.error('[ChatGPT Token Tracker] Response text error:', err));
      }
    } catch (err) {
      console.error('[ChatGPT Token Tracker] Fetch intercept error:', err);
    }

    return response;
  };

  // Intercept XMLHttpRequest
  const originalXHR = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', function () {
      try {
        if (typeof url === 'string' && (url.includes('/backend-api/f/conversation/resume') || url.includes('/backend-api/conversation'))) {
          if (this.responseText) {
            processStreamText(this.responseText, url);
          }
        }
      } catch (err) {
        console.error('[ChatGPT Token Tracker] XHR intercept error:', err);
      }
    });
    return originalXHR.apply(this, [method, url, ...rest]);
  };
})();
