/**
 * chat-demo 的通用 CORS 代理（Cloudflare Worker）。
 *
 * 部署方式：
 * 1. 在 Cloudflare 创建 Worker；
 * 2. 将 TARGET_BASE 设为 API 服务根地址，例如
 *    https://developer.amd.com.cn/radeon/api
 * 3. 可选设置 ALLOWED_ORIGIN，例如
 *    https://xiaoshumiwm.github.io
 * 4. 把 Worker 地址 + /proxy 填入 chat-demo 的接口地址。
 *
 * 注意：这是一个服务端代理，不要把 ALLOWED_ORIGIN 留成 * 后公开分享，
 * 否则任何人都可以借你的 Worker 访问目标 API。
 */

const json = (status, body, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })

const normalizeTarget = (value) => {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('TARGET_BASE must use http:// or https://')
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '')
  return `${url.origin}${path}`
}

const setCors = (request, headers) => {
  const origin = request.headers.get('Origin') || '*'
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD')
  headers.set(
    'Access-Control-Allow-Headers',
    request.headers.get('Access-Control-Request-Headers') ||
      'Authorization, Content-Type, Accept, x-api-key, anthropic-beta'
  )
  headers.set('Access-Control-Max-Age', '86400')
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url)
    const corsHeaders = new Headers()
    setCors(request, corsHeaders)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const allowedOrigin = env.ALLOWED_ORIGIN || '*'
    const origin = request.headers.get('Origin')
    if (allowedOrigin !== '*' && origin !== allowedOrigin) {
      return json(403, { error: { message: 'Origin not allowed' } }, corsHeaders)
    }

    if (requestUrl.pathname !== '/proxy' && !requestUrl.pathname.startsWith('/proxy/')) {
      return json(404, { error: { message: 'Use /proxy/* for API requests' } }, corsHeaders)
    }

    if (!env.TARGET_BASE) {
      return json(500, { error: { message: 'TARGET_BASE is not configured' } }, corsHeaders)
    }

    let target
    try {
      const base = normalizeTarget(env.TARGET_BASE)
      const rest = requestUrl.pathname.slice('/proxy'.length)
      target = new URL(`${base}${rest}${requestUrl.search}`)
    } catch (error) {
      return json(
        500,
        { error: { message: error instanceof Error ? error.message : String(error) } },
        corsHeaders
      )
    }

    const headers = new Headers(request.headers)
    // 这些头只对浏览器与 Worker 之间有意义。
    for (const name of ['host', 'origin', 'referer', 'connection', 'cf-connecting-ip']) {
      headers.delete(name)
    }

    const init = { method: request.method, headers, redirect: 'follow' }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body
    }

    let upstream
    try {
      upstream = await fetch(target, init)
    } catch (error) {
      return json(
        502,
        { error: { message: `Proxy request failed: ${error instanceof Error ? error.message : error}` } },
        corsHeaders
      )
    }

    const responseHeaders = new Headers(upstream.headers)
    // 目标自己的 CORS 头可能不适合当前页面；由 Worker 统一覆盖。
    for (const key of [...responseHeaders.keys()]) {
      if (key.toLowerCase().startsWith('access-control-')) {
        responseHeaders.delete(key)
      }
    }
    setCors(request, responseHeaders)
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  },
}