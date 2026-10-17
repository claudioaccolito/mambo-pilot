import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
}

// evita lo schermo che si spegne mentre si pilota (se supportato)
document.addEventListener('pointerdown', () => {
  ;(navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock
    ?.request('screen')
    .catch(() => {})
}, { once: true })

// chiude le connessioni Bluetooth quando la pagina viene chiusa o ricaricata,
// così drone e FlyPad non restano occupati da una scheda vecchia
import { drone } from './lib/drone.svelte'
import { flypad } from './lib/flypad.svelte'
window.addEventListener('pagehide', () => {
  try { drone.disconnect() } catch {}
  try { flypad.disconnect() } catch {}
})

export default app
