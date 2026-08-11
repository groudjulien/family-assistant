import { useEffect, useState } from "react";

/**
 * Durée minimale d'affichage du loader à l'entrée d'un menu (Réglages →
 * Générale). Réglage d'affichage pur, donc stocké en localStorage comme le
 * thème — pas de colonne en base ni d'aller-retour serveur.
 */

const KEY = "loader-delay-ms";
export const DEFAULT_LOADER_DELAY_MS = 500;
export const MAX_LOADER_DELAY_MS = 5000;
const EVENT = "gfa:loader-delay";

export function getLoaderDelay(): number {
  // Attention : `Number(null)` vaut 0, il faut donc traiter l'absence de clé
  // séparément, sinon le défaut ne s'applique jamais.
  const raw = localStorage.getItem(KEY);
  if (raw === null) return DEFAULT_LOADER_DELAY_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) return DEFAULT_LOADER_DELAY_MS;
  return Math.min(ms, MAX_LOADER_DELAY_MS);
}

export function setLoaderDelay(ms: number) {
  const clamped = Math.min(Math.max(Math.round(ms), 0), MAX_LOADER_DELAY_MS);
  localStorage.setItem(KEY, String(clamped));
  // Prévient les composants déjà montés (le `storage` natif ne se déclenche pas
  // dans l'onglet qui écrit).
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Durée courante, mise à jour si le réglage change pendant la session. */
export function useLoaderDelay(): number {
  const [ms, setMs] = useState(getLoaderDelay);
  useEffect(() => {
    const sync = () => setMs(getLoaderDelay());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return ms;
}
