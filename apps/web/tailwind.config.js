/** @type {import('tailwindcss').Config} */

/**
 * Couleur pilotée par une variable CSS (voir les tokens dans src/index.css).
 * Les variables portent un triplet « R G B » pour que Tailwind puisse toujours
 * appliquer une opacité (`bg-brand-600/20`).
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // Sans-serif partout : les chiffres et les longues listes sont illisibles
        // en serif (règle 3 du design system).
        sans: ['"Instrument Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Instrument Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      /**
       * Échelle à 6 tailles, plancher à 13 px (`text-xs`). `text-2xs` (11 px) est
       * réservé aux étiquettes en majuscules, jamais à du texte courant.
       */
      fontSize: {
        // 11 — plus petite taille autorisée : étiquettes, badges, initiales.
        // Le texte courant, lui, ne descend pas sous `text-xs` (13).
        "2xs": ["0.6875rem", { lineHeight: "1.2" }],
        xs: ["0.8125rem", { lineHeight: "1.45" }], // 13 — méta (plancher)
        sm: ["0.875rem", { lineHeight: "1.45" }], // 14 — secondaire
        base: ["1rem", { lineHeight: "1.4" }], // 16 — ligne de liste
        lg: ["1.125rem", { lineHeight: "1.35" }], // 18
        xl: ["1.25rem", { lineHeight: "1.3" }], // 20 — sous-titre
        "2xl": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }], // 24
        "3xl": ["1.6875rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }], // 27 — titre
        "4xl": ["2rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }], // 32
        "5xl": ["2.375rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }], // 38 — gros montant
      },
      spacing: {
        // Cible tactile minimale (règle 6 du design system).
        tap: "2.75rem", // 44px
      },
      colors: {
        /**
         * Vert = action. La rampe s'inverse en sombre (700 plus clair que 600)
         * pour que `hover:bg-brand-700` reste un éclaircissement.
         */
        brand: {
          50: token("brand-50"),
          100: token("brand-100"),
          200: token("brand-200"),
          300: token("brand-300"),
          400: token("brand-400"),
          500: token("brand-500"),
          600: token("brand-600"),
          700: token("brand-700"),
          800: token("brand-800"),
          900: token("brand-900"),
        },
        /**
         * Rampe neutre du design system. On garde le nom `slate` : les ~1 400
         * usages existants (`dark:bg-slate-900`, `text-slate-400`…) basculent
         * sur la nouvelle palette sans toucher aux pages.
         */
        slate: {
          50: "#FAFAF8",
          100: "#F2F5F8", // texte principal (sombre)
          200: "#E2E7EC",
          300: "#C8D2DC",
          /**
           * 400 et 500 portent le texte secondaire, presque toujours écrit sans
           * variante `dark:` (≈ 580 usages). Une valeur figée serait forcément
           * sous 4.5:1 dans l'un des deux thèmes : elles suivent donc le thème.
           */
          400: token("c-slate-400"), // texte secondaire
          500: token("c-slate-500"), // texte secondaire appuyé
          600: "#5B6570",
          700: "#3D4650",
          800: "#1B2836", // surface élevée / bordure (sombre)
          900: "#131E2A", // carte (sombre)
          950: "#0B1219", // fond (sombre)
        },
        // Surfaces et encres — à préférer à `slate-*` dans le code neuf.
        surface: token("c-surface"),
        "surface-2": token("c-surface-2"),
        ink: token("c-ink"),
        "ink-2": token("c-ink-2"),
        "ink-3": token("c-ink-3"),
        line: token("c-line"),
        hairline: token("c-hairline"),
        // Texte posé sur un aplat vert (blanc en clair, presque noir en sombre).
        "on-brand": token("c-on-brand"),
        // Sémantique : rouge = argent qui sort, ambre = attention, bleu = info.
        danger: token("c-danger"),
        "danger-soft": token("c-danger-soft"),
        warning: token("c-warning"),
        "warning-soft": token("c-warning-soft"),
        info: token("c-info"),
        "info-soft": token("c-info-soft"),
      },
    },
  },
  plugins: [],
};
