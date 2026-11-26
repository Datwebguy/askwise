// Small helpers for building the phone pages safely.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch])
}

/** Only web links are allowed as link targets. */
export function safeHref(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? esc(u.toString()) : '#'
  } catch {
    return '#'
  }
}

export function $(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el as HTMLElement
}

export function on(root: ParentNode, selector: string, event: string, handler: (e: Event, el: HTMLElement) => void): void {
  root.querySelectorAll(selector).forEach(el => el.addEventListener(event, e => handler(e, el as HTMLElement)))
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}
