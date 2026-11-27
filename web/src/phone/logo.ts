// The AskWise mark: a question that resolves into a confirmed answer.
let n = 0
export function logo(size: number): string {
  const id = `aw${n++}`
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="${id}q" x1="14" y1="6" x2="50" y2="58" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3d7bff"/><stop offset="1" stop-color="#4f9bff"/></linearGradient>
      <linearGradient id="${id}c" x1="22" y1="44" x2="46" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4fb4ff"/><stop offset="1" stop-color="#38d6f5"/></linearGradient>
    </defs>
    <path class="mark-q" d="M19 21a13 13 0 1 1 20.2 10.8C35.6 34.2 32 36.4 32 41" stroke="url(#${id}q)" stroke-width="7" stroke-linecap="round"/>
    <path class="mark-c" d="M24.5 51l5.5 5.5L41.5 45" stroke="url(#${id}c)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}
