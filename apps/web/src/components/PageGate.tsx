import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import PageLoader, { type PageLoaderVariant } from "./PageLoader";
import { useLoaderDelay } from "../lib/loaderDelay";

/**
 * Affiche le loader du menu pendant la durée réglée (Réglages → Générale) à
 * chaque entrée dans un menu, puis laisse la place au contenu.
 *
 * Le contenu est *monté* mais masqué pendant ce temps (attribut `hidden`, donc
 * `display: none`) : les requêtes des pages partent immédiatement et chargent
 * en tâche de fond derrière le loader. Il ne faut donc pas le démonter.
 */
export default function PageGate({
  variant,
  children,
}: {
  variant: PageLoaderVariant;
  children: ReactNode;
}) {
  const delay = useLoaderDelay();
  // Clé = premier segment d'URL : changer de sous-onglet (/money/depenses →
  // /money/tresorerie) ne rejoue pas le loader, changer de menu si.
  const menu = useLocation().pathname.split("/")[1] ?? "";
  const [gated, setGated] = useState(delay > 0);

  useEffect(() => {
    if (delay <= 0) {
      setGated(false);
      return;
    }
    setGated(true);
    const t = setTimeout(() => setGated(false), delay);
    return () => clearTimeout(t);
  }, [menu, delay]);

  return (
    <>
      {gated && <PageLoader variant={variant} />}
      <div hidden={gated}>{children}</div>
    </>
  );
}
