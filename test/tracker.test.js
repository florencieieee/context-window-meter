const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function runScript(filename, globals) {
  const source = fs.readFileSync(path.join(projectRoot, filename), 'utf8');
  vm.runInNewContext(source, globals, { filename });
}

function waitForStreams() {
  return new Promise(resolve => setTimeout(resolve, 20));
}

test('parses current conversation resume SSE content', async () => {
  const responseBody = fs.readFileSync(path.join(projectRoot, 'sample_response.txt'), 'utf8');
  const updates = [];
  const window = {
    fetch: async () => new Response(responseBody, {
      headers: { 'content-type': 'text/event-stream' }
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

  const usage = updates.at(-1);
  assert.ok(usage, 'expected a token usage update');
  assert.equal(usage.modelSlug, 'gpt-5-6-thinking');
  assert.ok(usage.breakdown.assistant > 0, 'expected assistant content');
  assert.ok(usage.breakdown.tool > 0, 'expected tool content');
  assert.ok(usage.breakdown.thought > 0, 'expected reasoning content');
  assert.equal(usage.limit, 200000);
});

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
