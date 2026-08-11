/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Fraunces"', "Georgia", "serif"],
        serif: ['"Fraunces"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // Couleur primaire = vert rgb(91,138,78)
        brand: {
          50: "#eef3ec",
          100: "#dce8d8",
          500: "#6fa15f",
          600: "#5b8a4e",
          700: "#496e3e",
        },
      },
    },
  },
  plugins: [],
};
