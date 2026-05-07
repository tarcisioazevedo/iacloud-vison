/**
 * Onda 8.7 (docs/13) — Aplicação automática do tema do integrador via CSS vars.
 *
 * Como funciona:
 *   1. Carrega o tema via /me/integrador/theme (cacheado pelo SWR).
 *   2. Injeta CSS vars em document.documentElement: --icv-primary, --icv-accent,
 *      --icv-success, --icv-danger, --icv-radius, --icv-density.
 *   3. Define data-attributes no <html>: data-icv-font, data-icv-density, data-icv-radius.
 *   4. Injeta o link da fonte no <head> quando família != system.
 *
 * Uso: chamar uma vez no componente raiz autenticado (Layout / PortalLayout).
 * Roles permitidos pelo backend hoje: INTEGRADOR_ADMIN/TECNICO, SUPER_ADMIN/ADMIN_GLOBAL.
 * Para CLIENTE_* o `useMyIntegradorTheme()` não dispara — eles ficam no default
 * global (se quiser que clientes finais vejam o tema do integrador, é preciso
 * abrir o endpoint /me/integrador/theme pra esses roles ou expor um GET público
 * por tenant). SUPER_ADMIN/ADMIN_GLOBAL recebem dados mas não aplicam (multi-tenant).
 */
import { useEffect } from 'react'
import { useMyIntegradorTheme, type IntegradorTheme } from '../api/client'

type Theme = Pick<IntegradorTheme,
  'primaryColor' | 'accentColor' | 'successColor' | 'dangerColor' |
  'fontFamily' | 'density' | 'radius'
>

const FONT_HREFS: Record<string, string> = {
  'inter':       'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'inter-tight': 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&display=swap',
}

const FONT_FAMILY_CSS: Record<string, string> = {
  'inter':       '"Inter", system-ui, sans-serif',
  'inter-tight': '"Inter Tight", "Inter", system-ui, sans-serif',
  'system':      'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

const RADIUS_PX: Record<string, string> = {
  'soft':   '12px',
  'square': '2px',
}

const DENSITY_GAP: Record<string, string> = {
  'compact':     '0.5rem',
  'normal':      '0.75rem',
  'comfortable': '1.25rem',
}

/** Aplica os tokens de um tema no <html>. Reversível: chame com `null` (ou unmount) para limpar. */
function applyTheme(theme: Theme | null) {
  if (typeof document === 'undefined') return

  const html = document.documentElement
  if (!theme) {
    // Limpa as vars (volta pros defaults do CSS global)
    for (const key of [
      '--icv-primary', '--icv-accent', '--icv-success', '--icv-danger',
      '--icv-radius', '--icv-density-gap', '--icv-font',
    ]) html.style.removeProperty(key)
    html.removeAttribute('data-icv-font')
    html.removeAttribute('data-icv-density')
    html.removeAttribute('data-icv-radius')
    return
  }

  html.style.setProperty('--icv-primary',     theme.primaryColor)
  html.style.setProperty('--icv-accent',      theme.accentColor)
  html.style.setProperty('--icv-success',     theme.successColor)
  html.style.setProperty('--icv-danger',      theme.dangerColor)
  html.style.setProperty('--icv-radius',      RADIUS_PX[theme.radius] ?? '12px')
  html.style.setProperty('--icv-density-gap', DENSITY_GAP[theme.density] ?? '0.75rem')
  html.style.setProperty('--icv-font',        FONT_FAMILY_CSS[theme.fontFamily] ?? FONT_FAMILY_CSS.inter)

  html.setAttribute('data-icv-font',    theme.fontFamily)
  html.setAttribute('data-icv-density', theme.density)
  html.setAttribute('data-icv-radius',  theme.radius)

  // Injeta link da fonte (idempotente — o id evita duplicação)
  const href = FONT_HREFS[theme.fontFamily]
  const linkId = 'icv-font-link'
  const existing = document.getElementById(linkId) as HTMLLinkElement | null
  if (href) {
    if (existing) {
      if (existing.href !== href) existing.href = href
    } else {
      const link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
  } else if (existing) {
    existing.remove()
  }
}

export function useApplyIntegradorTheme() {
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  // Super-admin (multi-tenant) não aplica tema — usa o default global.
  // Apenas usuários atrelados a um tenant específico (integrador/cliente final) consomem.
  const shouldApply = !!role && role !== 'SUPER_ADMIN' && role !== 'ADMIN_GLOBAL'

  const { data } = useMyIntegradorTheme()

  useEffect(() => {
    if (!shouldApply) {
      applyTheme(null)
      return
    }
    if (data) applyTheme(data)
    return () => {
      // Cleanup ao desmontar (logout) — opcional
    }
  }, [data, shouldApply])
}
