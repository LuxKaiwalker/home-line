// WP8a: start the web app (Vite DEV server, not a production build: not a heavy command) for the route
// harness. Live layer on (VITE_LIVE=1).
//   --api <origin>    VITE_API_BASE: the browser talks to this API origin directly (mock mode; the mock
//                     echoes the Origin for CORS)
//   --proxy <origin>  same-origin mode (real mode): VITE_API_BASE = this dev server, and Vite proxies
//                     /api/v1 to <origin> with the Origin header removed. The real API allows only the
//                     origins in config/backend.yaml api.cors_origins (localhost:5173, Pages), so a
//                     preview port 4200-4299 would otherwise be refused by the browser. Web security stays on.
//   --port <n>        4200-4299 (waypoint block rule); --web-dir <checkout>/web (default: this checkout's web/)
// WP8c (D110): VITE_SIM_EXPORT=1 (the "Send to simulator" control, as the live-demo build); --no-sim-export
// leaves it off. --sim-official <url>: while <web-dir>/public/sim/official/mission.json does not exist
// (WP9c not in the checkout under test), the dev server answers GET .../sim/official/mission.json with
// the document at <url> (mock mode: the mock's /__mock/sim/official/mission.json). An existing file wins.
// Prints "READY <url>" once listening. Stop with SIGTERM / SIGINT.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const port = Number(arg('--port', 4230))
if (!(port >= 4200 && port <= 4299)) throw new Error(`--port ${port}: the waypoint block uses Vite ports 4200-4299`)
const webDir = resolve(arg('--web-dir', resolve(HERE, '../../../web')))
const api = arg('--api', null)
const proxy = arg('--proxy', null)
if (!api === !proxy) throw new Error('give exactly one of --api <origin> or --proxy <origin>')

process.env.VITE_LIVE = '1'
process.env.VITE_API_BASE = api ?? `http://localhost:${port}`
delete process.env.VITE_LIVE_MOCK
if (process.argv.includes('--no-sim-export')) delete process.env.VITE_SIM_EXPORT
else process.env.VITE_SIM_EXPORT = '1'
const simOfficial = arg('--sim-official', null)
const simOfficialFile = join(webDir, 'public/sim/official/mission.json')
const simOfficialStandIn = simOfficial && !existsSync(simOfficialFile)
/** Dev-only stand-in for web/public/sim/official/mission.json (see the header). */
const simOfficialPlugin = {
  name: 'wp8c-sim-official-stand-in',
  configureServer(srv) {
    srv.middlewares.use(async (req, res, next) => {
      if (!simOfficialStandIn || req.method !== 'GET' || !/\/sim\/official\/mission\.json$/.test((req.url ?? '').split('?')[0])) return next()
      try {
        const r = await fetch(simOfficial)
        res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(await r.text())
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end(String(e))
      }
    })
  },
}

const { createServer } = await import(pathToFileURL(join(webDir, 'node_modules/vite/dist/node/index.js')).href)
const server = await createServer({
  root: webDir,
  configFile: join(webDir, 'vite.config.ts'),
  logLevel: 'warn',
  clearScreen: false,
  plugins: [simOfficialPlugin],
  server: {
    host: 'localhost',
    port,
    strictPort: true,
    hmr: false,
    ...(proxy
      ? {
          proxy: {
            '/api/v1': {
              target: proxy,
              changeOrigin: true,
              configure: (p) => p.on('proxyReq', (req) => req.removeHeader('origin')),
            },
          },
        }
      : {}),
  },
})
await server.listen()
console.log(`READY http://localhost:${port} (VITE_API_BASE=${process.env.VITE_API_BASE}${proxy ? `, proxy -> ${proxy}` : ''}, VITE_SIM_EXPORT=${process.env.VITE_SIM_EXPORT ?? 'off'}${simOfficialStandIn ? `, sim/official/mission.json <- ${simOfficial}` : ''})`)
const stop = async () => { await server.close(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
