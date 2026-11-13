import { formatDate } from '../utils/format.js'
import {
  detectApiFormat,
  isValidBaseUrl,
  normalizeBaseUrl,
  type ApiFormat,
} from './api/provider.js'
import { setApiSettings, setDeepseekSettings, useSettings } from './settings.js'

/** 配置文件的当前版本；读取时只使用认识的字段，较新的版本也尽力导入。 */
export const PROVIDER_CONFIG_VERSION = 1

type ApiConfigJson = {
  baseUrl: string
  apiKey: string | null
  format: ApiFormat
  model: string
  models: string[]
}

type DeepseekConfigJson = {
  baseUrl: string
  apiKey: string | null
}

type ProviderConfigJson = {
  version: number
  api: ApiConfigJson
  deepseek: DeepseekConfigJson
}

/** 导入结果的提示：只包含被忽略的字段名，由界面翻译成当前语言。 */
export type ProviderImportResult = {
  imported: boolean
  warnings: string[]
}

export class ProviderConfigError extends Error {
  constructor(readonly key: 'providerConfigInvalid') {
    super(key)
    this.name = 'ProviderConfigError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const exportProviderConfig = (): { name: string; blob: Blob } => {
  const { apiBaseUrl, apiKey, apiFormat, model, models, deepseekBaseUrl, deepseekApiKey } =
    useSettings.getState()
  const data: ProviderConfigJson = {
    version: PROVIDER_CONFIG_VERSION,
    api: {
      baseUrl: apiBaseUrl,
      apiKey,
      format: apiFormat,
      model,
      models,
    },
    deepseek: {
      baseUrl: deepseekBaseUrl,
      apiKey: deepseekApiKey,
    },
  }
  return {
    name: `chat-demo-config-${formatDate(new Date()) ?? 'export'}.json`,
    blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  }
}

type PartialApi = Partial<ApiConfigJson>
type PartialDeepseek = Partial<DeepseekConfigJson>

const readString = (value: unknown, field: string, warnings: string[]): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    warnings.push(field)
    return undefined
  }
  return value
}

const readApiKey = (
  value: unknown,
  field: string,
  warnings: string[]
): string | null | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    warnings.push(field)
    return undefined
  }
  return value.trim() || null
}

const readFormat = (value: unknown, field: string, warnings: string[]): ApiFormat | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value === 'deepseek' || value === 'openai') {
    return value
  }
  warnings.push(field)
  return undefined
}

const readModels = (value: unknown, field: string, warnings: string[]): string[] | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    warnings.push(field)
    return undefined
  }
  const models = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => !!item)
  if (models.length !== value.length) {
    warnings.push(field)
  }
  return [...new Set(models)]
}

const knownApiFields = new Set(['baseUrl', 'apiKey', 'format', 'model', 'models'])
const knownDeepseekFields = new Set(['baseUrl', 'apiKey'])

const readApi = (value: unknown, warnings: string[]): PartialApi => {
  if (!isRecord(value)) {
    return {}
  }
  for (const key of Object.keys(value)) {
    if (!knownApiFields.has(key)) {
      warnings.push(`api.${key}`)
    }
  }
  const result: PartialApi = {}
  const baseUrl = readString(value.baseUrl, 'api.baseUrl', warnings)
  if (baseUrl !== undefined) {
    if (isValidBaseUrl(baseUrl)) {
      result.baseUrl = normalizeBaseUrl(baseUrl)
    } else {
      warnings.push('api.baseUrl')
    }
  }
  const apiKey = readApiKey(value.apiKey, 'api.apiKey', warnings)
  if (apiKey !== undefined) {
    result.apiKey = apiKey
  }
  const format = readFormat(value.format, 'api.format', warnings)
  if (format) {
    result.format = format
  }
  const model = readString(value.model, 'api.model', warnings)
  if (model !== undefined) {
    result.model = model
  }
  const models = readModels(value.models, 'api.models', warnings)
  if (models !== undefined) {
    result.models = models
  }
  return result
}

const readDeepseek = (value: unknown, warnings: string[]): PartialDeepseek => {
  if (!isRecord(value)) {
    return {}
  }
  for (const key of Object.keys(value)) {
    if (!knownDeepseekFields.has(key)) {
      warnings.push(`deepseek.${key}`)
    }
  }
  const result: PartialDeepseek = {}
  const baseUrl = readString(value.baseUrl, 'deepseek.baseUrl', warnings)
  if (baseUrl !== undefined) {
    if (isValidBaseUrl(baseUrl)) {
      result.baseUrl = normalizeBaseUrl(baseUrl)
    } else {
      warnings.push('deepseek.baseUrl')
    }
  }
  const apiKey = readApiKey(value.apiKey, 'deepseek.apiKey', warnings)
  if (apiKey !== undefined) {
    result.apiKey = apiKey
  }
  return result
}

const knownRootFields = new Set([
  'version',
  'api',
  'deepseek',
  // 兼容扁平写法
  'baseUrl',
  'apiKey',
  'format',
  'model',
  'models',
  'deepseekBaseUrl',
  'deepseekApiKey',
])

/**
 * 尽力导入：版本过新、未知字段或字段类型不正确时只丢弃该字段并返回字段名，
 * 其余能识别的配置继续生效。没有可识别字段时 imported 为 false。
 */
export const importProviderConfig = async (file: File): Promise<ProviderImportResult> => {
  const text = await file.text()
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ProviderConfigError('providerConfigInvalid')
  }
  if (!isRecord(value)) {
    throw new ProviderConfigError('providerConfigInvalid')
  }

  const warnings: string[] = []
  for (const key of Object.keys(value)) {
    if (!knownRootFields.has(key)) {
      warnings.push(key)
    }
  }
  if (
    value.version !== undefined &&
    (typeof value.version !== 'number' || value.version > PROVIDER_CONFIG_VERSION)
  ) {
    warnings.push('version')
  }

  const api = isRecord(value.api)
    ? readApi(value.api, warnings)
    : readApi(
        {
          baseUrl: value.baseUrl,
          apiKey: value.apiKey,
          format: value.format,
          model: value.model,
          models: value.models,
        },
        warnings
      )
  const deepseek = isRecord(value.deepseek)
    ? readDeepseek(value.deepseek, warnings)
    : readDeepseek({ baseUrl: value.deepseekBaseUrl, apiKey: value.deepseekApiKey }, warnings)

  const current = useSettings.getState()
  const hasApi = Object.keys(api).length > 0
  const hasDeepseek = Object.keys(deepseek).length > 0
  if (!hasApi && !hasDeepseek) {
    return { imported: false, warnings }
  }

  if (hasApi) {
    const baseUrl = api.baseUrl ?? current.apiBaseUrl
    setApiSettings({
      baseUrl,
      apiKey: api.apiKey !== undefined ? api.apiKey : current.apiKey,
      format: api.format ?? (api.baseUrl ? detectApiFormat(baseUrl) : current.apiFormat),
      model: api.model !== undefined ? api.model : current.model,
      models: api.models !== undefined ? api.models : current.models,
    })
  }
  if (hasDeepseek) {
    setDeepseekSettings(
      deepseek.baseUrl ?? current.deepseekBaseUrl,
      deepseek.apiKey !== undefined ? deepseek.apiKey : current.deepseekApiKey
    )
  }
  return { imported: true, warnings }
}
