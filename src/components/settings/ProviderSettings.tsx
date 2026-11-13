import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError, fetchModels } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  detectApiFormat,
  isValidBaseUrl,
  normalizeBaseUrl,
  type ApiFormat,
} from '../../services/api/provider.js'
import {
  exportProviderConfig,
  importProviderConfig,
  ProviderConfigError,
} from '../../services/providerBackup.js'
import { setApiSettings, setDeepseekSettings, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

type Status = { text: string; error?: boolean } | null

const describeError = (error: unknown, t: ReturnType<typeof useTranslate>): string => {
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return t('apiKeyInvalid')
    case 'network':
      return t('commonNetworkErrorToast')
    default:
      return error instanceof ApiError && error.localMessage
        ? t(error.localMessage.key, error.localMessage.params)
        : error instanceof Error
          ? error.message
          : String(error)
  }
}

/** 对话接口与可选的 DeepSeek 扩展接口配置 */
export const ProviderSettings = () => {
  const t = useTranslate()
  const datalistId = useId()
  const savedBaseUrl = useSettings((state) => state.apiBaseUrl)
  const savedApiKey = useSettings((state) => state.apiKey)
  const savedFormat = useSettings((state) => state.apiFormat)
  const savedModel = useSettings((state) => state.model)
  const savedModels = useSettings((state) => state.models)
  const savedDeepseekBaseUrl = useSettings((state) => state.deepseekBaseUrl)
  const savedDeepseekApiKey = useSettings((state) => state.deepseekApiKey)

  const [baseUrl, setBaseUrl] = useState(savedBaseUrl)
  const [apiKey, setApiKey] = useState(savedApiKey ?? '')
  const [format, setFormat] = useState<ApiFormat>(savedFormat)
  const [model, setModel] = useState(savedModel)
  const [models, setModels] = useState(savedModels)
  const [deepseekBaseUrl, setDeepseekBaseUrl] = useState(savedDeepseekBaseUrl)
  const [deepseekApiKey, setDeepseekApiKey] = useState(savedDeepseekApiKey ?? '')
  const [fetching, setFetching] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  // 导入配置或修改保存后，让表单跟随最新的持久化设置。
  useEffect(() => {
    setBaseUrl(savedBaseUrl)
    setApiKey(savedApiKey ?? '')
    setFormat(savedFormat)
    setModel(savedModel)
    setModels(savedModels)
    setDeepseekBaseUrl(savedDeepseekBaseUrl)
    setDeepseekApiKey(savedDeepseekApiKey ?? '')
  }, [
    savedBaseUrl,
    savedApiKey,
    savedFormat,
    savedModel,
    savedModels,
    savedDeepseekBaseUrl,
    savedDeepseekApiKey,
  ])

  const validate = (): string | null => {
    if (!isValidBaseUrl(baseUrl)) {
      return t('apiBaseUrlInvalid')
    }
    if (!apiKey.trim()) {
      return t('apiKeyRequired')
    }
    if (format === 'openai' && !model.trim()) {
      return t('apiModelRequired')
    }
    if (deepseekApiKey.trim() && !isValidBaseUrl(deepseekBaseUrl)) {
      return t('apiBaseUrlInvalid')
    }
    return null
  }

  const save = () => {
    const error = validate()
    if (error) {
      setStatus({ text: error, error: true })
      return
    }
    setApiSettings({
      baseUrl,
      apiKey: apiKey.trim() || null,
      format,
      model: model.trim() || (format === 'deepseek' ? DEFAULT_DEEPSEEK_MODEL : ''),
      models,
    })
    setDeepseekSettings(deepseekBaseUrl, deepseekApiKey.trim() || null)
    setStatus({ text: t('providerSaved') })
  }

  const loadModels = async () => {
    if (fetching) {
      return
    }
    if (!isValidBaseUrl(baseUrl)) {
      setStatus({ text: t('apiBaseUrlInvalid'), error: true })
      return
    }
    if (!apiKey.trim()) {
      setStatus({ text: t('apiKeyRequired'), error: true })
      return
    }
    setFetching(true)
    setStatus(null)
    try {
      const list = await fetchModels({
        baseUrl: normalizeBaseUrl(baseUrl),
        apiKey: apiKey.trim(),
        format,
      })
      setModels(list)
      if (!model.trim() && list.length > 0) {
        setModel(list[0])
      }
      setStatus({
        text: list.length > 0 ? t('modelsFetched', { count: list.length }) : t('modelsFetchedNone'),
      })
    } catch (error) {
      setStatus({
        text: t('modelsFetchFailed', { message: describeError(error, t) }),
        error: true,
      })
    } finally {
      setFetching(false)
    }
  }

  const formatOptions: { value: ApiFormat; label: string }[] = [
    { value: 'deepseek', label: t('apiFormatDeepSeek') },
    { value: 'openai', label: t('apiFormatOpenAI') },
  ]

  return (
    <div className={styles.provider}>
      <div className={styles.providerIntro}>
        <div className={styles.label}>{t('apiProviderTitle')}</div>
        <div className={styles.description}>{t('apiProviderDescription')}</div>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('apiBaseUrl')}</span>
        <input
          className={styles.textInput}
          value={baseUrl}
          placeholder={t('apiBaseUrlPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setBaseUrl(event.target.value)
            setStatus(null)
          }}
          onBlur={() => {
            // 地址变化时如果还没手动选择格式，按地址推断一次。
            const normalized = normalizeBaseUrl(baseUrl)
            if (
              normalized &&
              isValidBaseUrl(normalized) &&
              format === detectApiFormat(savedBaseUrl)
            ) {
              setFormat(detectApiFormat(normalized))
            }
          }}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('apiFormat')}</span>
        <Select
          ariaLabel={t('apiFormat')}
          value={format}
          options={formatOptions}
          onChange={(value) => {
            setFormat(value)
            setStatus(null)
          }}
        />
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('apiKeyLabel')}</span>
        <input
          className={styles.textInput}
          type="password"
          value={apiKey}
          placeholder={t('apiKeyPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setApiKey(event.target.value)
            setStatus(null)
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('apiModel')}</span>
        <input
          className={styles.textInput}
          value={model}
          list={datalistId}
          placeholder={t('apiModelPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setModel(event.target.value)
            setStatus(null)
          }}
        />
        <datalist id={datalistId}>
          {models.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <div className={styles.providerActions}>
        <Button variant="outlined" size="m" disabled={fetching} onClick={() => void loadModels()}>
          {fetching ? t('fetchingModels') : t('fetchModels')}
        </Button>
        <Button variant="primary" size="m" onClick={save}>
          {t('providerSave')}
        </Button>
      </div>
      {status ? (
        <div className={status.error ? styles.error : styles.description}>{status.text}</div>
      ) : null}

      <div className={styles.providerDivider} />
      <div className={styles.providerIntro}>
        <div className={styles.label}>{t('deepseekExtensionTitle')}</div>
        <div className={styles.description}>{t('deepseekExtensionDescription')}</div>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('deepseekBaseUrl')}</span>
        <input
          className={styles.textInput}
          value={deepseekBaseUrl}
          placeholder={DEFAULT_DEEPSEEK_BASE_URL}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setDeepseekBaseUrl(event.target.value)
            setStatus(null)
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('deepseekApiKey')}</span>
        <input
          className={styles.textInput}
          type="password"
          value={deepseekApiKey}
          placeholder={t('deepseekApiKeyPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setDeepseekApiKey(event.target.value)
            setStatus(null)
          }}
        />
      </label>
    </div>
  )
}

/** 配置导入导出：包含 API Key，只应在受信任的设备间使用。 */
export const ProviderConfigTransfer = () => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = () => {
    try {
      const { name, blob } = exportProviderConfig()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setStatus(null)
    } catch (error) {
      setStatus({
        text: t('providerConfigExportFailed', { message: describeError(error, t) }),
        error: true,
      })
    }
  }

  const onImport = async (file: File) => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await importProviderConfig(file)
      setStatus({
        text: !result.imported
          ? t('providerConfigNoChanges')
          : result.warnings.length > 0
            ? `${t('providerConfigImportedWithWarnings', { count: result.warnings.length })}: ${result.warnings
                .map((field) => t('providerConfigWarning', { field }))
                .join('; ')}`
            : t('providerConfigImported'),
        error: !result.imported,
      })
    } catch (error) {
      setStatus({
        text: t('providerConfigImportFailed', {
          message: error instanceof ProviderConfigError ? t(error.key) : describeError(error, t),
        }),
        error: true,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.providerTransfer}>
      <div className={styles.text}>
        <div className={styles.label}>{t('providerConfigTitle')}</div>
        <div className={styles.description}>{t('providerConfigExportDescription')}</div>
        <div className={styles.description}>{t('providerConfigImportDescription')}</div>
      </div>
      <div className={styles.providerActions}>
        <Button variant="outlined" size="m" onClick={onExport}>
          {t('providerConfigExport')}
        </Button>
        <Button
          variant="outlined"
          size="m"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {t('providerConfigImport')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void onImport(file)
            }
          }}
        />
      </div>
      {status ? (
        <div className={status.error ? styles.error : styles.description}>{status.text}</div>
      ) : null}
    </div>
  )
}
