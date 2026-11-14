// Minimal headless-Chromium driver over the DevTools protocol (no extra npm dependency), for the
// WS8 browser checks (skyline_probe.mjs, smoke.mjs). Needs Chromium (CHROMIUM env, default
// `chromium`); SwiftShader (software WebGL2) is enough.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function withChromium(fn, { width = 1600, height = 1000, gpu = false } = {}) {
  const chrome = process.env.CHROMIUM ?? 'chromium'
  const port = 9333 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(join(tmpdir(), 'fp3d-cdp-'))
  const flags = gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      ...flags,
      `--remote-debugging-port=${port}`,
      `--window-size=${width},${height}`,
      '--force-device-scale-factor=1',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )
  try {
    let page
    for (let i = 0; i < 50 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
      } catch {}
      if (!page) await sleep(200)
    }
    if (!page) throw new Error('chromium did not start')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => ws.addEventListener('open', r, { once: true }))
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    })
    const send = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id
        pending.set(i, r)
        ws.send(JSON.stringify({ id: i, method, params }))
      })
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
      return r.result?.result?.value
    }
    await send('Page.enable')
    try {
      return await fn({ send, evaluate })
    } finally {
      ws.close()
    }
  } finally {
    proc.kill()
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }
}
