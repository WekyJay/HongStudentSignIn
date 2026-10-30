import { defineConfig, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  theme: {
    borderRadius: {
      sm: 'calc(var(--radius) - 4px)',
      md: 'calc(var(--radius) - 2px)',
      lg: 'var(--radius)',
      xl: 'calc(var(--radius) + 4px)'
    },
    boxShadow: {
      'hs-card': '0 4px 18px rgba(40, 77, 130, 0.05)',
      'hs-hover': '0 7px 22px rgba(34, 83, 154, 0.1)',
      'hs-float': '0 14px 46px rgba(29, 63, 117, 0.13)'
    },
    colors: {
      background: 'hsl(var(--background))',
      foreground: 'hsl(var(--foreground))',
      card: 'hsl(var(--card))',
      'card-foreground': 'hsl(var(--card-foreground))',
      primary: 'hsl(var(--primary))',
      'primary-foreground': 'hsl(var(--primary-foreground))',
      secondary: 'hsl(var(--secondary))',
      'secondary-foreground': 'hsl(var(--secondary-foreground))',
      muted: 'hsl(var(--muted))',
      'muted-foreground': 'hsl(var(--muted-foreground))',
      accent: 'hsl(var(--accent))',
      'accent-foreground': 'hsl(var(--accent-foreground))',
      destructive: 'hsl(var(--destructive))',
      'destructive-foreground': 'hsl(var(--destructive-foreground))',
      border: 'hsl(var(--border))',
      input: 'hsl(var(--input))',
      ring: 'hsl(var(--ring))',
      brand: {
        50: '#eaf2ff',
        100: '#dce8ff',
        500: '#3e83fa',
        600: '#3478f6',
        700: '#236bdc'
      },
      gray: {
        50: '#f5f8fd',
        100: '#eef3fa',
        200: '#e0e9f6',
        300: '#d8e3f2',
        400: '#8297b0',
        500: '#7186a4',
        600: '#50648a',
        700: '#213455',
        800: '#17345e',
        900: '#12254a'
      },
      ink: '#12254a',
      muted: '#50648a',
      hong: {
        primary: '#3478f6',
        fill: '#eef6ff',
        border: '#e6eef8',
        subtle: '#50648a'
      }
    }
  },
  shortcuts: {
    'btn-primary':
      'inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50',
    'btn-secondary':
      'inline-flex items-center justify-center rounded-xl bg-brand-50 px-5 py-3 font-semibold text-brand-700 transition hover:bg-brand-100',
    'card-base': 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm',
    'field-base':
      'w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-ink outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-100',
    'field-label': 'mb-2 block text-sm font-semibold text-slate-700'
  }
})
