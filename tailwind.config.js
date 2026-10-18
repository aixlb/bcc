/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './apps/bcc-desktop/src/renderer/index.html',
    './apps/bcc-desktop/src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 电影感深色调色板：纯黑底 + 暗金强调 + 胶片色
        ink: {
          950: '#08070a',
          900: '#0e0c11',
          800: '#15131a',
          700: '#1d1a23',
          600: '#26222c',
          500: '#332e3a',
        },
        film: {
          // 胶片暖色（取自 Kodak Portra / 35mm 暖橙）
          50: '#fff5e6',
          100: '#ffe8c4',
          200: '#f8c98a',
          300: '#e8a868',
          400: '#cf8443',
          500: '#a85f2a',
          600: '#7a3f1c',
        },
        accent: {
          // 暗金主色，类似 Linear/Arc 风格
          DEFAULT: '#d4a373',
          warm: '#e8b87e',
          cold: '#7eb8d4',
        },
      },
      fontFamily: {
        sans: [
          '"Segoe UI Variable"',  // Windows 11+
          '"Segoe UI"',           // Windows 10
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"Fira Code"',
          'Consolas',
          'Menlo',
          'monospace',
        ],
        script: [
          // 剧本字体：等宽 + 中文衬线（电影剧本传统）
          '"Source Han Serif SC"',
          '"Noto Serif CJK SC"',
          '"Songti SC"',
          'SimSun',
          'serif',
        ],
      },
      backgroundImage: {
        'film-grain': `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
        'vignette': 'radial-gradient(ellipse at center, transparent 0%, transparent 60%, rgba(0,0,0,0.6) 100%)',
        'gold-shimmer': 'linear-gradient(135deg, #d4a373 0%, #e8b87e 25%, #d4a373 50%, #b08858 75%, #d4a373 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer': 'shimmer 3s linear infinite',
        'scan': 'scan 2.5s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        scan: {
          '0%, 100%': { transform: 'translateY(-100%)', opacity: '0' },
          '50%': { transform: 'translateY(100%)', opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
}
