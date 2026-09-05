import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WeddingGuest } from "@gfa/shared";
import { api } from "./api";

/**
 * Rattrape les foyers sans code de faire-part.
 *
 * L'API pose le code à la création d'un invité ; ce rattrapage ne sert qu'aux
 * foyers créés **avant** le faire-part. Il est idempotent et n'est tiré qu'une
 * fois par montage, et seulement si un chef de famille est effectivement sans
 * code — sans quoi le lien et l'export renverraient sur du vide.
 */
export function useEnsureInviteCodes(guests: WeddingGuest[] | undefined) {
  const qc = useQueryClient();
  const asked = useRef(false);
  const missing = (guests ?? []).some((g) => !g.parentId && !g.archived && !g.inviteCode);

  useEffect(() => {
    if (!missing || asked.current) return;
    asked.current = true;
    void api
      .post("/api/wedding/guests/codes")
      .then(() => qc.invalidateQueries({ queryKey: ["wedding-guests"] }))
      .catch(() => {
        asked.current = false; // un échec réseau ne doit pas condamner le rattrapage
      });
  }, [missing, qc]);
}
