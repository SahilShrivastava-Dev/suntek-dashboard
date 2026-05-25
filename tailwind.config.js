/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
      colors: {
        // Red tiles — Busy API financial data (L4)
        'tile-red': {
          bg: '#FEF2F2',
          border: '#FECACA',
          text: '#991B1B',
          badge: '#FEE2E2',
          dot: '#EF4444',
        },
        // Green tiles — Excel/CSV static data (L3)
        'tile-green': {
          bg: '#F0FDF4',
          border: '#BBF7D0',
          text: '#166534',
          badge: '#DCFCE7',
          dot: '#22C55E',
        },
        // Yellow tiles — Manual daily input (L1/L2)
        'tile-yellow': {
          bg: '#FFFBEB',
          border: '#FDE68A',
          text: '#92400E',
          badge: '#FEF3C7',
          dot: '#F59E0B',
        },
      },
    },
  },
  plugins: [],
}

