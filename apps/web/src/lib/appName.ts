/**
 * Nom affiché de l'application (titre, sidebar, écran de connexion).
 * Configurable par instance via VITE_APP_NAME (apps/web/.env.local ou
 * variable d'environnement de build) — défaut : « Family Assistant ».
 */
export const APP_NAME: string = import.meta.env.VITE_APP_NAME || "Family Assistant";
