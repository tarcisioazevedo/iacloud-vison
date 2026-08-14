/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Safelist — rede de segurança pra classes Tailwind construídas
  // dinamicamente em runtime (ex.: `bg-${color}-500`). O JIT do Tailwind
  // só ve o que está em texto literal no source; sem safelist essas
  // classes são purgadas no build de produção e os botões/badges saem
  // sem cor. Mantemos uma faixa restrita das cores realmente usadas
  // pelos componentes para não inflar o CSS final.
  // Estratégia preferida ainda é mapa estático em código (ver
  // COLOR_MAP nos componentes); este safelist cobre o que sobrou.
  safelist: [
    { pattern: /bg-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal|lime|fuchsia|slate)-(100|200|300|400|500|600|700)(\/(10|15|20|25|30|40|50|60|70))?/ },
    { pattern: /text-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal|lime|fuchsia|slate)-(100|200|300|400|500|600|700)/ },
    { pattern: /border-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal|lime|fuchsia|slate)-(200|300|400|500|600)(\/(10|20|30|40|50|60|70))?/ },
    { pattern: /from-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal)-(400|500|600)/ },
    { pattern: /to-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal)-(400|500|600)/ },
    { pattern: /ring-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal)-(400|500)/ },
    // Variants (hover, dark) precisam ser passados como `variants:` no safelist item
    {
      pattern: /bg-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal|slate)-(100|200|300|400|500)/,
      variants: ['hover'],
    },
    {
      pattern: /border-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal)-(400|500)/,
      variants: ['hover'],
    },
    {
      pattern: /text-(red|green|amber|cyan|violet|emerald|rose|sky|blue|indigo|purple|pink|orange|teal|slate)-(200|300|400)/,
      variants: ['dark'],
    },
  ],
  // darkMode 'class' permite alternar tema via toggle em runtime adicionando
  // a classe `dark` no <html>. Combina-se com prefixo `dark:` nas classes.
  // Sem isso, o Tailwind respeitaria SÓ a preferência do SO (prefers-color-scheme),
  // o que tira do operador a escolha entre claro (escritório) e escuro (NOC noturno).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── VSaaS brand (rebranding 2026-05) ──────────────────────────────
        // Mantemos `brand.*` como alias da nova paleta pra não quebrar
        // componentes existentes — todas as classes `brand-*` agora puxam
        // tons VSaaS (navy mais profundo, cyan mais saturado).
        vsaas: {
          navy:     '#001018',  // Base escura (fundo app dark, sidebar)
          deepNavy: '#003058',  // Surface elevada / gradiente sidebar
          cyan:     '#00C0D0',  // Primário — CTAs, links, accent
          tech:     '#0090D8',  // Secundário azul (gráficos, badges)
          aqua:     '#00D0A8',  // Sucesso/IA — heatmaps, gradiente
          teal:     '#017788',  // Gradiente intermediário
          lens:     '#493C7F',  // Roxo lavanda (gradient-lens, secondary)
          silver:   '#CDCED0',  // Texto secundário em dark
        },
        brand: {
          navy:      '#001018',
          navyLight: '#003058',
          sky:       '#00C0D0',
          skyLight:  '#0090D8',
          skyDeep:   '#017788',
          ink:       '#001018',
        },
        // Space escala mantida mas re-ancorada na paleta IA Cloud Vision
        space: {
          950: '#0A111F',  // brand.navy — fundo primário
          900: '#021724',
          850: '#111A2C',  // brand.navyLight — cards
          800: '#082B3B',
          700: '#0E3A4F',
          600: '#145B70',
        },
        // Cyan = padrão Tailwind (#06B6D4 etc.) — usado pelos mockups de
        // referência (`public/preview/*.html`). Pra acentos no azul da logo,
        // use `brand.sky` ou a escala `sky-*` do Tailwind.
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        emerald: {
          400: '#34d399',
          500: '#10b981',
        },
        rose: {
          400: '#fb7185',
          500: '#f43f5e',
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
        'glow-cyan':   'radial-gradient(ellipse at center, rgba(0,192,208,0.22) 0%, transparent 70%)',
        'glow-aqua':   'radial-gradient(ellipse at center, rgba(0,208,168,0.20) 0%, transparent 70%)',
        'glow-violet': 'radial-gradient(ellipse at center, rgba(73,60,127,0.18) 0%, transparent 70%)',
        'glow-sky':    'radial-gradient(ellipse at center, rgba(0,144,216,0.25) 0%, transparent 70%)',
        // VSaaS gradientes principais (referência: tokens.css do mockup)
        'brand-gradient': 'linear-gradient(135deg, #00C0D0 0%, #00D0A8 100%)',
        'vsaas-grad':     'linear-gradient(135deg, #00C0D0 0%, #00D0A8 100%)',
        'vsaas-lens':     'linear-gradient(135deg, #493C7F 0%, #00C0D0 100%)',
        'vsaas-deep':     'linear-gradient(135deg, #003058 0%, #001018 100%)',
        'vsaas-sidebar':  'linear-gradient(180deg, #003058 0%, #001018 100%)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 8s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'count-up': 'countUp 1s ease-out forwards',
        'fadeout': 'fadeout 1s ease forwards',
      },
      keyframes: {
        fadeout: {
          '0%':   { opacity: '0.5' },
          '100%': { opacity: '0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        glow: {
          from: { boxShadow: '0 0 10px rgba(0,144,216,0.35)' },
          to:   { boxShadow: '0 0 25px rgba(0,144,216,0.65), 0 0 50px rgba(0,144,216,0.22)' },
        },
      },
      boxShadow: {
        'glass': '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        'glass-hover': '0 8px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)',
        'cyan-glow': '0 0 20px rgba(0,192,208,0.45)',
        'sky-glow':  '0 0 24px rgba(0,144,216,0.55)',
        'violet-glow': '0 0 20px rgba(73,60,127,0.38)',
        'emerald-glow': '0 0 20px rgba(16,185,129,0.4)',
        'rose-glow': '0 0 20px rgba(244,63,94,0.4)',
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'Fira Code', 'monospace'],
        // Display VSaaS — Manrope nos títulos (brand wordmark, page headers).
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
