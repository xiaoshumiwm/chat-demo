# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 可配置对话接口：支持 DeepSeek，也支持任意 OpenAI 兼容的接口地址和 API Key；模型可通过 `/v1/models` 读取或手动填写。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 自定义 API

设置 → 数据管理 → 对话接口支持任意 OpenAI 兼容的接口地址。填写 API Key 后，可通过 `/v1/models` 读取模型，也可以手动填写模型名。三方模型可调用 `deepseek_web_search` 工具执行网页搜索；额外配置 DeepSeek API Key 后即可使用搜索、朗读和语音输入。OpenAI 兼容接口的对话标题由本地生成，日期与位置信息会注入 system 消息。附件上传仍只支持 DeepSeek 接口格式。

### 本地 CORS 代理

部分 API 服务不返回 CORS 响应头，浏览器会直接拦截请求。项目自带一个本地代理，既托管 `dist/`，也把 `/proxy/*` 转发到目标服务：

```sh
pnpm build
TARGET_BASE=https://developer.amd.com.cn/radeon/api pnpm proxy
```

浏览器打开 `http://127.0.0.1:8787`，设置中的接口地址填写：

```text
http://127.0.0.1:8787/proxy
```

`TARGET_BASE` 填服务根地址，不要带 `/v1`；如果带了会自动去掉。需要在多个供应商之间切换时，可以把目标编码到 URL 里：

```sh
node -e "console.log('http://127.0.0.1:8787/proxy/'+Buffer.from(process.argv[1]).toString('base64url'))" https://developer.amd.com.cn/radeon/api
```

把输出结果作为接口地址填入即可。代理默认只监听 `127.0.0.1`，不要暴露到公网。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm proxy`  | 托管 `dist/` 并代理 CORS 受限的 API |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 以 `https://api.deepseek.com` 作为初始地址，运行时的接口地址可在设置中修改；`createConfig({ apiOrigin, devServer })` 只改变默认值和开发服务器代理。

DeepSeek 默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信。第三方 OpenAI 兼容服务使用 `/v1/chat/completions`，仅保证文本对话与流式输出。主接口不是 DeepSeek 时，可在设置中单独配置 DeepSeek API Key，以继续使用朗读、语音输入和联网搜索：搜索以 `deepseek_web_search` 工具暴露给三方模型，由 DeepSeek 执行；日期与位置信息会注入 system 消息，标题由本地生成。附件仍需要 DeepSeek 对话接口。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
