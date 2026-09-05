import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { z } from "zod";

/**
 * Corps JSON d'une requête, validé par un schéma de `@gfa/shared`.
 *
 * Un corps illisible lève une **400**, il ne vaut jamais `{}` : la plupart de
 * nos schémas ont un défaut pour chaque champ, donc `{}` les traverse sans
 * broncher — et une requête tronquée en cours de route effaçait alors le
 * document qu'elle prétendait mettre à jour.
 */
export async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Corps de requête illisible." });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Le champ fautif est nommé : sans lui, le front ne peut qu'afficher
    // « l'enregistrement a échoué » et l'utilisateur cherche à l'aveugle.
    const issue = parsed.error.issues[0];
    throw new HTTPException(400, {
      message: `${issue.path.join(".") || "corps"} : ${issue.message}`,
    });
  }
  return parsed.data;
}
