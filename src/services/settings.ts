import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  detectApiFormat,
  isValidBaseUrl,
  normalizeBaseUrl,
  type ApiFormat,
  type ApiProvider,
} from './api/provider.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API 配置、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  /** 对话接口的 API Key */
  apiKey: string | null
  /** 对话接口地址，默认 DeepSeek；也可以填 OpenAI 兼容服务的地址 */
  apiBaseUrl: string
  /** 对话接口格式 */
  apiFormat: ApiFormat
  /** 对话模型 */
  model: string
  /** 最近一次从 /v1/models 读到的模型列表，仅用于输入提示 */
  models: string[]
  /** 可选的 DeepSeek API Key：主接口不是 DeepSeek 时用于朗读、语音输入等扩展功能 */
  deepseekApiKey: string | null
  deepseekBaseUrl: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  apiBaseUrl: 'chat-demo:api-base-url',
  apiFormat: 'chat-demo:api-format',
  model: 'chat-demo:model',
  models: 'chat-demo:models',
  deepseekApiKey: 'chat-demo:deepseek-api-key',
  deepseekBaseUrl: 'chat-demo:deepseek-base-url',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialApiBaseUrl = (): string => {
  const saved = read(KEYS.apiBaseUrl)
  return saved !== null && isValidBaseUrl(saved) ? normalizeBaseUrl(saved) : DEFAULT_BASE_URL
}

const initialApiFormat = (): ApiFormat => {
  const saved = read(KEYS.apiFormat)
  return saved === 'deepseek' || saved === 'openai' ? saved : detectApiFormat(initialApiBaseUrl())
}

const initialModel = (): string => {
  const saved = read(KEYS.model)?.trim()
  if (saved) {
    return saved
  }
  // 旧的设置只有 API Key，没有模型字段；DeepSeek 默认使用 deepseek-flash。
  return initialApiFormat() === 'deepseek' ? DEFAULT_DEEPSEEK_MODEL : ''
}

const initialModels = (): string[] => {
  try {
    const value: unknown = JSON.parse(read(KEYS.models) ?? '[]')
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((item): item is string => typeof item === 'string' && !!item.trim())
          ),
        ]
      : []
  } catch {
    return []
  }
}

const initialDeepseekBaseUrl = (): string => {
  const saved = read(KEYS.deepseekBaseUrl)
  return saved !== null && isValidBaseUrl(saved)
    ? normalizeBaseUrl(saved)
    : DEFAULT_DEEPSEEK_BASE_URL
}

export const useSettings = create<Settings>(() => {
  const apiBaseUrl = initialApiBaseUrl()
  return {
    apiKey: read(KEYS.apiKey),
    apiBaseUrl,
    apiFormat: initialApiFormat(),
    model: initialModel(),
    models: initialModels(),
    deepseekApiKey: read(KEYS.deepseekApiKey),
    deepseekBaseUrl: initialDeepseekBaseUrl(),
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    thinking: read(KEYS.thinking) === 'true',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  }
})

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export type ApiSettings = {
  baseUrl: string
  apiKey: string | null
  format: ApiFormat
  model: string
  models?: string[]
}

/** 更新对话接口配置；主接口与扩展功能各自独立保存 */
export const setApiSettings = ({ baseUrl, apiKey, format, model, models }: ApiSettings) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedModels = [
    ...new Set((models ?? []).map((item) => item.trim()).filter((item) => !!item)),
  ]
  write(KEYS.apiBaseUrl, normalizedBaseUrl)
  write(KEYS.apiKey, apiKey?.trim() || null)
  write(KEYS.apiFormat, format)
  write(KEYS.model, model.trim() || null)
  write(KEYS.models, JSON.stringify(normalizedModels))
  useSettings.setState({
    apiBaseUrl: normalizedBaseUrl,
    apiKey: apiKey?.trim() || null,
    apiFormat: format,
    model: model.trim(),
    models: normalizedModels,
  })
}

export const setDeepseekSettings = (baseUrl: string, apiKey: string | null) => {
  const normalizedBaseUrl = isValidBaseUrl(baseUrl)
    ? normalizeBaseUrl(baseUrl)
    : DEFAULT_DEEPSEEK_BASE_URL
  write(KEYS.deepseekBaseUrl, normalizedBaseUrl)
  write(KEYS.deepseekApiKey, apiKey?.trim() || null)
  useSettings.setState({
    deepseekBaseUrl: normalizedBaseUrl,
    deepseekApiKey: apiKey?.trim() || null,
  })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

type ChatProvider = ApiProvider & { model: string }

/** 当前对话接口；缺少 Key 时返回 null */
export const getChatProvider = (): ChatProvider | null => {
  const { apiBaseUrl, apiKey, apiFormat, model } = useSettings.getState()
  return apiKey
    ? {
        baseUrl: apiBaseUrl,
        apiKey,
        format: apiFormat,
        model: model || (apiFormat === 'deepseek' ? DEFAULT_DEEPSEEK_MODEL : ''),
      }
    : null
}

/**
 * 朗读、语音输入等 DeepSeek 扩展功能使用的服务：
 * 主接口本身是 DeepSeek 时直接复用；否则使用单独配置的 DeepSeek API。
 */
export const getDeepSeekExtensionProvider = (): ApiProvider | null => {
  const { apiBaseUrl, apiKey, apiFormat, deepseekBaseUrl, deepseekApiKey } = useSettings.getState()
  if (apiFormat === 'deepseek' && apiKey) {
    return { baseUrl: apiBaseUrl, apiKey, format: 'deepseek' }
  }
  return deepseekApiKey
    ? { baseUrl: deepseekBaseUrl, apiKey: deepseekApiKey, format: 'deepseek' }
    : null
}

/**
 * 附件上传使用 DeepSeek Files API，因此只在主接口是 DeepSeek 时返回。
 * OpenAI 兼容接口没有 file_id：纯文本附件不上传，发送时把本地原件 Base64 内联进消息（见 canSendInline）。
 */
export const getAttachmentProvider = (): ApiProvider | null => {
  const { apiBaseUrl, apiKey, apiFormat } = useSettings.getState()
  return apiFormat === 'deepseek' && apiKey
    ? { baseUrl: apiBaseUrl, apiKey, format: 'deepseek' }
    : null
}
