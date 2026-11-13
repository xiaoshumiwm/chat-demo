#!/usr/bin/env node
/**
 * chat-demo 本地代理服务器。
 *
 * 用途：
 * - 托管 dist/ 静态文件；
 * - 把 /proxy/* 转发到目标 API，绕过浏览器 CORS 限制；
 * - 目标可以在启动时通过 TARGET_BASE / 命令行参数固定，也可以编码在路径里支持多个目标。
 *
 * 用法：
 *   pnpm build
 *   TARGET_BASE=https://developer.amd.com.cn/radeon/api pnpm proxy
 *   浏览器打开 http://127.0.0.1:8787
 *   设置中接口地址填 http://127.0.0.1:8787/proxy
 *
 * 多目标模式：
 *   http://127.0.0.1:8787/proxy/<base64url(目标服务根地址)>/...
 *
 * 注意：默认只监听 127.0.0.1，不要把它暴露到公网，否则会变成开放代理。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 8787)

/**
 * 规范目标服务根地址：去掉末尾斜杠，并去掉可能已经带上的 /v1，
 * 因为前端会自动拼接 /v1/models、/v1/chat/completions 或 /anthropic/v1。
 */
const normalizeTarget = (value) => {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Target must use http:// or https://')
  }
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '')
  return `${url.origin}${path}`
}

const targetFromEnv = process.env.TARGET_BASE || process.argv[2]
let fixedTarget = null
if (targetFromEnv) {
  fixedTarget = normalizeTarget(targetFromEnv)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.zip': 'application/zip',
}

const setCors = (req, res) => {
  const origin = req.headers.origin
  // 回显 Origin，兼容带 Cookie 的场景；没有 Origin 时用 *。
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD')
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ||
      'Authorization, Content-Type, Accept, x-api-key, anthropic-beta'
  )
  res.setHeader('Access-Control-Max-Age', '86400')
}

const targetFromRequest = (requestUrl) => {
  const parsed = new URL(requestUrl, `http://${host}:${port}`)
  if (parsed.pathname !== '/proxy' && !parsed.pathname.startsWith('/proxy/')) {
    return null
  }
  const rest = parsed.pathname.slice('/proxy'.length)
  if (fixedTarget) {
    return new URL(`${fixedTarget}${rest}${parsed.search}`)
  }
  if (rest === '' || rest === '/') {
    throw new Error('Missing target. Use /proxy/<base64url(target)>/... or set TARGET_BASE')
  }
  const end = rest.indexOf('/', 1)
  const segment = rest.slice(1, end === -1 ? undefined : end)
  const suffix = end === -1 ? '' : rest.slice(end)
  let decoded
  try {
    decoded = Buffer.from(segment, 'base64url').toString('utf8')
  } catch {
    throw new Error('Invalid base64url target')
  }
  return new URL(`${normalizeTarget(decoded)}${suffix}${parsed.search}`)
}

const forward = (req, res, target) => {
  const headers = { ...req.headers }
  // 这些头只对浏览器与代理之间有意义，转发到目标会干扰服务端判断。
  delete headers.host
  delete headers.origin
  delete headers.referer
  delete headers.connection
  delete headers['proxy-connection']
  headers.host = target.host

  const transport = target.protocol === 'https:' ? https : http
  const upstream = transport.request(target, { method: req.method, headers }, (upstreamRes) => {
    const status = upstreamRes.statusCode || 502
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      // 目标自己的 CORS 头不一定适合当前页面；由代理统一覆盖。
      if (key.toLowerCase().startsWith('access-control-')) {
        continue
      }
      if (key === 'connection' || key === 'transfer-encoding' || key === 'keep-alive') {
        continue
      }
      if (value !== undefined) {
        res.setHeader(key, value)
      }
    }
    setCors(req, res)
    res.statusCode = status
    console.log(`[proxy] ${req.method} ${target.pathname} -> ${status}`)
    upstreamRes.pipe(res)
  })

  upstream.on('error', (error) => {
    console.error(`[proxy] ${req.method} ${target.pathname} failed: ${error.message}`)
    if (!res.headersSent) {
      setCors(req, res)
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message: `Proxy request failed: ${error.message}` } }))
    } else {
      res.destroy(error)
    }
  })

  // 浏览器停止生成时，及时关闭到目标服务的连接。
  res.on('close', () => {
    if (!res.writableEnded) {
      upstream.destroy()
    }
  })
  req.pipe(upstream)
}

const serveStatic = (req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname)
  } catch {
    res.statusCode = 400
    res.end('Bad request')
    return
  }
  if (pathname === '/') {
    pathname = '/index.html'
  }
  let file = resolve(root, `.${pathname}`)
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = join(file, 'index.html')
  }
  if (!existsSync(file)) {
    // 静态资源不存在时回退到单页入口；API 路径已在前面处理。
    if (extname(pathname)) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    file = join(root, 'index.html')
  }
  if (!existsSync(file)) {
    res.statusCode = 404
    res.end('dist/index.html not found. Run pnpm build first.')
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(req, res)
    res.statusCode = 204
    res.end()
    return
  }
  const method = req.method || 'GET'
  try {
    const target = targetFromRequest(req.url || '/')
    if (target) {
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        method !== 'POST' &&
        method !== 'PUT' &&
        method !== 'PATCH' &&
        method !== 'DELETE'
      ) {
        res.statusCode = 405
        res.end('Method not allowed')
        return
      }
      forward(req, res, target)
      return
    }
  } catch (error) {
    setCors(req, res)
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } })
    )
    return
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }
  serveStatic(req, res)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set PORT to another value.`)
  } else {
    console.error(error)
  }
  process.exit(1)
})

server.listen(port, host, () => {
  if (!existsSync(join(root, 'index.html'))) {
    console.warn(`[proxy] ${join(root, 'index.html')} not found. Run pnpm build first.`)
  }
  console.log(`[proxy] chat-demo: http://${host}:${port}`)
  if (fixedTarget) {
    console.log(`[proxy] target: ${fixedTarget}`)
    console.log(`[proxy] use base URL: http://${host}:${port}/proxy`)
  } else {
    console.log(`[proxy] multi-target mode: http://${host}:${port}/proxy/<base64url(target)>/...`)
    console.log(
      "[proxy] example: node -e \"console.log('http://127.0.0.1:8787/proxy/'+Buffer.from(process.argv[1]).toString('base64url'))\" https://example.com/api"
    )
  }
})
