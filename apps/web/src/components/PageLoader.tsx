/**
 * Loader d'une page, centré verticalement, avec une illustration CSS par
 * section (styles dans `src/loaders.css`). Sans libellé visible.
 *
 * Chaque variante réserve sa propre hauteur : ces loaders débordent de leur
 * boîte via ::before / ::after (papier de l'imprimante, œuf au-dessus de la
 * poêle, flamme sous la fusée), il leur faut donc de la place autour.
 */
export type PageLoaderVariant =
  | "accueil"
  | "repas"
  | "activites"
  | "mariage"
  | "taches"
  | "bienetre"
  | "argent"
  | "agenda";

// Espace réservé à l'illustration (hauteur × largeur mini du conteneur).
const SPACE: Record<PageLoaderVariant, string> = {
  accueil: "h-[250px]",
  repas: "h-[130px] w-[220px]",
  activites: "h-[230px]",
  mariage: "h-[90px]",
  taches: "h-[210px]",
  bienetre: "h-[210px] w-[210px]",
  argent: "h-[70px]",
  agenda: "h-[70px]",
};

export default function PageLoader({
  variant,
  className = "",
}: {
  variant: PageLoaderVariant;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Pas de libellé visible : `aria-label` pour les lecteurs d'écran.
      aria-label="Chargement"
      className={`flex min-h-[60vh] items-center justify-center ${className}`}
    >
      <div className={`flex items-center justify-center ${SPACE[variant]}`}>
        <span className={`loader-${variant}`} aria-hidden="true" />
      </div>
    </div>
  );
}
