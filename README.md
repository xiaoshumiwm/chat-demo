# chat-demo

English | [简体中文](README.zh-CN.md)

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

You can [try the app online](https://deepseek-ai.github.io/chat-demo/) or download the archive from [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Configurable chat API: use DeepSeek, or an OpenAI-compatible base URL and API Key. Models can be loaded from `/v1/models` or entered manually.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Custom API provider

Settings → Data → Chat API accepts any OpenAI-compatible base URL. Enter an API Key and either load models from `/v1/models` or type a model name manually. Third-party models can call a `deepseek_web_search` tool for web search; configure a separate DeepSeek API Key to execute search, read-aloud, and voice input. Chat titles are generated locally for OpenAI-compatible APIs, and the configured date/location context is injected into the system message. Plain-text attachments are sent inline for OpenAI-compatible APIs (base64 file content blocks, falling back to plain-text parts when the API rejects file blocks); images and PDFs still require the DeepSeek API format.

### Browser CORS limitation

Browser requests can only call APIs that return CORS headers and handle `OPTIONS`. This applies equally to `pnpm dev`, a plain static file server, and a static release. Changing the port or serving `dist/index.html` directly does not remove the restriction.

- `pnpm dev`: requests still go directly to the configured API by default. If the provider does not support CORS, configure `devServer.proxy` in `rspack.config.ts`.
- Static release: static hosting has no backend. Deploy a reverse proxy that forwards requests and adds CORS headers, or use a provider that enables CORS.
- Opening `dist/index.html` directly: the origin is `null`, which makes CORS checks stricter.

If the provider does not return `Access-Control-Allow-Origin` or handle `OPTIONS`, the browser blocks the actual request before it is sent and the app reports a network error.

`pnpm dev` already proxies the following endpoints that do not support CORS. Set the base URL in Settings → Data → Chat API to the local path and the development server forwards requests upstream (the proxy only applies to `pnpm dev`):

| Upstream endpoint                            | Base URL in Settings |
| -------------------------------------------- | -------------------- |
| `https://token.sensenova.cn/v1`              | `/sensenova`         |
| `https://tecoapi.thuwayteczz.com`            | `/tecoapi`           |
| `https://developer.amd.com.cn/radeon/api/v1` | `/amd`               |

The local path may also use the full upstream form, i.e. replace `https://host` with the local prefix: `/sensenova/v1`, `/tecoapi`, `/amd/radeon/api/v1`.

## Data and storage

Your API keys and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` as the initial base URL. It can also be changed at runtime in Settings; `createConfig({ apiOrigin, devServer })` only changes the default and development server proxy.

DeepSeek uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Custom OpenAI-compatible services use `/v1/chat/completions` and only guarantee text chat streaming. When the chat API is not DeepSeek, configure a separate DeepSeek API Key in Settings to enable read-aloud, voice input, and web search. Search is exposed to the third-party model as a `deepseek_web_search` tool and executed by DeepSeek; the configured date/location context is injected into the system message, and titles are generated locally. Attachments still require the DeepSeek chat format.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
