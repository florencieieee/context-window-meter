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
    // Approximate Han characters individually instead of collapsing a whole
    // Chinese sentence into one non-word run. This is not a model tokenizer.
    const hanCount = (text.match(/\p{Script=Han}/gu) || []).length;
    text = text.replace(/\p{Script=Han}/gu, ' ');
    const words = text.match(/\w+/g) || [];
    const nonWords = text.match(/[^\w\s]+/g) || [];
    const estimated = hanCount + Math.ceil(words.length * 1.3 + nonWords.length * 1.1 + ((text.length - hanCount) * 0.05));
    return Math.max(0, Math.round(estimated));
  }

  function getContextLimit(modelSlug) {
    if (!modelSlug) return null;
    const slug = modelSlug.toLowerCase();
    // API reference only; the ChatGPT web allowance is not verified.
    // https://developers.openai.com/api/docs/models/gpt-6-astra
    if (/^gpt-6-astra(?:-|$)/.test(slug)) return 1050000;
    for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
      if (slug.includes(key)) return limit;
    }
    return null;
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
    const percentage = limit ? Math.min(100, (totalTokens / limit) * 100) : null;

    console.log(`[ChatGPT Token Tracker] Validated Token Count: ${totalTokens} tokens (${percentage === null ? 'limit unknown' : percentage.toFixed(1) + '%'}) for ${modelSlug}`);

    window.postMessage(
      {
        type: 'CHATGPT_TOKEN_USAGE_UPDATE',
        data: {
          totalTokens,
          limit,
          limitSource: /^gpt-6-astra(?:-|$)/i.test(modelSlug) ? 'api-reference' : null,
          percentage: percentage === null ? null : parseFloat(percentage.toFixed(2)),
          modelSlug,
          breakdown,
          charCount: Object.values(textByRole).reduce((a, b) => a + b.length, 0),
          updatedAt: new Date().toISOString()
        }
      },
      '*'
    );
  }

  function extractContentText(content) {
    if (!content || typeof content !== 'object') return '';

    const text = [];
    const appendValue = value => {
      if (typeof value === 'string') text.push(value);
      else if (value && typeof value === 'object') text.push(JSON.stringify(value));
    };

    if (Array.isArray(content.parts)) content.parts.forEach(appendValue);
    appendValue(content.text);
    appendValue(content.result);
    appendValue(content.content);
    appendValue(content.summary);
    appendValue(content.model_set_context);
    appendValue(content.structured_context);
    appendValue(content.repo_summary);
    appendValue(content.repository);
    appendValue(content.user_instructions);
    appendValue(content.user_profile);

    if (Array.isArray(content.thoughts)) {
      for (const thought of content.thoughts) {
        if (typeof thought === 'string') {
          text.push(thought);
          continue;
        }
        if (!thought || typeof thought !== 'object') continue;
        appendValue(thought.summary);
        appendValue(thought.content);
        if (Array.isArray(thought.chunks)) thought.chunks.forEach(appendValue);
      }
    }

    return text.join('\n');
  }

  function getMessageRole(message) {
    const contentType = message.content?.content_type;
    if (contentType === 'thoughts' || contentType === 'reasoning_recap') return 'thought';
    if (contentType === 'model_editable_context') return 'system';

    const role = message.author?.role || 'assistant';
    if (role === 'tool' || role === 'system' || role === 'user') return role;
    return 'assistant';
  }

  function getMessageModelSlug(message) {
    return message.metadata?.model_slug ||
      message.metadata?.resolved_model_slug ||
      message.metadata?.default_model_slug ||
      null;
  }

  function processJsonMapping(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return;

    let modelSlug = jsonObj.default_model_slug || 'gpt-4o';
    const textByRole = {
      user: '',
      assistant: '',
      system: '',
      tool: '',
      thought: ''
    };

    if (Array.isArray(jsonObj.messages)) {
      const messagesById = new Map(jsonObj.messages
        .filter(msg => msg && typeof msg === 'object' && msg.id)
        .map(msg => [msg.id, msg]));
      const activeMessages = [];
      const visitedMessageIds = new Set();
      // Flat responses omit parent links; count the supplied messages in that case.
      const hasParentLinks = [...messagesById.values()].some(msg =>
        Object.prototype.hasOwnProperty.call(msg, 'parent_id'));
      let messageId = hasParentLinks ? jsonObj.current_node : null;

      while (messageId && !visitedMessageIds.has(messageId)) {
        const msg = messagesById.get(messageId);
        if (!msg) break;
        activeMessages.push(msg);
        visitedMessageIds.add(messageId);
        messageId = msg.parent_id;
      }

      if (activeMessages.length > 0) activeMessages.reverse();
      else activeMessages.push(...jsonObj.messages);

      for (const msg of activeMessages) {
        if (!msg || typeof msg !== 'object') continue;

        const targetRole = getMessageRole(msg);
        const messageModelSlug = getMessageModelSlug(msg);
        if (messageModelSlug) modelSlug = messageModelSlug;

        textByRole[targetRole] += extractContentText(msg.content);
      }

      dispatchTokenUpdate(textByRole, modelSlug);
      return;
    }

    const mapping = jsonObj.mapping;
    if (!mapping || typeof mapping !== 'object') return;

    const activeNodes = [];
    const visitedNodeIds = new Set();
    let nodeId = jsonObj.current_node;

    while (nodeId && !visitedNodeIds.has(nodeId)) {
      const node = mapping[nodeId];
      if (!node) break;
      activeNodes.push(node);
      visitedNodeIds.add(nodeId);
      nodeId = node.parent;
    }

    if (activeNodes.length > 0) activeNodes.reverse();
    else activeNodes.push(...Object.values(mapping));

    for (const node of activeNodes) {
      const msg = node.message;
      if (!msg) continue;

      const targetRole = getMessageRole(msg);
      const messageModelSlug = getMessageModelSlug(msg);
      if (messageModelSlug) modelSlug = messageModelSlug;

      textByRole[targetRole] += extractContentText(msg.content);
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
          const targetRole = getMessageRole(im);
          const messageModelSlug = getMessageModelSlug(im);
          if (messageModelSlug) modelSlug = messageModelSlug;
          textByRole[targetRole] += extractContentText(im.content);
        }

        const v = obj.v;
        if (v && typeof v === 'object' && v.message) {
          const msg = v.message;
          const msgId = msg.id;
          const messageModelSlug = getMessageModelSlug(msg);
          if (messageModelSlug) modelSlug = messageModelSlug;

          if (msgId && !uniqueMessages.has(msgId)) {
            uniqueMessages.add(msgId);
            const targetRole = getMessageRole(msg);
            textByRole[targetRole] += extractContentText(msg.content);
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
        } else if (o === 'append' && p === '/message/content/thoughts' && Array.isArray(v)) {
          textByRole.thought += extractContentText({ thoughts: v });
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
    return /^(?:https?:\/\/[^/]+)?\/backend-api\/conversations?\/[^/?#]+\/?(?:[?#].*)?$/.test(url);
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const targetUrl = response.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url || '');
      if (shouldIntercept(targetUrl)) {
        console.log('[ChatGPT Token Tracker] Target conversation fetch intercepted:', targetUrl);

        response.clone().json().then(json => {
          processJsonMapping(json);
        }).catch(err => {
          console.error('[ChatGPT Token Tracker] Conversation JSON parse error:', err);
        });
      }
    } catch (err) {
      console.error('[ChatGPT Token Tracker] Fetch intercept error:', err);
    }

    return response;
  };
})();
