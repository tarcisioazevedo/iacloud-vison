/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // darkMode 'class' permite alternar tema via toggle em runtime adicionando
  // a classe `dark` no <html>. Combina-se com prefixo `dark:` nas classes.
  // Sem isso, o Tailwind respeitaria SÓ a preferência do SO (prefers-color-scheme),
  // o que tira do operador a escolha entre claro (escritório) e escuro (NOC noturno).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── IA Cloud Vision brand (extraído da logo oficial) ──────────────
        brand: {
          navy:      '#0A111F',  // Fundo principal (base escura da identidade)
          navyLight: '#111A2C',  // Painéis, cards e surfaces elevadas
          sky:       '#4A90E2',  // Azul da nuvem — destaques, gráficos, primário
          skyLight:  '#85B6F2',  // Hover states e gradientes suaves
          skyDeep:   '#2F6FBF',  // Active/pressed states
          ink:       '#0B1220',  // Glass card mais escuro (sidebars)
        },
        // Space escala mantida mas re-ancorada na paleta IA Cloud Vision
        space: {
          950: '#0A111F',  // brand.navy — fundo primário
          900: '#0D152A',
          850: '#111A2C',  // brand.navyLight — cards
          800: '#152138',
          700: '#1B2A47',
          600: '#243358',
        },
        // Cyan → re-definido como alias para brand.sky (azul da logo)
        cyan: {
          300: '#A7CBF5',
          400: '#85B6F2',  // brand.skyLight
          500: '#4A90E2',  // brand.sky — PRIMARY
          600: '#2F6FBF',  // brand.skyDeep
          700: '#1F5497',
        },
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
        'glow-cyan': 'radial-gradient(ellipse at center, rgba(74,144,226,0.18) 0%, transparent 70%)',
        'glow-violet': 'radial-gradient(ellipse at center, rgba(139,92,246,0.15) 0%, transparent 70%)',
        'glow-sky':   'radial-gradient(ellipse at center, rgba(74,144,226,0.25) 0%, transparent 70%)',
        'brand-gradient': 'linear-gradient(135deg, #4A90E2 0%, #85B6F2 100%)',
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
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        glow: {
          from: { boxShadow: '0 0 10px rgba(74,144,226,0.35)' },
          to:   { boxShadow: '0 0 25px rgba(74,144,226,0.65), 0 0 50px rgba(74,144,226,0.22)' },
        },
      },
      boxShadow: {
        'glass': '0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        'glass-hover': '0 8px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)',
        'cyan-glow': '0 0 20px rgba(74,144,226,0.45)',
        'sky-glow':  '0 0 24px rgba(74,144,226,0.55)',
        'violet-glow': '0 0 20px rgba(139,92,246,0.4)',
        'emerald-glow': '0 0 20px rgba(16,185,129,0.4)',
        'rose-glow': '0 0 20px rgba(244,63,94,0.4)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
