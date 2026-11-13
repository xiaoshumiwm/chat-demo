import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import {
  anthropicBaseUrl,
  chatCompletionsUrl,
  DEFAULT_BASE_URL,
  modelsUrl,
  type ApiFormat,
  type ApiProvider,
} from './provider.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  WebSearchResult,
  WebSearchToolResultBlock,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；运行时可在设置中修改 */
export const API_ORIGIN = DEFAULT_BASE_URL
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  isRecord(value) && 'error' in value && typeof (value as ApiErrorBody).error?.message === 'string'

const errorMessage = (value: unknown): string | null => {
  if (isErrorBody(value)) {
    return value.error.message
  }
  if (isRecord(value) && typeof value.error === 'string') {
    return value.error
  }
  if (isRecord(value) && typeof value.message === 'string') {
    return value.message
  }
  return null
}

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    const parsed = errorMessage(body)
    if (parsed) {
      message = parsed
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const bearerHeaders = (apiKey: string, format: ApiFormat): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  // DeepSeek / Anthropic 兼容网关常用 x-api-key；纯 OpenAI 接口只发送 Bearer。
  ...(format === 'deepseek' ? { 'x-api-key': apiKey } : {}),
})

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer；两者都带上以兼容代理。
  'x-api-key': apiKey,
  Authorization: `Bearer ${apiKey}`,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

const readModelIds = (value: unknown): string[] => {
  const ids = new Set<string>()
  const add = (item: unknown) => {
    if (typeof item === 'string') {
      if (item.trim()) {
        ids.add(item.trim())
      }
    } else if (isRecord(item) && typeof item.id === 'string' && item.id.trim()) {
      ids.add(item.id.trim())
    }
  }
  if (Array.isArray(value)) {
    value.forEach(add)
  } else if (isRecord(value)) {
    for (const key of ['data', 'models', 'result', 'items']) {
      if (Array.isArray(value[key])) {
        value[key].forEach(add)
      }
    }
  }
  return [...ids]
}

/**
 * GET {base}/v1/models，读取可用模型；兼容 OpenAI、DeepSeek 以及常见的
 * `{ data / models / result: [...] }` 包装。没有模型时返回空数组，由界面提示手动输入。
 */
export const fetchModels = async (
  provider: ApiProvider,
  signal?: AbortSignal
): Promise<string[]> => {
  const response = await request(modelsUrl(provider.baseUrl), {
    method: 'GET',
    headers: bearerHeaders(provider.apiKey, provider.format),
    signal,
  })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ApiError('protocol', text || 'Invalid models response')
  }
  return readModelIds(body)
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  provider: ApiProvider,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${anthropicBaseUrl(provider.baseUrl)}/files`, {
    method: 'POST',
    headers: anthropicHeaders(provider.apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (provider: ApiProvider, fileId: string): Promise<void> => {
  await request(`${anthropicBaseUrl(provider.baseUrl)}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(provider.apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
async function* streamAnthropicMessage(
  provider: ApiProvider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${anthropicBaseUrl(provider.baseUrl)}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(provider.apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

// ---------- OpenAI 兼容接口 ----------

/** 由第三方模型发起、用 DeepSeek 服务端搜索执行的工具。 */
export type WebSearchExecutor = (
  queries: string[],
  signal: AbortSignal
) => Promise<WebSearchResult[]>

type OpenAiWireToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: OpenAiWireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAiToolCall = { id: string; name: string; arguments: string }

type OpenAiToolSpec = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type OpenAiStreamState = {
  started: boolean
  usage?: MessageUsage
}

type OpenAiRoundResult = {
  /** 本轮 assistant 正文，工具调用轮次需要原样带回下一轮 */
  text: string
  toolCalls: OpenAiToolCall[]
  stopReason: StopReason
  terminated: boolean
  usage?: MessageUsage
}

const WEB_SEARCH_TOOL: OpenAiToolSpec = {
  type: 'function',
  function: {
    name: 'deepseek_web_search',
    description:
      'Search the web for up-to-date or externally verifiable information. Call this when the user asks for recent news, facts that need sources, or explicitly requests web search.',
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'One to three concise search queries.',
        },
      },
      required: ['queries'],
      additionalProperties: false,
    },
  },
}

const textOf = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }
      if (isRecord(part)) {
        if (typeof part.text === 'string') {
          return part.text
        }
        if (typeof part.content === 'string') {
          return part.content
        }
      }
      return ''
    })
    .join('')
}

/** 把内部 Messages 请求转换为 OpenAI Chat Completions；文件和 DeepSeek 扩展全部忽略。 */
const toOpenAiMessages = (body: CreateMessageRequest): OpenAiMessage[] => {
  const messages: OpenAiMessage[] = []
  // DeepSeek 使用 latest_reminder 角色注入日期、位置等信息；OpenAI 兼容接口
  // 没有这个角色，合并到最后一条 system 中，保证位置等配置仍然生效。
  const reminder = [...body.messages]
    .reverse()
    .find((message) => message.role === 'latest_reminder')
  const system = [body.system, reminder ? `Current context: ${reminder.content}` : '']
    .filter(Boolean)
    .join('\n\n')
  if (system) {
    messages.push({ role: 'system', content: system })
  }
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'user') {
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .flatMap((block) => (block.type === 'text' ? [block.text] : []))
              .join('\n')
      if (text) {
        messages.push({ role: 'user', content: text })
      }
      continue
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    if (text) {
      messages.push({ role: 'assistant', content: text })
    }
  }
  return messages
}

const readOpenAiUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const input = typeof value.prompt_tokens === 'number' ? value.prompt_tokens : undefined
  const output = typeof value.completion_tokens === 'number' ? value.completion_tokens : undefined
  if (input === undefined && output === undefined) {
    return undefined
  }
  const details = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined
  const cached = details && typeof details.cached_tokens === 'number' ? details.cached_tokens : 0
  return {
    // 部分服务把缓存命中计入 prompt_tokens，与 DeepSeek 的统计方式对齐。
    input_tokens: Math.max(0, (input ?? 0) - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: output ?? 0,
  }
}

const readStopReason = (value: unknown): StopReason => {
  switch (value) {
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

const readQueries = (argumentsText: string): string[] => {
  try {
    const value: unknown = JSON.parse(argumentsText)
    if (!isRecord(value)) {
      return []
    }
    if (Array.isArray(value.queries)) {
      return value.queries
        .filter((item): item is string => typeof item === 'string' && !!item.trim())
        .map((item) => item.trim())
        .slice(0, 3)
    }
    if (typeof value.query === 'string' && value.query.trim()) {
      return [value.query.trim()]
    }
  } catch {
    // 参数不完整或不是 JSON 时按空查询处理，由调用方返回工具错误。
  }
  return []
}

const searchResultPayload = (results: WebSearchResult[]) =>
  JSON.stringify({
    results: results.slice(0, 8).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet.slice(0, 500),
      published_at: result.page_age,
      site_name: result.site_name,
    })),
  })

/**
 * 单轮 OpenAI 流：把 content / reasoning 转成内部块，同时收集 tool_calls。
 * 工具调用块不直接产出，由外层执行 DeepSeek 搜索后再合成内部工具块。
 */
async function* streamOpenAiRound(
  provider: ApiProvider & { model: string },
  requestBody: {
    model: string
    messages: OpenAiMessage[]
    tools?: OpenAiToolSpec[]
  },
  signal: AbortSignal,
  state: OpenAiStreamState,
  result: OpenAiRoundResult
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(chatCompletionsUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      ...bearerHeaders(provider.apiKey, 'openai'),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...requestBody, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  let current: { type: 'text' | 'thinking'; index: number } | null = null
  let nextIndex = 0
  const partialToolCalls = new Map<number, OpenAiToolCall>()

  const closeBlock = (): MessageStreamEvent | null => {
    if (!current) {
      return null
    }
    const event: MessageStreamEvent = { type: 'content_block_stop', index: current.index }
    current = null
    return event
  }

  try {
    for await (const { data } of readServerSentEvents(response.body, signal)) {
      if (data.trim() === '[DONE]') {
        result.terminated = true
        break
      }
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        continue
      }
      const message = errorMessage(payload)
      if (message) {
        throw new ApiError('stream', message)
      }
      if (!isRecord(payload)) {
        continue
      }
      if (!state.started) {
        state.started = true
        yield {
          type: 'message_start',
          message: {
            id: typeof payload.id === 'string' ? payload.id : `openai-${Date.now()}`,
            model: typeof payload.model === 'string' ? payload.model : provider.model,
          },
        }
      }
      const chunkUsage = readOpenAiUsage(payload.usage)
      if (chunkUsage) {
        state.usage = chunkUsage
        result.usage = chunkUsage
      }
      const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
      if (!isRecord(choice)) {
        continue
      }
      if (choice.finish_reason) {
        result.stopReason = readStopReason(choice.finish_reason)
        result.terminated = true
      }
      if (!isRecord(choice.delta)) {
        continue
      }
      const { delta } = choice
      const reasoning = textOf(delta.reasoning_content ?? delta.reasoning ?? delta.thinking)
      if (reasoning) {
        if (current?.type !== 'thinking') {
          const stop = closeBlock()
          if (stop) {
            yield stop
          }
          current = { type: 'thinking', index: nextIndex++ }
          yield {
            type: 'content_block_start',
            index: current.index,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: current.index,
          delta: { type: 'thinking_delta', thinking: reasoning },
        }
      }
      const content = textOf(delta.content)
      if (content) {
        result.text += content
        if (current?.type !== 'text') {
          const stop = closeBlock()
          if (stop) {
            yield stop
          }
          current = { type: 'text', index: nextIndex++ }
          yield {
            type: 'content_block_start',
            index: current.index,
            content_block: { type: 'text', text: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: current.index,
          delta: { type: 'text_delta', text: content },
        }
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const item of delta.tool_calls) {
          if (!isRecord(item)) {
            continue
          }
          const index = typeof item.index === 'number' ? item.index : 0
          const call = partialToolCalls.get(index) ?? { id: '', name: '', arguments: '' }
          if (typeof item.id === 'string') {
            call.id = item.id
          }
          if (isRecord(item.function)) {
            if (typeof item.function.name === 'string') {
              call.name += item.function.name
            }
            if (typeof item.function.arguments === 'string') {
              call.arguments += item.function.arguments
            }
          }
          partialToolCalls.set(index, call)
        }
      }
    }
  } finally {
    // 读取被中止时也把已开始的块收尾，调用方会按停止处理。
    const stop = closeBlock()
    if (stop) {
      // 生成器在 finally 中不能安全 yield；中止时直接丢弃这个事件。
      if (!signal.aborted) {
        yield stop
      }
    }
  }

  result.toolCalls = [...partialToolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter((call) => !!call.name)
}

const SYNTHETIC_SEARCH_TOOL_ID = 'deepseek_web_search'

/**
 * POST {base}/v1/chat/completions（stream: true）。
 * 当第三方模型要求调用 deepseek_web_search 时，用 DeepSeek 服务端搜索执行，
 * 把结果作为内部 server_tool_use / web_search_tool_result 块展示，并把结果回传给模型，
 * 然后继续请求，直到模型给出最终回答。
 */
async function* streamOpenAiMessage(
  provider: ApiProvider & { model: string },
  body: CreateMessageRequest,
  signal: AbortSignal,
  search?: WebSearchExecutor
): AsyncGenerator<MessageStreamEvent> {
  const messages = toOpenAiMessages(body)
  const state: OpenAiStreamState = { started: false }
  let usage: MessageUsage | undefined
  let finalStop: StopReason = 'end_turn'
  let terminated = false
  /** 最多执行两轮搜索；之后关闭工具，让模型基于已有结果收尾。 */
  const MAX_SEARCH_ROUNDS = 2

  for (let round = 0; round <= MAX_SEARCH_ROUNDS; round += 1) {
    const canSearch = !!search && round < MAX_SEARCH_ROUNDS
    const tools = canSearch ? [WEB_SEARCH_TOOL] : undefined
    const result: OpenAiRoundResult = {
      text: '',
      toolCalls: [],
      stopReason: 'end_turn',
      terminated: false,
    }
    try {
      yield* streamOpenAiRound(
        provider,
        { model: provider.model || body.model, messages, tools },
        signal,
        state,
        result
      )
    } catch (error) {
      // 部分 OpenAI 兼容服务不支持 tools；在尚未输出任何内容时退回普通对话。
      if (
        tools &&
        !state.started &&
        error instanceof ApiError &&
        (error.status === 400 || error.status === 422)
      ) {
        result.text = ''
        result.toolCalls = []
        result.stopReason = 'end_turn'
        result.terminated = false
        result.usage = undefined
        yield* streamOpenAiRound(
          provider,
          { model: provider.model || body.model, messages, tools: undefined },
          signal,
          state,
          result
        )
      } else {
        throw error
      }
    }
    if (result.usage) {
      usage = result.usage
    }
    if (result.toolCalls.length === 0) {
      finalStop = result.stopReason
      terminated = result.terminated
      break
    }
    if (!canSearch || !search) {
      finalStop = 'tool_use'
      terminated = result.terminated
      break
    }

    // 只处理我们声明的搜索工具；个别服务会重复下发 name，统一成工具名。
    const calls = result.toolCalls
      .filter((call) => call.name.includes(SYNTHETIC_SEARCH_TOOL_ID))
      .map((call, index) => ({
        ...call,
        name: SYNTHETIC_SEARCH_TOOL_ID,
        id: call.id || `${SYNTHETIC_SEARCH_TOOL_ID}-${Date.now()}-${index}`,
      }))
    if (calls.length === 0) {
      finalStop = 'tool_use'
      terminated = result.terminated
      break
    }
    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    })

    for (const call of calls) {
      const queries = readQueries(call.arguments)
      let results: WebSearchResult[] = []
      let failed = queries.length === 0
      if (!failed) {
        try {
          results = await search(queries, signal)
          failed = results.length === 0
        } catch (error) {
          if (signal.aborted) {
            throw error
          }
          failed = true
        }
      }
      const content: WebSearchToolResultBlock['content'] = failed
        ? [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }]
        : results
      // 合成与 DeepSeek 服务端工具一致的内容块，复用搜索步骤、来源和搜索结果面板。
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'server_tool_use',
          id: call.id,
          name: 'deepseek_web_search',
          input: {
            action: 'search',
            query: queries[0] ?? '',
            queries,
          },
          caller: { type: 'direct' },
          kind: 'search',
        },
      }
      yield { type: 'content_block_stop', index: 0 }
      yield {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: call.id,
          content,
          kind: 'search',
        },
      }
      yield { type: 'content_block_stop', index: 1 }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: failed ? JSON.stringify({ results: [] }) : searchResultPayload(results),
      })
    }
  }

  if (!state.started) {
    throw new ApiError('interrupted', '')
  }
  if (!terminated) {
    throw new ApiError('interrupted', '')
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: finalStop, stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}

/** 根据接口格式选择 Anthropic 兼容或 OpenAI 兼容实现 */
export async function* streamMessage(
  provider: ApiProvider & { model: string },
  body: CreateMessageRequest,
  signal: AbortSignal,
  search?: WebSearchExecutor
): AsyncGenerator<MessageStreamEvent> {
  if (provider.format === 'openai') {
    yield* streamOpenAiMessage(provider, body, signal, search)
    return
  }
  yield* streamAnthropicMessage(provider, body, signal)
}
