/*
 * ResearchAI - Neural RAG Research Assistant
 * Copyright (c) 2026 Perarasu Boopathirajan. All rights reserved.
 * Author: Perarasu Boopathirajan
 * Unauthorized copying, redistribution or claiming authorship of this file,
 * via any medium, is prohibited without written permission. See LICENSE.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        neu: {
          bg: '#e8edf3',
          light: '#ffffff',
          dark: '#c5ccd8',
          text: '#3b4558',
          muted: '#7d879a',
          accent: '#5b6cf9',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
