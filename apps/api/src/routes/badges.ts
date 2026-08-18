import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { WEDDING_DATE_PLACEHOLDER, type NavBadges } from "@gfa/shared";
import { task, shoppingItem } from "../db/schema";
import { daysUntilEndOfMonth, projectCashflow, projectedBalanceOf } from "../lib/cashflow";
import type { AppContext } from "../lib/types";

/**
 * Compteurs affichés au bout des menus de navigation.
 *
 * Endpoint dédié plutôt qu'un ajout à `/api/dashboard` : il est appelé sur
 * **chaque** page (le menu est dans le shell), donc il reste léger — pas de
 * synchro bancaire LunchFlow (les soldes sont lus tels quels), pas de résumé
 * mariage, pas de calcul d'équilibrage.
 */
const badges = new Hono<AppContext>();

/** Jours pleins entre aujourd'hui et une date `YYYY-MM-DD` (UTC, sans heure). */
function daysUntil(ymd: string): number | null {
  const target = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / 86_400_000);
}

badges.get("/", async (c) => {
  const db = c.get("db");
  const h = c.get("household");
  const me = c.get("user");
  const hid = h.id;

  // Horizon « reste à vivre » : jusqu'à la fin du mois courant, comme l'onglet
  // Trésorerie (Money.tsx → Tresorerie, monthOffset 0).
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + daysUntilEndOfMonth(from));

  const [tasks, shopping, cash] = await Promise.all([
    db.select().from(task).where(eq(task.householdId, hid)),
    db.select().from(shoppingItem).where(eq(shoppingItem.householdId, hid)),
    projectCashflow(db, hid, from, to),
  ]);

  // Mes tâches : racines non terminées, à moi ou à personne. Les sous-tâches
  // ne comptent pas — c'est déjà la règle des autres compteurs (dashboard).
  const mine = tasks.filter(
    (t) =>
      !t.parentTaskId &&
      t.status !== "done" &&
      (t.assigneeId === me.member || !t.assigneeId),
  ).length;

  // Un article acheté est supprimé de la liste : chaque ligne reste à acheter.
  // On compte les lignes, comme le widget d'accueil (pas la somme des quantités).
  const courses = shopping.length;

  // Reste à vivre du compte principal du membre connecté : solde projeté à la
  // fin du mois. Le compte principal est le flag `is_primary`, un seul par
  // propriétaire (cf. clearPrimaryForOwner dans routes/money.ts).
  const primary = cash.accounts.find((a) => a.owner === me.member && a.isPrimary);
  const moneyCents = primary ? projectedBalanceOf(primary, cash.entries) : null;

  // Date de mariage non configurée (sentinelle du wizard) ou passée : rien.
  const days =
    h.weddingTargetDate === WEDDING_DATE_PLACEHOLDER ? null : daysUntil(h.weddingTargetDate);
  const weddingDays = days !== null && days >= 0 ? days : null;

  const result: NavBadges = { tasks: mine, courses, moneyCents, weddingDays };
  return c.json(result);
});

export default badges;
