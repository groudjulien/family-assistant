import { eq } from "drizzle-orm";
import type { Balance } from "@gfa/shared";
import { transaction, settlement } from "../db/schema";
import type { Db } from "./types";

/**
 * Solde d'équilibrage du foyer — logique unique partagée par `GET /balance`
 * (money) et le dashboard (elle était dupliquée dans les deux routes).
 *
 * Pour chaque dépense, le payeur a avancé le montant total mais ne doit que sa
 * part ; les règlements (settlements) soldent la dette dans un sens ou l'autre.
 * Convention de signe : net > 0 ⇒ le membre b doit au membre a.
 */
export async function computeBalance(db: Db, householdId: string): Promise<Balance> {
  // Les lignes archivées ne comptent plus dans le solde.
  const txs = (
    await db.select().from(transaction).where(eq(transaction.householdId, householdId))
  ).filter((t) => !t.archived);
  const setts = (
    await db.select().from(settlement).where(eq(settlement.householdId, householdId))
  ).filter((s) => !s.archived);

  let net = 0;
  for (const t of txs) {
    if (t.amount >= 0) continue; // les revenus n'entrent pas dans l'équilibrage
    if (t.paidBy === "a") net += Math.abs(t.shareB); // b doit sa part à a
    else if (t.paidBy === "b") net -= Math.abs(t.shareA); // a doit sa part à b
  }
  for (const s of setts) {
    if (s.fromUser === "b" && s.toUser === "a") net -= s.amount;
    else if (s.fromUser === "a" && s.toUser === "b") net += s.amount;
  }

  return {
    net,
    fromUser: net >= 0 ? "b" : "a",
    toUser: net >= 0 ? "a" : "b",
    amount: Math.abs(net),
  };
}
