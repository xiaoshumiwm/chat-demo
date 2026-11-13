/**
 * API 供应商与地址工具。
 *
 * - deepseek：本应用原有的 Anthropic 兼容 Messages / Files 接口，支持搜索、标题等扩展；
 * - openai：通用的 OpenAI 兼容 Chat Completions 接口，仅保证文本对话与流式输出。
 *
 * baseUrl 既可以是不带版本号的地址（https://api.example.com），也可以是已经带 /v1 的地址。
 */

export type ApiFormat = 'deepseek' | 'openai'

export type ApiProvider = {
  baseUrl: string
  apiKey: string
  format: ApiFormat
}

/** 构建期注入的默认地址，同时也是未配置时的 DeepSeek 地址 */
export const DEFAULT_BASE_URL = __API_ORIGIN__
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash'

/** 去掉首尾空白和末尾斜杠；空串保持为空 */
export const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '')

/** 允许绝对 HTTP(S) 地址，也兼容构建时配置的相对路径 */
export const isValidBaseUrl = (value: string): boolean => {
  const url = normalizeBaseUrl(value)
  if (!url) {
    return false
  }
  if (url.startsWith('/')) {
    return !url.startsWith('//')
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const hostOf = (value: string): string | null => {
  try {
    return new URL(normalizeBaseUrl(value)).hostname
  } catch {
    return null
  }
}

/** 是否指向 DeepSeek 官方服务（含自定义构建时的默认地址） */
export const isDeepSeekBaseUrl = (value: string): boolean => {
  const url = normalizeBaseUrl(value)
  return (
    url === normalizeBaseUrl(DEFAULT_BASE_URL) ||
    hostOf(url) === 'api.deepseek.com' ||
    hostOf(url)?.endsWith('.deepseek.com') === true
  )
}

/** 未显式选择接口格式时，根据地址推断 */
export const detectApiFormat = (baseUrl: string): ApiFormat =>
  isDeepSeekBaseUrl(baseUrl) ? 'deepseek' : 'openai'

/** 去掉可能已经输入的 /v1 或 /anthropic/v1，得到服务根地址 */
const serviceRoot = (baseUrl: string): string => {
  const base = normalizeBaseUrl(baseUrl)
  if (/\/anthropic\/v1$/i.test(base)) {
    return base.replace(/\/anthropic\/v1$/i, '')
  }
  if (/\/anthropic$/i.test(base)) {
    return base.replace(/\/anthropic$/i, '')
  }
  if (/\/v1$/i.test(base)) {
    return base.replace(/\/v1$/i, '')
  }
  return base
}

/** OpenAI 风格接口的 /v1 根地址 */
export const v1BaseUrl = (baseUrl: string): string => `${serviceRoot(baseUrl)}/v1`

/** GET {base}/v1/models */
export const modelsUrl = (baseUrl: string): string => `${v1BaseUrl(baseUrl)}/models`

/** POST {base}/v1/chat/completions */
export const chatCompletionsUrl = (baseUrl: string): string =>
  `${v1BaseUrl(baseUrl)}/chat/completions`

/** DeepSeek Anthropic 兼容接口根地址 */
export const anthropicBaseUrl = (baseUrl: string): string => {
  const base = normalizeBaseUrl(baseUrl)
  if (/\/anthropic\/v1$/i.test(base)) {
    return base
  }
  if (/\/anthropic$/i.test(base)) {
    return `${base}/v1`
  }
  return `${serviceRoot(base)}/anthropic/v1`
}

/** DeepSeek 语音等工具接口：{base}/v1/tools */
export const toolsBaseUrl = (baseUrl: string): string => `${v1BaseUrl(baseUrl)}/tools`
