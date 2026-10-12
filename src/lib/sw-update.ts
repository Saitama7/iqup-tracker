import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'

const UPDATE_TOAST_ID = 'sw-update'

function reload() {
  window.location.reload()
}

/** Sticky «Доступна новая версия — Обновить»; the button is a 44 px tap target. */
export function showUpdateToast() {
  toast('Доступна новая версия', {
    id: UPDATE_TOAST_ID,
    duration: Infinity,
    action: { label: 'Обновить', onClick: reload },
    classNames: { actionButton: 'h-11! px-4! text-sm! font-extrabold!' },
  })
}

/**
 * Service worker of a new deploy activates at once (skipWaiting + clientsClaim, vite.config.ts),
 * so a new tab already runs the new bundle. A tab that was open keeps the old JS in memory: instead
 * of the plugin's forced reload (would drop a half-filled form) it gets the update toast (#56).
 */
export function registerAppServiceWorker() {
  // A lazy route chunk the new deploy no longer has: TanStack Router reloads once by itself
  // (lazyRouteComponent), a second failure lands on RouteError with «Обновить приложение».
  registerSW({ immediate: true, onNeedReload: showUpdateToast })
}
