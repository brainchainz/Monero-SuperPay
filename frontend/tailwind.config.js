/** @type {import('tailwindcss').Config} */

// Colors are driven by CSS variables (see src/index.css) so the in-app theme
// selector can re-skin every component without touching markup. Each variable
// holds a space-separated RGB triplet, e.g. "17 24 39".
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Foreground token. Dark themes keep this pure white; light themes
        // (Fintech) remap it to a dark ink so `text-white` stays readable.
        // QR backgrounds use literal bg-[#ffffff] so they are unaffected.
        white: v('--c-white'),
        gray: {
          200: v('--c-gray-200'),
          300: v('--c-gray-300'),
          400: v('--c-gray-400'),
          500: v('--c-gray-500'),
          600: v('--c-gray-600'),
          700: v('--c-gray-700'),
          750: v('--c-gray-750'),
          800: v('--c-gray-800'),
          900: v('--c-gray-900'),
        },
        monero: {
          300: v('--c-mon-300'),
          400: v('--c-mon-400'),
          500: v('--c-mon-500'),
          600: v('--c-mon-600'),
          700: v('--c-mon-700'),
          900: v('--c-mon-900'),
        },
      },
      fontFamily: {
        sans: ['var(--sp-font-ui)', 'system-ui', 'sans-serif'],
        mono: ['var(--sp-font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
