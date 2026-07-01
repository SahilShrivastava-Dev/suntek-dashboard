/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Avatar gradient classes come from the DB (roles.avatar_from/_to) at runtime,
  // so Tailwind's scanner can't see them and would purge them → white avatars.
  // Safelist every gradient in AVATAR_PALETTE (src/lib/profiles.ts) + slate fallback.
  safelist: [
    'bg-gradient-to-br',
    'from-orange-300', 'to-orange-500',
    'from-blue-400', 'to-blue-600',
    'from-teal-400', 'to-teal-600',
    'from-indigo-400', 'to-indigo-600',
    'from-purple-400', 'to-purple-600',
    'from-lime-400', 'to-lime-600',
    'from-cyan-400', 'to-cyan-600',
    'from-fuchsia-400', 'to-fuchsia-600',
    'from-rose-400', 'to-rose-600',
    'from-amber-400', 'to-amber-600',
    'from-slate-300', 'to-slate-500',
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

