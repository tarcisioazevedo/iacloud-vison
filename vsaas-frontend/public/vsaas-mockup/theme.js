// theme.js — toggle persistente entre dark e light.
// Aplica imediatamente para evitar flash, e injeta o FAB botão no canto.
(function () {
  const KEY = 'vsaas_mockup_theme'
  function get() { return localStorage.getItem(KEY) || 'dark' }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t)
    document.body && document.body.setAttribute('data-theme', t)
  }
  apply(get())

  document.addEventListener('DOMContentLoaded', function () {
    apply(get()) // re-apply após body existir

    if (document.querySelector('.vs-theme-toggle')) return // já existe (hub)
    const btn = document.createElement('button')
    btn.className = 'vs-theme-toggle'
    btn.title = 'Alternar tema claro/escuro'
    function refreshIcon() { btn.textContent = get() === 'dark' ? '☀️' : '🌙' }
    refreshIcon()
    btn.addEventListener('click', function () {
      const next = get() === 'dark' ? 'light' : 'dark'
      localStorage.setItem(KEY, next)
      apply(next); refreshIcon()
      // Notifica iframes (hub) para re-aplicarem
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ vsaasTheme: next }, '*') } catch {}
      })
    })
    document.body.appendChild(btn)
  })

  // Iframe escuta o pai (hub) e reaplica
  window.addEventListener('message', function (e) {
    if (e.data && e.data.vsaasTheme) {
      localStorage.setItem(KEY, e.data.vsaasTheme)
      apply(e.data.vsaasTheme)
    }
  })
})()
