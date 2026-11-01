import type { Config } from 'tailwindcss';

// Every colour is a CSS variable generated from the seed (lib/theme.ts). Never hardcode hex values here.
const roles = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'error', 'on-error', 'error-container', 'on-error-container',
  'surface', 'surface-container-lowest', 'surface-container-low', 'surface-container',
  'surface-container-high', 'surface-container-highest',
  'on-surface', 'on-surface-variant', 'outline', 'outline-variant',
  'inverse-surface', 'inverse-on-surface', 'inverse-primary', 'scrim',
  'expense', 'expense-container', 'on-expense-container',
  'income', 'income-container', 'on-income-container',
];

const colors: Record<string, string> = Object.fromEntries(
  roles.map((r) => [r, `var(--md-sys-color-${r})`]),
);
for (let i = 1; i <= 8; i++) {
  colors[`cat-${i}`] = `var(--cat-${i})`;
  colors[`cat-${i}-c`] = `var(--cat-${i}-c)`;
}

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    screens: {
      medium: '600px',
      expanded: '840px',
      large: '1200px',
    },
    extend: {
      colors,
      borderRadius: {
        'm3-xs': '4px',
        'm3-sm': '8px',
        'm3-md': '12px',
        'm3-lg': '16px',
        'm3-xl': '28px',
        'm3-2xl': '36px',
      },
      transitionTimingFunction: {
        emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
    },
  },
  plugins: [],
};

export default config;
