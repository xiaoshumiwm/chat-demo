import { streamMessage } from './client.js'
import { DEFAULT_DEEPSEEK_MODEL, type ApiProvider } from './provider.js'
import type { WebSearchResult } from './types.js'

/**
 * 用 DeepSeek 的 deepseek_web_search 服务端工具执行一次搜索。
 * 只读取搜索结果块，收到结果后立即结束，不消费后续回答文本。
 */
export const searchWithDeepSeek = async (
  provider: ApiProvider,
  queries: string[],
  signal: AbortSignal
): Promise<WebSearchResult[]> => {
  const events = streamMessage(
    { ...provider, model: DEFAULT_DEEPSEEK_MODEL },
    {
      model: DEFAULT_DEEPSEEK_MODEL,
      system:
        'You are a web search assistant. Use the deepseek_web_search tool to find information for the user query. Do not answer from memory.',
      messages: [{ role: 'user', content: queries.map((query) => `- ${query}`).join('\n') }],
      thinking: { type: 'disabled' },
      tools: [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }],
      safety_check: { level: 'high' },
    },
    signal
  )
  const results: WebSearchResult[] = []
  for await (const event of events) {
    if (event.type === 'message_delta') {
      break
    }
    if (event.type !== 'content_block_start') {
      continue
    }
    const block = event.content_block
    if (block.type === 'web_search_tool_result') {
      for (const item of block.content) {
        if (
          item.type === 'web_search_result' &&
          !results.some((result) => result.url === item.url)
        ) {
          results.push(item)
        }
      }
      continue
    }
    // 开始生成正文说明搜索阶段已结束，提前结束以节省时间和 Token。
    if (block.type === 'text' || block.type === 'thinking') {
      break
    }
  }
  return results
}
