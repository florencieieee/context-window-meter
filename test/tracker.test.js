const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

test('counts every supplied message when parent links are absent and labels the Astra API reference', async () => {
  const messages = [
    { id: 'user', author: { role: 'user' }, content: { parts: ['A synthetic question.'] } },
    { id: 'answer', author: { role: 'assistant' }, content: { parts: ['A synthetic answer.'] }, metadata: { model_slug: 'gpt-6-astra-wm' } }
  ];
  const updates = [];
  const window = {
    fetch: async () => new Response(JSON.stringify({ messages, current_node: 'answer', default_model_slug: 'gpt-6-astra-wm' })),
    postMessage: message => updates.push(message.data)
  };
  runScript('page_script.js', { window, Response, TextDecoder, console: { log() {}, error() {} } });
  await window.fetch('https://chatgpt.com/backend-api/conversations/synthetic');
  await waitForStreams();
  const usage = updates.at(-1);
  assert.equal(usage.modelSlug, 'gpt-6-astra-wm');
  assert.equal(usage.charCount, messages.reduce((n, m) => n + m.content.parts[0].length, 0));
  assert.ok(usage.breakdown.user > 0);
  assert.ok(usage.breakdown.assistant > 0);
  assert.equal(usage.limit, 1050000);
  assert.equal(usage.limitSource, 'api-reference');
  assert.equal(typeof usage.percentage, 'number');
});

test('Chinese estimates grow with character count without changing English estimates', async () => {
  const updates = [];
  let text = '你好'.repeat(100);
  const window = {
    fetch: async () => new Response(JSON.stringify({ messages: [
      { author: { role: 'user' }, content: { parts: [text] } }
    ], default_model_slug: 'unlisted-model' })),
    postMessage: message => updates.push(message.data)
  };
  runScript('page_script.js', { window, Response, TextDecoder, console: { log() {}, error() {} } });
  for (const value of [text, text.repeat(2), 'Hello world']) {
    text = value;
    await window.fetch('https://chatgpt.com/backend-api/conversations/synthetic');
    await waitForStreams();
  }
  assert.equal(updates[0].totalTokens, 200);
  assert.equal(updates[1].totalTokens, 400);
  assert.equal(updates[2].totalTokens, 4);
  assert.equal(updates[0].limit, null);
});

function runScript(filename, globals) {
  const source = fs.readFileSync(path.join(projectRoot, filename), 'utf8');
  vm.runInNewContext(source, globals, { filename });
}

function waitForStreams() {
  return new Promise(resolve => setTimeout(resolve, 20));
}

test('unknown limits render without a fabricated percentage or remaining count', () => {
  const elements = new Map();
  const makeElement = () => ({
    innerHTML: '', innerText: '', attributes: {}, listeners: {},
    classList: { add() {}, remove() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    contains() { return false; }
  });
  for (const id of ['gpt-token-ring-path', 'gpt-token-pct-text', 'gpt-token-count-text']) elements.set(id, makeElement());
  const document = {
    readyState: 'complete',
    body: { appendChild(element) { elements.set(element.id, element); } },
    createElement: makeElement,
    getElementById: id => elements.get(id),
    addEventListener() {}, querySelectorAll: () => []
  };
  const listeners = {};
  const window = { addEventListener: (type, handler) => { listeners[type] = handler; } };
  runScript('content.js', { window, document, Intl,
    MutationObserver: class { observe() {} }, console: { log() {} } });
  listeners.message({ source: window, data: { type: 'CHATGPT_TOKEN_USAGE_UPDATE', data: {
    modelSlug: 'gpt-6-astra-wm', totalTokens: 42, limit: null, percentage: null, breakdown: { user: 42 }
  } } });
  elements.get('chatgpt-token-usage-badge').listeners.click({ stopPropagation() {} });
  assert.equal(elements.get('gpt-token-pct-text').innerText, '?');
  assert.equal(elements.get('gpt-token-count-text').innerText, '42 / unknown');
  const html = elements.get('chatgpt-token-usage-details').innerHTML;
  assert.match(html, /Context limit unknown/);
  assert.match(html, /gpt-6-astra-wm/);
  assert.doesNotMatch(html, /NaN|Infinity|tokens · .* left/);
  listeners.message({ source: window, data: { type: 'CHATGPT_TOKEN_USAGE_UPDATE', data: {
    modelSlug: 'gpt-6-astra-wm', totalTokens: 42, limit: 1050000, limitSource: 'api-reference', percentage: 0, breakdown: { user: 42 }
  } } });
  const referenceHtml = elements.get('chatgpt-token-usage-details').innerHTML;
  assert.match(referenceHtml, /API reference: 1,050,000/);
  assert.match(referenceHtml, /ChatGPT allowance may differ/);
  assert.match(elements.get('gpt-token-count-text').innerText, /ref\./);
  assert.doesNotMatch(referenceHtml, /tokens · .* left/);
});

test('positions the token widget in the bottom-right corner', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');
  const badgeRule = css.match(/\.gpt-token-badge \{([^}]*)\}/)?.[1] || '';
  const detailsRule = css.match(/\.gpt-token-details-card \{([^}]*)\}/)?.[1] || '';

  assert.match(badgeRule, /bottom:\s*1rem;/);
  assert.match(badgeRule, /right:\s*4rem;/);
  assert.doesNotMatch(badgeRule, /top:/);
  assert.match(detailsRule, /bottom:\s*5rem;/);
  assert.match(detailsRule, /right:\s*4rem;/);
  assert.doesNotMatch(detailsRule, /top:/);
});

test('parses the conversation detail JSON response instead of resume SSE', async () => {
  const responseBody = fs.readFileSync(
    path.join(projectRoot, 'test', 'fixtures', 'conversation-sample.json'),
    'utf8'
  );
  const updates = [];
  const window = {
    fetch: async () => new Response(responseBody, {
      headers: { 'content-type': 'application/json' }
    }),
    postMessage(message) {
      if (message.type === 'CHATGPT_TOKEN_USAGE_UPDATE') updates.push(message.data);
    }
  };
  window.window = window;

  runScript('page_script.js', {
    window,
    Response,
    TextDecoder,
    console: { log() {}, error() {} }
  });

  await window.fetch('https://chatgpt.com/backend-api/f/conversation/resume');
  await waitForStreams();
  assert.equal(updates.length, 0, 'resume responses should be ignored');

  await window.fetch('https://chatgpt.com/backend-api/conversation/6a5e4247-f128-83eb-a52b-e956275dcc0d');
  await waitForStreams();

  const usage = updates.at(-1);
  assert.ok(usage, 'expected a token usage update');
  assert.equal(usage.modelSlug, 'gpt-5-6-thinking');
  assert.ok(usage.breakdown.user > 0, 'expected user content');
  assert.ok(usage.breakdown.assistant > 0, 'expected assistant content');
  assert.equal(typeof usage.breakdown.system, 'number');
  assert.ok(usage.breakdown.tool > 0, 'expected tool content');
  assert.ok(usage.breakdown.thought > 0, 'expected reasoning content');
  assert.equal(usage.limit, 200000);
});

for (const schema of ['mapping', 'messages']) {
test(`counts only active-branch content in ${schema} responses`, async () => {
  const responseBody = JSON.stringify({
    current_node: 'recap',
    default_model_slug: 'gpt-5-6-thinking',
    mapping: {
      root: { parent: null, children: ['system', 'off-path'] },
      system: {
        parent: 'root',
        children: ['profile'],
        message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['system context'] } }
      },
      profile: {
        parent: 'system',
        children: ['recap'],
        message: {
          author: { role: 'user' },
          content: {
            content_type: 'user_editable_context',
            user_instructions: 'user instructions',
            user_profile: 'user profile'
          }
        }
      },
      recap: {
        parent: 'profile',
        children: [],
        message: {
          author: { role: 'assistant' },
          content: { content_type: 'reasoning_recap', content: 'reasoning recap' },
          metadata: { model_slug: 'gpt-5-6-thinking' }
        }
      },
      'off-path': {
        parent: 'root',
        children: [],
        message: {
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['must not be counted'] }
        }
      }
    }
  });
  const body = JSON.parse(responseBody);
  if (schema === 'messages') {
    body.messages = Object.entries(body.mapping).map(([id, node]) => ({
      ...node.message,
      id,
      parent_id: node.parent
    }));
    delete body.mapping;
  }
  const updates = [];
  const window = {
    fetch: async () => new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' }
    }),
    postMessage(message) {
      if (message.type === 'CHATGPT_TOKEN_USAGE_UPDATE') updates.push(message.data);
    }
  };
  window.window = window;

  runScript('page_script.js', {
    window,
    Response,
    TextDecoder,
    console: { log() {}, error() {} }
  });

  await window.fetch('https://chatgpt.com/backend-api/conversation/conversation-id');
  await waitForStreams();

  const usage = updates.at(-1);
  assert.ok(usage.breakdown.system > 0);
  assert.ok(usage.breakdown.user > 0);
  assert.ok(usage.breakdown.thought > 0);
  assert.equal(usage.breakdown.assistant, 0);
});
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.classList = { add() {}, remove() {} };
    this.innerText = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener() {}
  setAttribute() {}

  contains(target) {
    return target === this || this.children.some(child => child.contains(target));
  }
}

test('ignores DOM mutations made by the tracker widget', () => {
  let observer;
  let fallbackLogs = 0;
  const elements = new Map();
  const body = new FakeElement('body');
  const originalAppendChild = body.appendChild.bind(body);
  body.appendChild = child => {
    originalAppendChild(child);
    if (child.id) elements.set(child.id, child);
    return child;
  };

  const userMessage = new FakeElement('div');
  userMessage.innerText = 'A message that should be counted once.';

  const document = {
    body,
    readyState: 'complete',
    createElement: tagName => new FakeElement(tagName),
    getElementById: id => elements.get(id) || null,
    addEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'article') return [];
      if (selector.includes('data-message-author-role="user"')) return [userMessage];
      return [];
    }
  };
  const window = { addEventListener() {} };
  window.window = window;

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }

    observe() {}
  }

  runScript('content.js', {
    window,
    document,
    MutationObserver: FakeMutationObserver,
    Intl,
    console: {
      log(message) {
        if (message.includes('DOM Scan Fallback')) fallbackLogs++;
      }
    }
  });

  assert.equal(fallbackLogs, 1);
  const widget = elements.get('chatgpt-token-usage-badge');
  observer.callback([{ type: 'childList', target: widget }]);
  assert.equal(fallbackLogs, 1);
});

test('parses the plural conversations endpoint', async () => {
  const responseBody = fs.readFileSync(
    path.join(projectRoot, 'test', 'fixtures', 'conversation-sample.json'),
    'utf8'
  );

  const updates = [];
  const window = {
    fetch: async () => new Response(responseBody, {
      headers: { 'content-type': 'application/json' }
    }),
    postMessage(message) {
      if (message.type === 'CHATGPT_TOKEN_USAGE_UPDATE') updates.push(message.data);
    }
  };
  window.window = window;

  runScript('page_script.js', {
    window,
    Response,
    TextDecoder,
    console: { log() {}, error() {} }
  });

  await window.fetch(
    'https://chatgpt.com/backend-api/conversations/conversation-id?include_has_versions=true'
  );
  await waitForStreams();

  assert.ok(
    updates.length > 0,
    'expected plural /conversations/:id endpoint to produce a token usage update'
  );
});

test('parses conversations responses with a messages array', async () => {
  const responseBody = JSON.stringify({
    default_model_slug: 'gpt-5-6',
    current_node: 'message-1',
    messages: [
      {
        id: 'message-1',
        author: { role: 'assistant' },
        content: {
          content_type: 'text',
          parts: ['A response from the current conversations API schema.']
        },
        metadata: {
          model_slug: 'gpt-5-6',
          resolved_model_slug: 'gpt-5-6',
          default_model_slug: 'gpt-5-6'
        },
        parent_id: null
      }
    ]
  });

  const updates = [];
  const window = {
    fetch: async () => new Response(responseBody, {
      headers: { 'content-type': 'application/json' }
    }),
    postMessage(message) {
      if (message.type === 'CHATGPT_TOKEN_USAGE_UPDATE') updates.push(message.data);
    }
  };
  window.window = window;

  runScript('page_script.js', {
    window,
    Response,
    TextDecoder,
    console: { log() {}, error() {} }
  });

  await window.fetch(
    'https://chatgpt.com/backend-api/conversations/conversation-id?include_has_versions=true'
  );
  await waitForStreams();

  const usage = updates.at(-1);

  assert.ok(
    usage,
    'expected messages-array response to produce a token usage update'
  );
  assert.equal(usage.modelSlug, 'gpt-5-6');
  assert.equal(usage.limit, 200000);
  assert.ok(usage.breakdown.assistant > 0);
});
