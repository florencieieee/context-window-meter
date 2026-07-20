# Context Window Meter for ChatGPT

A Chrome extension (Manifest V3) that shows, in real time, how much of the model's context window your ChatGPT conversation is actually using — total tokens, the model's limit, the percentage, and a breakdown of what is filling it.

Everything runs locally in the tab. No data leaves your browser, nothing is stored, and the extension can only access `chatgpt.com`. See the [privacy policy](PRIVACY.md).

> Independent project — not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" is a trademark of OpenAI.

## Why

ChatGPT gives you no indication of how full the context window is. You find out by hitting the limit: the model starts forgetting the top of the conversation, or silently truncates a long document you pasted. This puts a number on it before that happens — and shows *which* part of the conversation is eating the budget, which is usually not the part you'd guess.

## Features

- **Live token count** against the active model's context limit, as a percentage
- **Category breakdown** — your messages, ChatGPT's replies, tool and search results, reasoning traces, and system instructions
- **Follows ChatGPT's own theme** — inherits the site's CSS custom properties, so light/dark and typography match with no configuration
- **Honest loading state** — the badge shows a skeleton until it has actually measured the conversation, so it never reports a `0%` it hasn't verified
- **No configuration, no account, no network calls**

## Install

### From the Chrome Web Store

_Listing pending review — link will go here once published._

### From source

1. Clone this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the repository root.
5. Open any conversation on `https://chatgpt.com/`.

## How it works

1. **Response interception** — a `MAIN`-world script wraps the page's own `fetch` so it can read the `/backend-api/conversation/{id}` JSON that ChatGPT already loads. No extra requests are made.
2. **Branch walk** — the conversation is a tree, not a list. Only the active branch from the root to `current_node` counts toward the context window, so the parser walks that path and ignores edited-away siblings.
3. **Token estimation** — subword BPE estimation across message categories, including content types that are easy to forget: reasoning traces, tool output, file search results, and the user profile / custom instructions block.
4. **Badge** — a pill in the bottom-right, expanding on click into the category breakdown.

## Development

```bash
npm test              # node --test, no dependencies
npm run package       # writes dist/extension.zip for store upload
```

Icons are generated from `icons/icon.svg`:

```bash
for s in 16 48 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon$s.png; done
```

### Styling

`styles.css` is hand-written and needs no build step. It is scoped entirely to the two injected roots and inherits ChatGPT's own CSS custom properties (`--text-primary`, `--main-surface-primary`, `--border-light`, …), so the widget follows the site's theme and typeface with no JavaScript. Each `var()` carries a fallback in case OpenAI renames a token.

### Test fixtures

`test/fixtures/conversation-sample.json` is a **scrubbed** capture. The graph structure, content types, and message sizes are real; all free text, URLs, and account fields are synthetic.

**Never commit a raw capture from your own account.** A ChatGPT conversation response embeds your email address, user ID, avatar URL, and the full text of the conversation. `.gitignore` blocks the common filenames, but the safe habit is to scrub before the file ever enters the working tree.

## Caveats

- Token counts are **estimates**. BPE estimation without the real tokenizer lands close but not exact.
- The extension depends on ChatGPT's internal response shape, which OpenAI can change without notice. If the badge stops updating, that is the likely cause.
- Context limits are inferred from the model slug and may lag behind new model releases.

## License

MIT — see [LICENSE](LICENSE).
