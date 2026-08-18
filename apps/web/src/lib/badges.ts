import { useQuery } from "@tanstack/react-query";
import type { NavBadges } from "@gfa/shared";
import { api } from "./api";

/**
 * Compteurs du foyer : tâches, courses, reste à vivre, compte à rebours mariage.
 *
 * Une seule clé de cache, partagée avec le menu (`Layout`) : une page qui les
 * lit pour son en-tête ne déclenche aucune requête supplémentaire.
 */
export function useNavBadges() {
  return useQuery({
    queryKey: ["nav-badges"],
    queryFn: () => api.get<NavBadges>("/api/badges"),
    staleTime: 15_000,
  });
}
