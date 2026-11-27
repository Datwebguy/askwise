import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles.css'
import { onSessionChange } from './api.ts'
import { tracker } from './tracker.ts'
import { resetPhoneSession, route, startPhone } from './phone/app.ts'
import { startGlasses } from './glasses/controller.ts'

const root = document.querySelector<HTMLElement>('#app')!

onSessionChange(() => {
  resetPhoneSession()
  void tracker.refresh()
  void route(root)
})

startPhone(root)
void tracker.refresh()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void tracker.refresh()
})
window.addEventListener('online', () => void tracker.refresh())

// The glasses experience starts only inside the Even Realities app.
void startGlasses(tracker)
