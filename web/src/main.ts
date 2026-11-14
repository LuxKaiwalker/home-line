// HOMELINE web app entry point (WS5 owns web/ except src/hud, src/fp3d, src/nav).
import './style.css'
import { DATA_MODE, IS_DEV } from './env'
import { clearUnbacked, onUnbackedChange, unbackedNumbers } from './prov/store'
import { href, NAV_ITEMS, parseRoute, type Route } from './router'
import { VIEWS } from './views'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#/">HOMELINE</a>
    <nav class="topnav"></nav>
  </header>
  <div class="dummy-banner" hidden>DUMMY DATA · synthetic world, not Mars results · never capture</div>
  <main class="outlet"></main>`

const nav = app.querySelector<HTMLElement>('.topnav')!
for (const item of NAV_ITEMS) {
  const a = document.createElement('a')
  a.href = href(item.route)
  a.textContent = item.label
  a.dataset.route = item.route.name
  nav.append(a)
}
app.querySelector<HTMLElement>('.dummy-banner')!.hidden = DATA_MODE !== 'dummy'
document.body.classList.toggle('is-dummy', DATA_MODE === 'dummy')
document.body.classList.toggle('is-dev', IS_DEV)

// Dev-mode check (brief WS5 tests): every displayed number must have a manifest entry.
if (IS_DEV) {
  const badge = document.createElement('button')
  badge.className = 'prov-badge'
  badge.hidden = true
  badge.title = 'Numbers on this page without a manifest.json entry (click to log them)'
  badge.addEventListener('click', () => console.table(unbackedNumbers()))
  app.querySelector('.topbar')!.append(badge)
  onUnbackedChange(() => {
    const n = unbackedNumbers().length
    badge.hidden = n === 0
    badge.textContent = `${n} number${n === 1 ? '' : 's'} without manifest entry`
  })
}

const outlet = app.querySelector<HTMLElement>('.outlet')!
let cleanup: (() => void) | undefined
let renderSeq = 0

async function render(): Promise<void> {
  const seq = ++renderSeq
  const route: Route = parseRoute(location.hash)
  cleanup?.()
  cleanup = undefined
  clearUnbacked()
  outlet.replaceChildren()
  outlet.dataset.route = route.name
  document.body.dataset.route = route.name
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('active', a.dataset.route === route.name)
  try {
    const view = await VIEWS[route.name]()
    if (seq !== renderSeq) return
    const c = await view(outlet, route)
    if (seq !== renderSeq) {
      c?.()
      return
    }
    cleanup = c ?? undefined
  } catch (err) {
    console.error(err)
    if (seq !== renderSeq) return
    const box = document.createElement('div')
    box.className = 'page error'
    box.textContent = `This view failed to load: ${err instanceof Error ? err.message : String(err)}`
    outlet.replaceChildren(box)
  }
}

window.addEventListener('hashchange', () => void render())
void render()
