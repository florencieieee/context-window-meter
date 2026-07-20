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

  function dispatchTokenUpdate(textByRole, modelSlug) {
    let totalTokens = 0;
    const breakdown = {};

    for (const [role, text] of Object.entries(textByRole)) {
      const tokens = estimateTokens(text);
      breakdown[role] = tokens;
      totalTokens += tokens;
    }

    if (totalTokens === 0) return;

    const limit = getContextLimit(modelSlug);
    const percentage = Math.min(100, (totalTokens / limit) * 100);

    console.log(`[ChatGPT Token Tracker] Validated Token Count: ${totalTokens} tokens (${percentage.toFixed(1)}%) for ${modelSlug}`);

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

  function processJsonMapping(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return;
    const mapping = jsonObj.mapping;
    if (!mapping || typeof mapping !== 'object') return;

    let modelSlug = jsonObj.default_model_slug || 'gpt-4o';
    const textByRole = {
      user: '',
      assistant: '',
      system: '',
      tool: '',
      thought: ''
    };

    for (const node of Object.values(mapping)) {
      const msg = node.message;
      if (!msg) continue;

      const role = msg.author?.role || 'assistant';
      const targetRole = role === 'tool' ? 'tool' : role === 'system' ? 'system' : role === 'user' ? 'user' : 'assistant';
      const parts = msg.content?.parts || [];

      if (msg.metadata?.model_slug) {
        modelSlug = msg.metadata.model_slug;
      }

      let msgText = '';
      for (const p of parts) {
        if (typeof p === 'string') msgText += p;
        else if (typeof p === 'object') msgText += JSON.stringify(p);
      }

      textByRole[targetRole] = (textByRole[targetRole] || '') + msgText;
    }

    dispatchTokenUpdate(textByRole, modelSlug);
  }

  function processStreamText(fullText) {
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

        if (obj.type === 'server_ste_metadata' && obj.metadata?.model_slug) {
          modelSlug = obj.metadata.model_slug;
        }

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
        // Skip incomplete chunk JSON
      }
    }

    dispatchTokenUpdate(textByRole, modelSlug);
  }

  function handleStreamReader(streamReader) {
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    function read() {
      streamReader.read().then(({ done, value }) => {
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          processStreamText(buffer);
        }
        if (!done) {
          read();
        } else {
          buffer += decoder.decode();
          processStreamText(buffer);
        }
      }).catch(err => {});
    }

    read();
  }

  function shouldIntercept(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.includes('/backend-api/f/conversation/resume') ||
      url.includes('/backend-api/conversation/resume') ||
      (url.includes('/backend-api/conversation/') && !url.includes('stream_status') && !url.includes('init')) ||
      url.endsWith('/backend-api/conversation')
    );
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const targetUrl = response.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
      if (shouldIntercept(targetUrl)) {
        console.log('[ChatGPT Token Tracker] Target conversation fetch intercepted:', targetUrl);

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream') || targetUrl.includes('resume')) {
          if (response.body) {
            const streamReader = response.clone().body.getReader();
            handleStreamReader(streamReader);
          }
        } else {
          response.clone().json().then(json => {
            processJsonMapping(json);
          }).catch(err => {
            response.clone().text().then(text => processStreamText(text)).catch(() => {});
          });
        }
      }
    } catch (err) {
      console.error('[ChatGPT Token Tracker] Fetch intercept error:', err);
    }

    return response;
  };
})();
