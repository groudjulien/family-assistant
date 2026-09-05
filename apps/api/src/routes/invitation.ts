import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import {
  INVITE_CODE_LENGTH,
  INVITE_LOOKUP_MAX_MATCHES,
  INVITE_LOOKUP_MIN_CHARS,
  inviteLookupSchema,
  lookupHaystack,
  normalizeInviteCode,
  normalizeText,
  parseRsvpMeals,
  parseAddress,
  parseWeddingDays,
  scoreAddress,
  submitRsvpSchema,
  visibleTo,
  type Invitation,
  type InvitationPerson,
  type InviteLookupChrome,
  type InviteMeal,
  type RsvpMeals,
  type InviteLookupResult,
  type WeddingDayKey,
  type WeddingInviteConfig,
} from "@gfa/shared";
import { weddingGuest, household } from "../db/schema";
import { parseBody } from "../lib/validate";
import type { AppContext } from "../lib/types";
import type { DbHousehold } from "../db/schema";
import { readInviteConfig } from "./wedding";

/**
 * Faire-part public : `/public/invite/<code>`, servi **hors session**. Le code
 * de 4 caractères est la seule clé — il ne donne accès qu'à la fiche du foyer
 * qui le porte, jamais à la liste des invités ni au reste du foyer organisateur.
 */
const invitation = new Hono<AppContext>();

type GuestRow = typeof weddingGuest.$inferSelect;

/** Retrouve le foyer invité (chef de famille + rattachés) à partir du code. */
async function loadFamily(c: Context<AppContext>, raw: string) {
  const code = normalizeInviteCode(raw);
  if (code.length !== INVITE_CODE_LENGTH) return null;
  const db = c.get("db");
  const head = (
    await db.select().from(weddingGuest).where(eq(weddingGuest.inviteCode, code)).limit(1)
  )[0];
  if (!head || head.archived) return null;
  const members = await db
    .select()
    .from(weddingGuest)
    .where(eq(weddingGuest.parentId, head.id));
  const h = (
    await db.select().from(household).where(eq(household.id, head.householdId)).limit(1)
  )[0];
  if (!h) return null;
  const people = [head, ...members.filter((m) => !m.archived).sort((a, b) => a.position - b.position)];
  return { code, head, people, household: h };
}

/**
 * Jours **ouverts** à une personne : la portée de son invitation. Elle tient à
 * son foyer — convié dès le premier jour, ou seulement à partir du deuxième.
 * C'est ce qui borne ce qu'elle peut cocher, sans jamais toucher à sa présence.
 */
const openDays = (g: GuestRow, days: WeddingDayKey[]): WeddingDayKey[] =>
  days.filter((k) => g.guestGroup === "vendredi" || k !== days[0]);

/** Sa présence, telle qu'elle est en base. */
const presentDays = (g: GuestRow, days: WeddingDayKey[]): WeddingDayKey[] =>
  days.filter((k) => Boolean(g[k]));

/** « famille Marchand » quand les adultes partagent un nom, sinon les prénoms. */
function familyLabel(people: GuestRow[]): string {
  const adults = people.filter((p) => p.ageGroup === "adult");
  const names = (adults.length > 0 ? adults : people).map((p) => p.name.trim());
  const lastNames = names.map((n) => n.split(/\s+/).slice(1).join(" ")).filter(Boolean);
  if (lastNames.length >= 2 && lastNames.every((l) => l.toLowerCase() === lastNames[0].toLowerCase())) {
    return `famille ${lastNames[0]}`;
  }
  const firsts = names.map((n) => n.split(/\s+/)[0]);
  return firsts.length <= 2 ? firsts.join(" & ") : `${firsts.slice(0, -1).join(", ")} & ${firsts.at(-1)}`;
}

/** Jours retenus par le foyer organisateur, lus défensivement. */
function householdDays(h: DbHousehold) {
  try {
    return parseWeddingDays(h.weddingDays ? JSON.parse(h.weddingDays) : null);
  } catch {
    return parseWeddingDays(null);
  }
}

/** Une colonne JSON de liste d'identifiants, lue sans jamais lever. */
function parseIds(raw: string | null): string[] {
  const v = safeJson(raw);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** `JSON.parse` qui ne fait pas tomber la page publique sur une colonne abîmée. */
function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * La config, réduite à ce que **ce foyer** doit voir.
 *
 * Le tri se fait ici et pas seulement à l'affichage : la page publique est
 * servie sans session, et tout ce qui part dans la réponse est lisible par qui
 * ouvre le lien. Un planning réservé à ceux qui dorment sur place, ou un texte
 * écrit pour une famille en particulier, n'a rien à faire dans la charge utile
 * des autres.
 *
 * Les repas et les plats restent filtrés à la **personne** côté page : dans un
 * même foyer, ils se voient de toute façon les uns les autres.
 */
function configFor(config: WeddingInviteConfig, audience: string[]): WeddingInviteConfig {
  const shown = <T extends { visibleFor: string[] }>(list: T[]) =>
    list.filter((x) => visibleTo(x.visibleFor, audience));
  return {
    ...config,
    schedule: config.schedule.map((d) => ({ ...d, items: shown(d.items) })),
    venues: shown(config.venues),
    faq: shown(config.faq),
    meals: shown(config.meals).map((m) => ({
      ...m,
      starters: shown(m.starters),
      mains: shown(m.mains),
      desserts: shown(m.desserts),
    })),
  };
}

/**
 * Ne garde d'une réponse que ce qui existe vraiment.
 *
 * Un repas inconnu, un repas d'un jour qui n'est pas ouvert au foyer, un plat
 * qui n'est pas à la carte de **ce** repas : tout cela est écarté. Ce n'est pas
 * de la méfiance envers l'invité — la page ne peut pas produire ça — mais la
 * page publique est sans session, et rien d'autre ne borne ce qui est écrit.
 */
function sanitizeMeals(
  answer: RsvpMeals,
  meals: InviteMeal[],
  openDayKeys: WeddingDayKey[],
): RsvpMeals {
  const byId = new Map(meals.map((m) => [m.id, m]));
  const clean: RsvpMeals = {};
  for (const [mealId, choice] of Object.entries(answer)) {
    const meal = byId.get(mealId);
    if (!meal || !openDayKeys.includes(meal.dayKey)) continue;
    const pick = (list: { id: string }[], id: string | null) =>
      id && list.some((d) => d.id === id) ? id : null;
    clean[mealId] = {
      starterId: pick(meal.starters, choice.starterId),
      mainId: pick(meal.mains, choice.mainId),
      dessertId: pick(meal.desserts, choice.dessertId),
    };
  }
  return clean;
}

function buildInvitation(
  code: string,
  people: GuestRow[],
  h: DbHousehold,
): Invitation {
  const days = householdDays(h);
  const config = readInviteConfig(h);
  const dayKeys = days.map((d) => d.key);
  const dateOf = (k: WeddingDayKey) => config.schedule.find((s) => s.key === k)?.date ?? null;

  const head = people[0];
  // Les tags du foyer sont portés par son chef : ils valent pour chacun des
  // siens, et se cumulent aux catégories propres à chaque personne.
  const familyTags = parseIds(head.familyCategories);
  const audience = [
    ...new Set(people.flatMap((g) => [...familyTags, ...parseIds(g.categories)])),
  ];
  const persons: InvitationPerson[] = people.map((g) => ({
    categories: [...new Set([...familyTags, ...parseIds(g.categories)])],
    id: g.id,
    name: g.name,
    child: g.ageGroup === "child",
    openDays: openDays(g, dayKeys),
    days: presentDays(g, dayKeys),
    meals: parseRsvpMeals(safeJson(g.rsvpMeals)),
    diet: g.rsvpDiet ?? "",
  }));

  return {
    code,
    couple: [h.memberAName, h.memberBName],
    familyName: familyLabel(people),
    familyAddress: [head.address, [head.postalCode, head.city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
    housed: Boolean(head.housed),
    answered: head.rsvpAt !== null,
    // Ce que « le foyer » porte, pour les blocs qui ne se rendent qu'une fois.
    audience,
    days: days.map((d) => ({ ...d, date: dateOf(d.key) })),
    people: persons,
    config: configFor(config, audience),
  };
}

/* ------------------------------------------------------------------ */
/* « Retrouver mon invitation » — /public/invite/lookup                */
/*                                                                     */
/* Une seule URL circule (`/i`), et l'invité s'y retrouve par son       */
/* adresse. Déclaré **avant** `/:code`, sinon « lookup » serait lu      */
/* comme un code de faire-part.                                        */
/* ------------------------------------------------------------------ */

/** L'en-tête de la page, avant toute recherche : les prénoms, la date, les contacts. */
invitation.get("/lookup", async (c) => {
  const h = (await c.get("db").select().from(household).limit(1))[0];
  if (!h) return c.json({ error: "not_found" }, 404);
  const config = readInviteConfig(h);
  const chrome: InviteLookupChrome = {
    couple: [h.memberAName, h.memberBName],
    theme: config.theme,
    dateLabel: config.dateLabel,
    rsvpDeadline: config.rsvpDeadline,
    contactEmail: config.contactEmail,
    contactPhone: config.contactPhone,
    texts: config.lookup,
  };
  return c.json(chrome);
});

/**
 * La recherche elle-même.
 *
 * En **POST** : une adresse postale n'a rien à faire dans une barre d'adresse,
 * ni dans les journaux d'un CDN. Le nombre de foyers renvoyés est plafonné —
 * la page ne doit pas devenir un annuaire pour qui taperait un code postal au
 * hasard, et un invité qui cherche vraiment tape mieux que ça.
 */
invitation.post("/lookup", async (c) => {
  const { q } = await parseBody(c, inviteLookupSchema);
  const empty = (status: InviteLookupResult["status"], count = 0): InviteLookupResult => ({
    status,
    matches: [],
    count,
  });

  const query = parseAddress(q);
  if (normalizeText(q).length < INVITE_LOOKUP_MIN_CHARS || query.terms.length === 0) {
    return c.json(empty("too_broad"));
  }

  // Une soixantaine de foyers : le tri se fait en mémoire, et l'appariement a
  // besoin du texte entier (adresse, ville, noms) — pas d'un LIKE SQL qui ne
  // saurait ni les accents, ni l'ordre des mots.
  const db = c.get("db");
  const all = await db.select().from(weddingGuest);
  const scored = all
    .filter((g) => !g.parentId && !g.archived && g.inviteCode)
    .map((head) => {
      const people = [
        head,
        ...all.filter((m) => m.parentId === head.id && !m.archived).sort((a, b) => a.position - b.position),
      ];
      const hay = lookupHaystack([
        head.address,
        head.postalCode,
        head.city,
        familyLabel(people),
        ...people.map((p) => p.name),
      ]);
      return { head, people, score: scoreAddress(query, hay) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return c.json(empty("empty"));
  if (scored.length > INVITE_LOOKUP_MAX_MATCHES) return c.json(empty("too_many", scored.length));

  const result: InviteLookupResult = {
    status: "ok",
    count: scored.length,
    matches: scored.map(({ head, people }) => ({
      code: head.inviteCode as string,
      household: familyLabel(people),
      // Prénoms seuls : de quoi se reconnaître entre deux foyers d'un même
      // immeuble, sans publier l'annuaire du mariage.
      people: people.map((p) => p.name.trim().split(/\s+/)[0]).filter(Boolean),
      address: [head.address, [head.postalCode, head.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
    })),
  };
  return c.json(result);
});

invitation.get("/:code", async (c) => {
  const found = await loadFamily(c, c.req.param("code"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const { code, head, people, household: h } = found;

  // Ouvrir le lien fait avancer le suivi côté organisateurs — mais ne redescend
  // jamais un foyer qui a déjà répondu.
  if (head.invitationStatus === "to_send" || head.invitationStatus === "sent") {
    await c
      .get("db")
      .update(weddingGuest)
      .set({ invitationStatus: "opened" })
      .where(eq(weddingGuest.id, head.id));
  }
  return c.json(buildInvitation(code, people, h));
});

invitation.post("/:code", async (c) => {
  const found = await loadFamily(c, c.req.param("code"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const { code, head, people, household: h } = found;

  const body = await parseBody(c, submitRsvpSchema);
  const db = c.get("db");
  const byId = new Map(people.map((p) => [p.id, p]));
  const now = new Date().toISOString();

  const days = householdDays(h).map((d) => d.key);
  const config = readInviteConfig(h);
  for (const answer of body.people) {
    const g = byId.get(answer.id);
    if (!g) continue; // une personne d'un autre foyer ne se glisse pas dans la réponse
    // La réponse écrit **la** présence, celle que lisent aussi les mariés. Elle
    // reste bornée aux jours ouverts au foyer : cocher un jour hors de sa portée
    // n'est pas une réponse, c'est une requête forgée.
    const open = openDays(g, days);
    const set: Record<string, unknown> = {
      rsvpMeals: JSON.stringify(sanitizeMeals(answer.meals, config.meals, open)),
      rsvpDiet: answer.diet || null,
      // Seul « Envoyer » horodate : sans ça, ouvrir le lien et cocher une case
      // ferait passer le foyer pour ayant répondu.
      ...(body.confirm ? { rsvpAt: now } : {}),
    };
    for (const k of open) set[k] = answer.days.includes(k) ? 1 : 0;
    await db.update(weddingGuest).set(set).where(eq(weddingGuest.id, g.id));
  }

  if (body.confirm) {
    await db
      .update(weddingGuest)
      .set({ invitationStatus: "filled", rsvpAt: now })
      .where(eq(weddingGuest.id, head.id));
  }

  const fresh = await db.select().from(weddingGuest).where(eq(weddingGuest.householdId, head.householdId));
  const refreshed = people.map((p) => fresh.find((f) => f.id === p.id) ?? p);
  return c.json(buildInvitation(code, refreshed, h));
});

export default invitation;
