import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Mémorise le dernier sous-menu imbriqué visité (onglet de niveau 2, ex.
 * Courses → Idées repas → Semaine) pour y revenir quand on rouvre la section
 * sans sous-chemin explicite. Complète `useLastPaths` (Layout.tsx) qui ne
 * couvre que la navigation par la sidebar.
 *
 * - `key`      : identifiant stable, ex. "courses:idees" (clé localStorage).
 * - `valid`    : sous-menus autorisés.
 * - `fallback` : sous-menu par défaut (première visite).
 * - `view`     : le paramètre d'URL courant (undefined si absent).
 * - `basePath` : préfixe d'URL, ex. "/courses/idees".
 *
 * Renvoie le sous-menu résolu et réaligne l'URL (replace) si elle ne le portait pas.
 */
export function useLastView(
  key: string,
  valid: readonly string[],
  fallback: string,
  view: string | undefined,
  basePath: string,
): string {
  const navigate = useNavigate();
  let sub = fallback;
  if (view && valid.includes(view)) {
    sub = view;
  } else {
    try {
      const stored = localStorage.getItem(`nav:lastView:${key}`);
      if (stored && valid.includes(stored)) sub = stored;
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    try {
      localStorage.setItem(`nav:lastView:${key}`, sub);
    } catch {
      /* ignore */
    }
    if (view !== sub) navigate(`${basePath}/${sub}`, { replace: true });
  }, [key, sub, view, basePath, navigate]);
  return sub;
}
