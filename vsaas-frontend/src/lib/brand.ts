/**
 * Constantes de branding do VSaaS.
 * Único ponto de verdade. Sempre que precisar de nome/domínio/email, use BRAND.
 *
 * White-label: integrador pode override via campos `whitelabel.*` no tenant.
 * Esse arquivo é o DEFAULT do fabricante.
 */
export const BRAND = {
  name: 'VSaaS',
  fullName: 'VSaaS · Videomonitoramento integrado como serviço',
  domain: 'vsaas.com.br',
  appUrl: 'https://app.vsaas.com.br',
  marketingUrl: 'https://vsaas.com.br',

  email: {
    contact: 'contato@vsaas.com.br',
    support: 'suporte@vsaas.com.br',
    sales:   'comercial@vsaas.com.br',
    noreply: 'noreply@vsaas.com.br',
    legal:   'legal@vsaas.com.br',
    privacy: 'privacidade@vsaas.com.br',
  },

  // Legado durante migração — remover quando rebrand completar
  legacyDomains: ['iacloud.com.br', 'iacloudvision.com.br'],
} as const

export type Brand = typeof BRAND
