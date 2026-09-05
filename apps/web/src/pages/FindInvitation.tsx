import { useQuery } from "@tanstack/react-query";
import type { InviteLookupChrome } from "@gfa/shared";
import { API_URL } from "../lib/api";
import LookupView from "../components/invitation/LookupView";
import {
  themeOf,
  useFullPageStationery,
  useStationeryFonts,
} from "../components/invitation/stationery";

/**
 * « Retrouver mon invitation » — `/i`, hors session et hors `Layout`.
 *
 * Une seule adresse à faire circuler pour tout le monde : plus besoin d'envoyer
 * à chaque foyer un lien qui lui est propre, ni de le retrouver six mois plus
 * tard dans un fil de messages. L'invité tape l'adresse qui figure au dos de
 * son enveloppe, et on lui rend son faire-part.
 *
 * La papeterie est celle du faire-part, **thème compris** : c'est la même
 * enveloppe, pas une page d'outil posée devant. Le rendu vit dans `LookupView`,
 * partagé avec l'aperçu éditable de l'onglet Faire-part — ce que l'on y
 * configure est littéralement cette page.
 */
export default function FindInvitationPage() {
  const { data: chrome } = useQuery({
    queryKey: ["invite-lookup-chrome"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/public/invite/lookup`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as InviteLookupChrome;
    },
    retry: false,
  });

  // La papeterie ne se connaît qu'une fois l'en-tête chargé : d'ici là, c'est
  // celle par défaut.
  const S = themeOf(chrome?.theme);
  useStationeryFonts(S);
  useFullPageStationery(S.C.paper);

  return <LookupView chrome={chrome} />;
}
