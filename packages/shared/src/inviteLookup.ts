import { z } from "zod";
// Type seul : la table des textes est définie avec les autres schémas du
// faire-part (`index.ts`), et l'import disparaît à la compilation.
import type { InviteLookupTexts } from "./index";

/**
 * Retrouver son faire-part à partir de son adresse postale.
 *
 * Un invité ne retient pas un code de quatre lettres, mais il a l'enveloppe
 * sous les yeux — et une seule URL circule alors pour tout le monde (`/i`).
 * Encore faut-il apparier ce qu'il tape avec ce que les mariés ont saisi : deux
 * textes libres, écrits par deux personnes différentes, à des mois d'écart.
 *
 * Le module vit dans `@gfa/shared` parce que l'appariement doit se raisonner
 * (et se corriger) au même endroit que les schémas, même s'il ne tourne
 * aujourd'hui que côté API.
 */

/** En dessous, une recherche ne veut rien dire : on demande à préciser. */
export const INVITE_LOOKUP_MIN_CHARS = 3;

/**
 * Au-delà, on ne liste rien : la page dirait « voici les foyers invités » à qui
 * taperait un code postal au hasard. On demande de préciser à la place.
 */
export const INVITE_LOOKUP_MAX_MATCHES = 8;

export const inviteLookupSchema = z.object({
  q: z.string().trim().min(1).max(160),
});

/**
 * `ok` : la liste est exploitable · `empty` : rien à cette adresse ·
 * `too_broad` : pas assez de matière pour chercher · `too_many` : trop de
 * foyers, on ne les affiche pas.
 */
export type InviteLookupStatus = "ok" | "empty" | "too_broad" | "too_many";

export interface InviteLookupMatch {
  /** Le code du faire-part : `/i/<code>`. */
  code: string;
  /** « famille Marchand », « Marion & Max » — le libellé du foyer. */
  household: string;
  /** **Prénoms** seuls : de quoi se reconnaître, sans publier l'annuaire du mariage. */
  people: string[];
  address: string;
}

export interface InviteLookupResult {
  status: InviteLookupStatus;
  matches: InviteLookupMatch[];
  /** Nombre de foyers trouvés, y compris quand la liste n'est pas renvoyée. */
  count: number;
}

/** En-tête de la page publique, avant toute recherche. */
export interface InviteLookupChrome {
  couple: [string, string];
  /** La papeterie choisie : la page de recherche est la même enveloppe que le faire-part. */
  theme: string;
  dateLabel: string;
  rsvpDeadline: string | null;
  contactEmail: string;
  contactPhone: string;
  /**
   * Les titres et textes saisis dans l'onglet Faire-part. Un champ vide = la
   * formulation standard (`INVITE_LOOKUP_TEXT_DEFAULT`), résolue à l'affichage.
   */
  texts: InviteLookupTexts;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Tout ce qui n'est ni lettre ni chiffre devient une coupure de mot, et les
 * accents disparaissent : « Rue de l'Église » et « rue de l eglise » doivent
 * produire la même chose. `œ` et `æ` ne se décomposent pas en NFD — ils sont
 * traités à part, sinon « Cœur » perdrait sa syllabe.
 */
export function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Abréviations postales courantes. Elles sont résolues **des deux côtés** : les
 * mariés saisissent « 12 bd Voltaire » et l'invité tape « boulevard Voltaire »,
 * ou l'inverse — les deux doivent tomber sur le même mot.
 */
const ABBREVIATIONS: Record<string, string> = {
  av: "avenue",
  ave: "avenue",
  avn: "avenue",
  bd: "boulevard",
  bld: "boulevard",
  blvd: "boulevard",
  boul: "boulevard",
  r: "rue",
  pl: "place",
  imp: "impasse",
  all: "allee",
  ch: "chemin",
  chem: "chemin",
  rte: "route",
  sq: "square",
  qu: "quai",
  crs: "cours",
  fg: "faubourg",
  res: "residence",
  resid: "residence",
  bat: "batiment",
  app: "appartement",
  apt: "appartement",
  appt: "appartement",
  esc: "escalier",
  // Pas de `et` → `etage` : « et » est d'abord la conjonction (« Pierre et Marie »).
  st: "saint",
  ste: "sainte",
  sts: "saints",
  gal: "general",
  gnl: "general",
  pdt: "president",
  mal: "marechal",
  dr: "docteur",
};

/**
 * Mots qui ne distinguent aucun foyer : presque toutes les adresses en
 * contiennent. Ils restent dans le texte comparé (une correspondance exacte les
 * compte), mais ils ne peuvent pas à eux seuls faire ressortir une adresse —
 * sinon « rue de la » remonterait tout le carnet.
 */
const GENERIC = new Set([
  "rue",
  "avenue",
  "boulevard",
  "place",
  "impasse",
  "allee",
  "chemin",
  "route",
  "square",
  "quai",
  "cours",
  "faubourg",
  "residence",
  "batiment",
  "appartement",
  "escalier",
  "etage",
  "villa",
  "sentier",
  "passage",
  "lieu",
  "dit",
  "zone",
  "lotissement",
  "hameau",
  "voie",
  "rond",
  "point",
  "cedex",
  "bis",
  "ter",
  "quater",
  "de",
  "du",
  "des",
  "d",
  "la",
  "le",
  "les",
  "l",
  "au",
  "aux",
  "a",
  "et",
  "en",
  "sur",
  "sous",
  "chez",
  "monsieur",
  "madame",
  "mr",
  "mme",
  "famille",
]);

export interface ParsedAddress {
  /** Tous les mots, normalisés et désabrégés. */
  tokens: string[];
  /** Les mots qui **distinguent** : ni type de voie, ni article, ni civilité. */
  terms: string[];
  postalCode: string | null;
  /** Le numéro dans la voie — le premier nombre court rencontré. */
  streetNumber: string | null;
}

/**
 * Découpe une adresse (ou une requête) en mots exploitables.
 *
 * Volontairement **sans grammaire d'adresse** : on ne cherche pas à savoir quel
 * mot est la voie et quel mot est la ville. Un invité écrit « Peupliers 95130 »
 * aussi bien que « 14, rue des Peupliers — Franconville » ; ce qui compte est
 * l'ensemble des mots, pas leur ordre.
 */
export function parseAddress(raw: string): ParsedAddress {
  const tokens = normalizeText(raw)
    .split(" ")
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    // « 6D », « 12bis » : le numéro et son indice se séparent, des deux côtés.
    // Les mariés écrivent « 6D rue de Cernay » et l'invité tape « 6 rue de
    // Cernay » — c'est la même porte, et l'indice ne doit pas la fermer.
    .flatMap((t) => {
      const m = /^(\d{1,4})(bis|ter|quater|[a-z])$/.exec(t);
      return m ? [m[1], m[2]] : [t];
    });

  let postalCode: string | null = null;
  let streetNumber: string | null = null;
  for (const t of tokens) {
    if (/^\d{5}$/.test(t)) {
      if (postalCode === null) postalCode = t;
    } else if (/^\d{1,4}$/.test(t)) {
      if (streetNumber === null) streetNumber = t;
    }
  }

  // Un nombre est toujours discriminant ; un mot ne l'est que s'il porte du sens.
  const terms = tokens.filter((t) => (/^\d+$/.test(t) ? true : t.length > 1 && !GENERIC.has(t)));
  return { tokens, terms, postalCode, streetNumber };
}

/* ------------------------------------------------------------------ */
/* Appariement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Distance de Levenshtein, abandonnée dès qu'elle dépasse `max` : on ne veut
 * pas le chiffre exact, seulement savoir si deux mots sont voisins.
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Marge de faute admise : nulle sur un mot court, où toute faute change le mot. */
const fuzzyBudget = (t: string) => (t.length <= 4 ? 0 : t.length <= 7 ? 1 : 2);

/**
 * Un mot de la requête est-il présent ? Exact, préfixe (« peuplier » /
 * « peupliers »), ou à une ou deux fautes près (« franconvile »).
 *
 * Les nombres, eux, se comparent **au caractère près** : le 14 et le 15 d'une
 * rue sont deux foyers différents, pas une faute de frappe.
 */
function termMatches(term: string, hay: string[]): boolean {
  if (/^\d+$/.test(term)) return hay.includes(term);
  if (hay.includes(term)) return true;
  const budget = fuzzyBudget(term);
  return hay.some((h) => {
    if (/^\d+$/.test(h)) return false;
    if (term.length >= 4 && h.startsWith(term)) return true;
    if (h.length >= 4 && term.startsWith(h)) return true;
    return budget > 0 && editDistance(h, term, budget) <= budget;
  });
}

/** Ce que « vaut » un mot retrouvé : un code postal en dit plus qu'un prénom. */
const weightOf = (t: string) => (/^\d{5}$/.test(t) ? 6 : /^\d+$/.test(t) ? 4 : 2);

/**
 * Combien de mots doivent être retrouvés.
 *
 * Avec un ou deux mots, on exige tout : c'est trop peu pour se permettre une
 * approximation. Au-delà, on tolère qu'un mot sur trois tombe à côté — un
 * invité recopie son enveloppe en entier, avec l'étage et le bâtiment que les
 * mariés n'ont jamais saisis.
 */
const requiredMatches = (n: number) => (n <= 2 ? n : Math.ceil(n * 0.7));

/**
 * Note un foyer face à une requête. `0` = ce n'est pas lui.
 *
 * Le score ne sert qu'à **ordonner** les foyers retenus : l'invité choisit
 * ensuite lui-même, et deux foyers d'une même adresse ont par construction des
 * scores voisins.
 */
export function scoreAddress(query: ParsedAddress, candidate: ParsedAddress): number {
  if (query.terms.length === 0) return 0;
  let matched = 0;
  let score = 0;
  for (const t of query.terms) {
    if (candidate.tokens.includes(t)) {
      matched += 1;
      score += weightOf(t);
    } else if (termMatches(t, candidate.tokens)) {
      matched += 1;
      // Un mot approché pèse moins qu'un mot juste : à égalité de couverture,
      // l'adresse écrite correctement passe devant.
      score += Math.max(1, weightOf(t) - 2);
    }
  }
  if (matched < requiredMatches(query.terms.length)) return 0;
  // Le sans-faute prime : sinon « 14 rue des Peupliers » et « 15 rue des
  // Peupliers » se départageraient au hasard de l'ordre en base.
  if (matched === query.terms.length) score += 2;
  return score;
}

/** Le texte comparé pour un foyer : son adresse, mais aussi ses noms. */
export function lookupHaystack(parts: (string | null | undefined)[]): ParsedAddress {
  return parseAddress(parts.filter(Boolean).join(" "));
}
