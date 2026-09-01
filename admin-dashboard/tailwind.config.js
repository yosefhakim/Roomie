/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f1115',
          raised: '#161922',
          overlay: '#1e222d',
          border: '#2a2f3d',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#8f72ff',
          muted: '#2f2a4f',
        },
        success: '#3ecf8e',
        warning: '#f5a524',
        danger: '#f5455c',
        textprimary: '#eceef2',
        textsecondary: '#9aa1b0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
      },
    },
  },
  plugins: [],
};
