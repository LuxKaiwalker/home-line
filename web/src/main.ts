// HOMELINE web app entry point (WS5 owns web/ except src/hud, src/fp3d, src/nav).
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
if (app) {
  app.textContent = 'HOMELINE'
}
