import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Invitation } from "@gfa/shared";
import { API_URL } from "../lib/api";
import InvitationView from "../components/invitation/InvitationView";
import {
  themeOf,
  useFullPageStationery,
  useStationeryFonts,
  type Stationery,
} from "../components/invitation/stationery";

/**
 * Faire-part public — `/i/<code>`, hors session et hors `Layout`.
 *
 * Le rendu vit dans `InvitationView`, partagé avec l'aperçu éditable de
 * l'onglet Faire-part : ce que l'on configure est littéralement ce que les
 * invités reçoivent.
 */
export default function InvitationPage() {
  const { code = "" } = useParams();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["invitation", code],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/public/invite/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as Invitation;
    },
    retry: false,
  });

  // La papeterie ne se connaît qu'une fois la config chargée : d'ici là, c'est
  // celle par défaut — le temps d'un « Un instant… ».
  const S = themeOf(data?.config.theme);
  useStationeryFonts(S);
  useFullPageStationery(S.C.paper);

  const post = async (body: unknown) => {
    const res = await fetch(`${API_URL}/public/invite/${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
  };

  /**
   * Enregistrement au fil de l'eau, sans horodater la réponse. Volontairement
   * **sans** `refetch` : remonter la page sous les doigts de l'invité au milieu
   * de sa saisie serait pire que le silence.
   */
  const save = useMutation({ mutationFn: (body: unknown) => post(body) });

  /**
   * Un court délai avant d'écrire : cocher trois jours d'affilée ne doit pas
   * faire trois requêtes. Chaque envoi porte l'état **complet** du foyer, donc
   * en perdre un intermédiaire est sans conséquence — seul le dernier compte.
   */
  const saveTimer = useRef<number | null>(null);
  const queueSave = (body: unknown) => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save.mutate(body), 350);
  };
  useEffect(() => () => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
  }, []);
  /** « Envoyer » : c'est lui qui confirme, et lui seul qui relit la page. */
  const submit = useMutation({
    mutationFn: (body: unknown) => post(body),
    onSuccess: () => void refetch(),
  });

  return (
    <div style={{ minHeight: "100vh", background: S.C.paper, color: S.C.ink, padding: "0 0 40px" }}>
      {isPending ? (
        <Centered theme={S}>Un instant…</Centered>
      ) : isError || !data ? (
        <Centered theme={S}>
          Ce lien ne correspond à aucune invitation.
          <br />
          Vérifiez le code, ou écrivez-nous.
        </Centered>
      ) : (
        <InvitationView
          // Remonter la clé après une réponse remet l'écran « C'est noté » à
          // l'état renvoyé par le serveur, pas à un état local optimiste.
          key={data.answered ? "answered" : "open"}
          invitation={data}
          saving={save.isPending}
          saveError={save.isError}
          submitting={submit.isPending}
          submitError={submit.isError}
          onChange={(answers) =>
            queueSave({
              confirm: false,
              people: data.people.map((p) => ({ id: p.id, ...answers[p.id] })),
            })
          }
          onSubmit={(answers) => {
            // L'envoi porte le même état complet : l'écriture en attente n'a
            // plus lieu d'être, et la laisser partir après lui la ferait
            // repasser en « pas encore répondu ».
            if (saveTimer.current !== null) clearTimeout(saveTimer.current);
            submit.mutate({
              confirm: true,
              people: data.people.map((p) => ({ id: p.id, ...answers[p.id] })),
            });
          }}
        />
      )}
    </div>
  );
}

function Centered({ theme, children }: { theme: Stationery; children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        font: `${theme.light} 16px/1.6 ${theme.SANS}`,
        color: theme.C.muted,
      }}
    >
      {children}
    </div>
  );
}
