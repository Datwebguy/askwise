// Apply the saved or system theme before the page paints, so there is no flash.
try {
  var t = localStorage.getItem('askwise.theme')
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  document.documentElement.dataset.theme = t
} catch (e) {
  document.documentElement.dataset.theme = 'dark'
}
