# Screen AI

A [Raycast](https://www.raycast.com/) extension that analyzes **screen captures** or the **active browser page** using OpenAI, Anthropic Claude, or Google Gemini. You bring your own API keys; nothing is sent through a third-party backend beyond the provider you choose.

## Features

- **Screen** — Capture the display (full screen, window, or region) and send it to a vision-capable model.
- **Browser** — Read the current tab’s content as text and analyze it (no image; uses the page text).
- **Multiple providers** — OpenAI, Anthropic, and Gemini with selectable models (see preferences in Raycast).
- **Follow-up** — Continue the conversation after the first reply.
- **Custom instructions** — Default prompt in preferences; editable on each run.

## Requirements

- [Raycast](https://www.raycast.com/)
- At least one API key for the provider you use:
  - [OpenAI](https://platform.openai.com/)
  - [Anthropic](https://console.anthropic.com/)
  - [Google AI Studio](https://aistudio.google.com/apikey) (Gemini)

## Development

```bash
npm install
npm run dev
```

Build and lint:

```bash
npm run build
npm run lint
```

## Configuration

Open the extension’s preferences in Raycast to set API keys, choose the **model** (must match the provider whose key you configured), and optionally change the **default instructions** used when the analysis form opens.

## License

MIT
