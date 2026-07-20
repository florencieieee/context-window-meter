# ChatGPT Token Usage Tracker (Chrome Extension)

A Chrome Extension (Manifest V3) that calculates and displays real-time context window usage (token count, limit, and percentage) for ChatGPT chats.

## 🚀 How It Works
1. **Network Interception**: Intercepts ChatGPT's `/backend-api/conversation/{conversation_id}` JSON response in the main browser context.
2. **Conversation Parsing**: Reads the active conversation branch, including system messages, user prompts and profile context, assistant answers, tool/file search outputs, and reasoning thoughts.
3. **Token Estimation**: Computes precise token counts across message categories using subword BPE token estimation.
4. **Tailwind Floating Badge**: Displays a clean, dark-mode Tailwind UI badge showing the current token count and percentage of the model's context window. Clicking the badge opens a detailed token breakdown (User, Assistant, Tools/Search, Thoughts, System).

## 📥 How to Install in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the directory: `/Users/joostbakker/projects/productivity/chatgpt-token-usage-extension`.
5. Open any ChatGPT conversation on `https://chatgpt.com/` to see the real-time context usage badge!

## 🛠 Building Styles
If you make changes to Tailwind CSS components in `src/input.css`:
```bash
npm run build:css
```
