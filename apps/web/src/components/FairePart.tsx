import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Invitation,
  InviteLookupChrome,
  InviteSection,
  InviteLookupTexts,
  InviteTheme,
  InvitationStatus,
  InviteDish,
  InviteFaq,
  InviteLink,
  InviteMeal,
  InviteScheduleDay,
  InviteScheduleItem,
  InviteVenue,
  WeddingDayKey,
  WeddingGuest,
  WeddingInviteConfig,
} from "@gfa/shared";
import { INVITE_LOOKUP_TEXT_DEFAULT, INVITE_THEMES, choiceFor, mealsInDayOrder } from "@gfa/shared";
import { api } from "../lib/api";
import { useMe } from "../auth";
import PageLoader from "./PageLoader";
import { Indicator } from "./Indicator";
import { arrayMove } from "@dnd-kit/sortable";
import InvitationView, { type AddKey, type Course, type EditKey } from "./invitation/InvitationView";
import LookupView, { type LookupBlock } from "./invitation/LookupView";
import { STATIONERY, themeOf, useStationeryFonts } from "./invitation/stationery";
import {
  DateInput,
  Input,
  SectionLabel,
  Select,
  Switch,
  TagSelect,
  inputClass,
  type Option,
} from "./ui";
import { useWeddingCategories } from "../lib/weddingCategories";
import { IconAlert, IconChevronDown, IconExternal } from "./icons";

/**
 * Onglet **Faire-part** : l'aperçu de la vraie page, en éditable.
 *
 * Le rendu est celui de `InvitationView`, exactement le composant que reçoivent
 * les invités — on ne configure pas un formulaire dont on imaginerait le
 * résultat, on modifie la page elle-même. Les crayons et les boutons d'ajout
 * sont le seul supplément, et ils ouvrent un éditeur dans le langage de l'app
 * (fond sombre, champs maison) : on ne confond jamais l'outil et la papeterie.
 *
 * Les invités affichés (« famille Martin ») sont **fictifs** : chaque foyer
 * verra ses propres noms, ses propres jours et son propre logement.
 */

/** Foyer de démonstration : deux adultes et un enfant, pour montrer le menu enfant. */
const SAMPLE_PEOPLE = [
  { first: "Camille", child: false },
  { first: "Thomas", child: false },
  { first: "Jade", child: true },
];

const newRowId = () => crypto.randomUUID().slice(0, 8);

/** Les trois services, de la liste de config à la clé de réponse et au filtre. */
const COURSE_LABEL: Record<Course, string> = {
  starters: "Entrées",
  mains: "Plats",
  desserts: "Desserts",
};
const COURSE_PICK: Record<Course, "starterId" | "mainId" | "dessertId"> = {
  starters: "starterId",
  mains: "mainId",
  desserts: "dessertId",
};
const COURSE_PARAM: Record<Course, string> = {
  starters: "starter",
  mains: "main",
  desserts: "dessert",
};

export default function FairePart() {
  const qc = useQueryClient();
  const me = useMe();
  const categories = useWeddingCategories();
  const days = me.household.weddingDays;

  const { data: saved, isPending } = useQuery({
    queryKey: ["wedding-invite-config"],
    queryFn: () => api.get<WeddingInviteConfig>("/api/wedding/invite-config"),
  });
  // Même clé que l'onglet Invités : le suivi ci-dessous ne coûte pas de requête
  // supplémentaire quand on arrive depuis la liste.
  const { data: guests } = useQuery({
    queryKey: ["wedding-guests"],
    queryFn: () => api.get<WeddingGuest[]>("/api/wedding/guests"),
  });

  const [draft, setDraft] = useState<WeddingInviteConfig | null>(null);
  // Le brouillon part de ce qui est en base ; on ne l'écrase plus ensuite, pour
  // ne pas perdre une saisie en cours quand la requête se rafraîchit.
  useEffect(() => {
    if (saved && draft === null) setDraft(saved);
  }, [saved, draft]);

  // La papeterie de l'aperçu est celle qui partira chez les invités : changer de
  // thème recharge les deux polices, ici comme là-bas.
  const stationery = themeOf(draft?.theme ?? saved?.theme);
  useStationeryFonts(stationery);

  const [editor, setEditor] = useState<EditorSpec | null>(null);

  const save = useMutation({
    mutationFn: (next: WeddingInviteConfig) =>
      api.put<WeddingInviteConfig>("/api/wedding/invite-config", next),
    // On ne repose pas la réponse dans le brouillon : une seconde modification
    // partie entre-temps serait écrasée par la version précédente.
    onSuccess: (next) => qc.setQueryData(["wedding-invite-config"], next),
  });

  const cfg = draft;
  const dayOptions = (allLabel: string): Option[] => [
    { value: "", label: allLabel },
    ...days.map((d) => ({ value: d.key, label: d.label })),
  ];

  /** Aperçu : un foyer fictif, convié à tous les jours du mariage. */
  const preview: Invitation | null = useMemo(() => {
    if (!cfg) return null;
    const dayKeys = days.map((d) => d.key);
    return {
      code: "AB12",
      couple: [me.household.members.a.name, me.household.members.b.name],
      familyName: "famille Martin",
      familyAddress: "12 rue des Lilas, 95300 Pontoise",
      housed: true,
      answered: false,
      // L'aperçu ne porte aucune catégorie : en édition, les conditions ne
      // masquent rien (cf. `InvitationView`), elles s'affichent en clair.
      audience: [],
      days: days.map((d) => ({
        ...d,
        date: cfg.schedule.find((s) => s.key === d.key)?.date ?? null,
      })),
      // Aucun jour coché : l'aperçu part d'un foyer vierge. Les repas restent
      // tout de même ouverts en édition (cf. `visibleMeals` dans
      // InvitationView), sinon on ne pourrait pas y ajouter la première entrée.
      people: SAMPLE_PEOPLE.map((p, i) => ({
        id: `apercu-${i}`,
        name: `${p.first} Martin`,
        child: p.child,
        openDays: dayKeys,
        days: [],
        meals: {},
        categories: [],
        diet: "",
      })),
      config: cfg,
    };
  }, [cfg, days, me.household.members]);

  if (isPending || !cfg || !preview) return <PageLoader variant="mariage" />;

  /**
   * Toute modification part aussitôt : la page est un aperçu qu'on retouche,
   * pas un formulaire qu'on valide. Il n'y a donc pas de bouton à oublier — ni
   * d'écart possible entre ce qu'on voit et ce que les invités recevront.
   */
  const set = (p: Partial<WeddingInviteConfig>) => {
    const next = { ...cfg, ...p };
    setDraft(next);
    save.mutate(next);
  };

  /**
   * L'en-tête de la page de recherche, tel que le servirait l'API : c'est la
   * **même** config, donc l'aperçu montre exactement ce que verra un invité.
   */
  const lookupPreview: InviteLookupChrome = {
    couple: [me.household.members.a.name, me.household.members.b.name],
    theme: cfg.theme,
    dateLabel: cfg.dateLabel,
    rsvpDeadline: cfg.rsvpDeadline,
    contactEmail: cfg.contactEmail,
    contactPhone: cfg.contactPhone,
    texts: cfg.lookup,
  };

  /* ---- Mutations de listes ---- */

  /**
   * Les repas, remis dans l'ordre du week-end à **chaque** écriture : un repas
   * du vendredi ne peut pas s'afficher après celui du samedi, quel que soit
   * l'ordre de saisie. Deux services d'un même jour gardent, eux, la place
   * qu'on leur donne (glissé, ou « Monter / Descendre »).
   */
  const setMeals = (list: InviteMeal[]) => set({ meals: mealsInDayOrder(list) });

  /** Un repas de la carte. `null` s'il vient d'être supprimé sous les doigts. */
  const mealOf = (id: string): InviteMeal | null => cfg.meals.find((m) => m.id === id) ?? null;
  const setMeal = (id: string, p: Partial<InviteMeal>) =>
    setMeals(cfg.meals.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const setDishes = (mealId: string, kind: Course, list: InviteDish[]) =>
    setMeal(
      mealId,
      kind === "starters" ? { starters: list } : kind === "mains" ? { mains: list } : { desserts: list },
    );
  const dishesOfMeal = (mealId: string, kind: Course): InviteDish[] => mealOf(mealId)?.[kind] ?? [];
  const editDish = (mealId: string, kind: Course, id: string, p: Partial<InviteDish>) =>
    setDishes(mealId, kind, dishesOfMeal(mealId, kind).map((x) => (x.id === id ? { ...x, ...p } : x)));

  /** Le déroulé d'un jour, créé à la volée la première fois qu'on le remplit. */
  const dayOf = (key: WeddingDayKey): InviteScheduleDay =>
    cfg.schedule.find((s) => s.key === key) ?? { key, date: null, tagline: "", items: [] };
  const setDay = (key: WeddingDayKey, p: Partial<InviteScheduleDay>) => {
    const next = { ...dayOf(key), ...p };
    const others = cfg.schedule.filter((s) => s.key !== key);
    set({
      // On garde l'ordre des jours du foyer, pas l'ordre de saisie.
      schedule: [...others, next].sort(
        (a, b) => days.findIndex((d) => d.key === a.key) - days.findIndex((d) => d.key === b.key),
      ),
    });
  };
  const setSteps = (key: WeddingDayKey, items: InviteScheduleItem[]) => setDay(key, { items });

  /* ---- Réordonnancement ---- */

  /** Où pose chaque liste réordonnable, désignée par la clé de son bouton d'ajout. */
  const listOf = (l: AddKey): { items: { id: string }[]; put: (next: never[]) => void } => {
    switch (l.block) {
      case "dish":
        return {
          items: dishesOfMeal(l.mealId, l.kind),
          put: (next) => setDishes(l.mealId, l.kind, next as InviteDish[]),
        };
      case "meal":
        // L'ordre affiché, pas l'ordre stocké : les flèches de la modale
        // doivent déplacer le repas par rapport à ce que l'on voit.
        return { items: mealsInDayOrder(cfg.meals), put: (next) => setMeals(next as InviteMeal[]) };
      case "step":
        return { items: dayOf(l.day).items, put: (next) => setSteps(l.day, next as InviteScheduleItem[]) };
      case "venue":
        return { items: cfg.venues, put: (next) => set({ venues: next as InviteVenue[] }) };
      case "faq":
        return { items: cfg.faq, put: (next) => set({ faq: next as InviteFaq[] }) };
      case "housingLink":
        return { items: cfg.housingLinks, put: (next) => set({ housingLinks: next as InviteLink[] }) };
    }
  };

  /**
   * Applique l'ordre venu de l'aperçu.
   *
   * Un élément absent de la liste d'ids (masqué à l'affichage) n'est pas perdu :
   * il reprend sa place en fin de liste plutôt que de disparaître.
   */
  const reorder = (l: AddKey, ids: string[]) => {
    const { items, put } = listOf(l);
    const byId = new Map(items.map((i) => [i.id, i]));
    const moved = ids.map((id) => byId.get(id)).filter(Boolean) as { id: string }[];
    put([...moved, ...items.filter((i) => !ids.includes(i.id))] as never[]);
  };

  /**
   * Les deux boutons « Monter / Descendre » de la modale.
   *
   * Le glisser-déposer ne vaut rien au doigt : c'est ici qu'un téléphone
   * réordonne, comme le « ⋯ » d'une sous-page ailleurs dans l'app.
   */
  const moveOf = (l: AddKey, id: string): EditorSpec["move"] => {
    const { items, put } = listOf(l);
    const i = items.findIndex((x) => x.id === id);
    const at = (dir: -1 | 1) =>
      i >= 0 && i + dir >= 0 && i + dir < items.length
        ? () => put(arrayMove(items, i, i + dir) as never[])
        : null;
    return { up: at(-1), down: at(1) };
  };

  /* ---- Ouverture des éditeurs ---- */

  const COURSE: Record<Course, { titre: string; nom: string; detail: string }> = {
    starters: { titre: "L'entrée", nom: "Saumon fumé", detail: "Blinis, crème citronnée" },
    mains: { titre: "Le plat", nom: "Filet de bœuf", detail: "Purée de panais et jus corsé" },
    desserts: { titre: "Le dessert", nom: "Pièce montée", detail: "Choux à la vanille" },
  };

  /**
   * La condition d'affichage, posée à l'identique sur tous les blocs qui en
   * acceptent une. Vide = tout le monde la voit : c'est le cas normal, et le
   * champ ne demande donc jamais de décision.
   */
  const visibleForField = (what: string): FieldDef => ({
    kind: "tags",
    key: "visibleFor",
    label: "Afficher seulement pour",
    hint: `Aucune catégorie = ${what} pour tout le monde.`,
  });

  /** Les mêmes champs pour créer un repas et pour le modifier. */
  const mealFields: FieldDef[] = [
    { kind: "text", key: "title", label: "Nom du repas", placeholder: "Dîner du samedi", max: 60 },
    {
      kind: "select",
      key: "dayKey",
      label: "Jour du repas",
      options: days.map((d) => ({ value: d.key, label: d.label })),
      hint: "Le choix n'apparaît qu'aux personnes présentes ce jour-là. Un même jour peut porter deux repas.",
    },
    {
      kind: "textarea",
      key: "kidsNote",
      label: "Note sur le menu enfant",
      rows: 3,
      hint: "Montrée aux enfants du foyer, au-dessus des plats.",
      max: 400,
    },
    {
      kind: "switch",
      key: "kidsOnly",
      label: "Menu enfant exclusif",
      hint:
        "Les enfants ne voient alors que les plats marqués « menu enfant ». Un service qui n'en a aucun leur montre quand même la carte des adultes.",
    },
    visibleForField("servi"),
  ];

  const dishFields = (kind: Course): FieldDef[] => [
    { kind: "text", key: "name", label: "Nom", placeholder: COURSE[kind].nom, max: 80 },
    { kind: "text", key: "detail", label: "Détail", placeholder: COURSE[kind].detail, max: 160 },
    // Les trois services peuvent avoir leur version enfant : une entrée aussi
    // se décline, et l'enfant qui ne peut pas la choisir n'a rien à répondre.
    {
      kind: "switch" as const,
      key: "kids",
      label: "Menu enfant",
      hint: "Proposé aux enfants du foyer, et masqué pour les adultes.",
    },
    visibleForField("proposé"),
  ];

  const venueFields = (): FieldDef[] => [
    { kind: "text", key: "name", label: "Nom du lieu", placeholder: "Mairie de Franconville" },
    {
      kind: "text",
      key: "address",
      label: "Adresse",
      placeholder: "Place Charles de Gaulle, 95130 Franconville",
      hint: "Elle alimente le bouton d'itinéraire.",
    },
    {
      kind: "text",
      key: "parkingAddress",
      label: "Adresse du parking (optionnel)",
      placeholder: "3 Pl. Maurice Ravel, 95130 Franconville",
      hint: "Renseignée, elle ajoute un second bouton « Aller au parking ».",
    },
    { kind: "text", key: "detail", label: "Détail", placeholder: "Stationnement conseillé : Pl. Maurice Ravel" },
    { kind: "text", key: "when", label: "Quand", placeholder: "Vendredi 15h10" },
    {
      kind: "select",
      key: "dayKey",
      label: "Visible par",
      options: dayOptions("Tout le monde"),
      hint: "Un lieu rattaché à un jour ne s'affiche que pour les invités de ce jour-là.",
    },
  ];

  const openEdit = (k: EditKey) => {
    switch (k.block) {
      case "header":
        return setEditor({
          title: "L'en-tête",
          value: { dateLabel: cfg.dateLabel, venueName: cfg.venueName, intro: cfg.intro },
          fields: [
            {
              kind: "text",
              key: "dateLabel",
              label: "Sur-titre",
              placeholder: "Vendredi 4 — Dimanche 6 juin 2027",
            },
            { kind: "text", key: "venueName", label: "Lieu principal", placeholder: "Château d'Amécourt" },
            {
              kind: "textarea",
              key: "intro",
              label: "Accroche",
              rows: 3,
              hint: "Vient après « Bonjour la famille Untel — ». Écrivez {famille} pour rappeler le nom du foyer.",
            },
          ],
          onSave: (v) =>
            set({ dateLabel: str(v.dateLabel), venueName: str(v.venueName), intro: str(v.intro) }),
        });
      case "footer":
        return setEditor({
          title: "Le pied de page",
          value: {
            rsvpDeadline: cfg.rsvpDeadline ?? "",
            contactEmail: cfg.contactEmail,
            contactPhone: cfg.contactPhone,
          },
          fields: [
            { kind: "date", key: "rsvpDeadline", label: "Répondre avant le" },
            { kind: "text", key: "contactEmail", label: "E-mail de contact" },
            { kind: "text", key: "contactPhone", label: "Téléphone" },
          ],
          onSave: (v) =>
            set({
              rsvpDeadline: str(v.rsvpDeadline) || null,
              contactEmail: str(v.contactEmail),
              contactPhone: str(v.contactPhone),
            }),
        });
      case "meal": {
        const m = mealOf(k.id);
        if (!m) return;
        return setEditor({
          title: "Le repas",
          value: {
            title: m.title,
            dayKey: m.dayKey,
            kidsNote: m.kidsNote,
            kidsOnly: m.kidsOnly,
            visibleFor: m.visibleFor,
          },
          fields: mealFields,
          onSave: (v) =>
            setMeal(k.id, {
              title: str(v.title),
              dayKey: (str(v.dayKey) || m.dayKey) as WeddingDayKey,
              kidsNote: str(v.kidsNote),
              kidsOnly: Boolean(v.kidsOnly),
              visibleFor: ids(v.visibleFor),
            }),
          onDelete: () => setMeals(cfg.meals.filter((x) => x.id !== k.id)),
          move: moveOf({ block: "meal" }, k.id),
        });
      }
      case "dish": {
        const d = dishesOfMeal(k.mealId, k.kind).find((x) => x.id === k.id);
        if (!d) return;
        return setEditor({
          title: COURSE[k.kind].titre,
          value: { name: d.name, detail: d.detail, kids: d.kids, visibleFor: d.visibleFor },
          fields: dishFields(k.kind),
          onSave: (v) =>
            editDish(k.mealId, k.kind, k.id, {
              name: str(v.name),
              detail: str(v.detail),
              kids: Boolean(v.kids),
              visibleFor: ids(v.visibleFor),
            }),
          onDelete: () =>
            setDishes(k.mealId, k.kind, dishesOfMeal(k.mealId, k.kind).filter((x) => x.id !== k.id)),
          move: moveOf({ block: "dish", mealId: k.mealId, kind: k.kind }, k.id),
        });
      }
      case "day": {
        const d = dayOf(k.day);
        const label = days.find((x) => x.key === k.day)?.label ?? k.day;
        return setEditor({
          title: `Le ${label.toLowerCase()}`,
          value: { date: d.date ?? "", tagline: d.tagline },
          fields: [
            { kind: "date", key: "date", label: "Date", hint: "Elle donne la pastille « 4 juin » sous le bouton du jour." },
            { kind: "text", key: "tagline", label: "Accroche", placeholder: "Le grand jour" },
          ],
          onSave: (v) => setDay(k.day, { date: str(v.date) || null, tagline: str(v.tagline) }),
        });
      }
      case "step": {
        const it = dayOf(k.day).items.find((x) => x.id === k.id);
        if (!it) return;
        return setEditor({
          title: "L'étape",
          value: { time: it.time, title: it.title, detail: it.detail, visibleFor: it.visibleFor },
          fields: [...stepFields, visibleForField("montrée")],
          onSave: (v) =>
            setSteps(
              k.day,
              dayOf(k.day).items.map((x) =>
                x.id === k.id
                  ? {
                      ...x,
                      time: str(v.time),
                      title: str(v.title),
                      detail: str(v.detail),
                      visibleFor: ids(v.visibleFor),
                    }
                  : x,
              ),
            ),
          onDelete: () => setSteps(k.day, dayOf(k.day).items.filter((x) => x.id !== k.id)),
          move: moveOf({ block: "step", day: k.day }, k.id),
        });
      }
      case "section": {
        // L'étiquette et le titre de la section, plus — pour le logement — les
        // deux textes qu'elle porte : un seul crayon pour toute la rubrique.
        const w = stationery.words;
        const fallback: Record<InviteSection, { tag: string; title: string; name: string }> = {
          rsvp: { tag: w.rsvpTag, title: w.rsvpTitle, name: "la réponse" },
          schedule: {
            tag: w.scheduleTag(days.length),
            title: w.scheduleTitle(days.length),
            name: "le déroulé",
          },
          housing: { tag: w.housingTag, title: w.housingTitle, name: "le logement" },
          venues: { tag: w.venuesTag, title: w.venuesTitle, name: "les adresses" },
          faq: { tag: w.faqTag, title: w.faqTitle, name: "les questions" },
        };
        const d = fallback[k.section];
        const tagKey = `${k.section}Tag` as const;
        const titleKey = `${k.section}Title` as const;
        const words: FieldDef[] = [
          {
            kind: "text",
            key: "tag",
            label: "Étiquette",
            placeholder: d.tag,
            max: 40,
            hint: "Vide = le mot du thème.",
          },
          {
            kind: "text",
            key: "title",
            label: "Titre",
            placeholder: d.title,
            max: 60,
            hint: "Vide = le titre du thème.",
          },
        ];
        const housing: FieldDef[] = [
          {
            kind: "text",
            key: "housedTitle",
            label: "Foyers logés sur place — titre",
            placeholder: "Un logement est déjà prévu pour vous au château.",
          },
          {
            kind: "textarea",
            key: "housedText",
            label: "Foyers logés sur place — détail",
            rows: 4,
            placeholder: "Une chambre familiale vous attend dans l'aile ouest…",
          },
          {
            kind: "textarea",
            key: "notHousedText",
            label: "Foyers à loger par leurs propres moyens",
            rows: 4,
            placeholder: "Le château est complet, mais tout est à moins de 20 minutes…",
            hint: "Chaque foyer voit l'un ou l'autre, selon sa case « logé sur place » (onglet Invités).",
          },
        ];
        return setEditor({
          title: `Le titre — ${d.name}`,
          value: {
            tag: cfg.words[tagKey],
            title: cfg.words[titleKey],
            ...(k.section === "housing"
              ? {
                  housedTitle: cfg.housedTitle,
                  housedText: cfg.housedText,
                  notHousedText: cfg.notHousedText,
                }
              : {}),
          },
          fields: k.section === "housing" ? [...words, ...housing] : words,
          onSave: (v) =>
            set({
              words: { ...cfg.words, [tagKey]: str(v.tag), [titleKey]: str(v.title) },
              ...(k.section === "housing"
                ? {
                    housedTitle: str(v.housedTitle),
                    housedText: str(v.housedText),
                    notHousedText: str(v.notHousedText),
                  }
                : {}),
            }),
        });
      }
      case "housingLink": {
        const l = cfg.housingLinks.find((x) => x.id === k.id);
        if (!l) return;
        return setEditor({
          title: "La piste de logement",
          value: { label: l.label, url: l.url },
          fields: linkFields,
          onSave: (v) =>
            set({
              housingLinks: cfg.housingLinks.map((x) =>
                x.id === k.id ? { ...x, label: str(v.label), url: str(v.url) } : x,
              ),
            }),
          onDelete: () => set({ housingLinks: cfg.housingLinks.filter((x) => x.id !== k.id) }),
          move: moveOf({ block: "housingLink" }, k.id),
        });
      }
      case "venue": {
        const v0 = cfg.venues.find((x) => x.id === k.id);
        if (!v0) return;
        return setEditor({
          title: "Le lieu",
          value: {
            name: v0.name,
            address: v0.address,
            parkingAddress: v0.parkingAddress,
            detail: v0.detail,
            when: v0.when,
            dayKey: v0.dayKey ?? "",
            visibleFor: v0.visibleFor,
          },
          fields: [...venueFields(), visibleForField("montré")],
          onSave: (v) =>
            set({
              venues: cfg.venues.map((x) =>
                x.id === k.id
                  ? {
                      ...x,
                      name: str(v.name),
                      address: str(v.address),
                      parkingAddress: str(v.parkingAddress),
                      detail: str(v.detail),
                      when: str(v.when),
                      dayKey: (str(v.dayKey) || null) as WeddingDayKey | null,
                      visibleFor: ids(v.visibleFor),
                    }
                  : x,
              ),
            }),
          onDelete: () => set({ venues: cfg.venues.filter((x) => x.id !== k.id) }),
          move: moveOf({ block: "venue" }, k.id),
        });
      }
      case "faq": {
        const f = cfg.faq.find((x) => x.id === k.id);
        if (!f) return;
        return setEditor({
          title: "La question",
          value: { question: f.question, answer: f.answer, visibleFor: f.visibleFor },
          fields: [...faqFields, visibleForField("montrée")],
          onSave: (v) =>
            set({
              faq: cfg.faq.map((x) =>
                x.id === k.id
                  ? { ...x, question: str(v.question), answer: str(v.answer), visibleFor: ids(v.visibleFor) }
                  : x,
              ),
            }),
          onDelete: () => set({ faq: cfg.faq.filter((x) => x.id !== k.id) }),
          move: moveOf({ block: "faq" }, k.id),
        });
      }
    }
  };

  /**
   * Les textes de la page publique de recherche (`/i`).
   *
   * Un champ laissé vide reprend la formulation standard — c'est le repli, pas
   * un trou : le libellé par défaut sert donc de placeholder, et l'effacer
   * revient à le rétablir.
   */
  const openLookupEdit = (block: LookupBlock) => {
    const D = INVITE_LOOKUP_TEXT_DEFAULT;
    const put = (p: Partial<InviteLookupTexts>) => set({ lookup: { ...cfg.lookup, ...p } });
    const standard = "Vide = le texte standard.";
    if (block === "header") {
      return setEditor({
        title: "L'en-tête de la page de recherche",
        value: { eyebrow: cfg.lookup.eyebrow, lead: cfg.lookup.lead },
        fields: [
          {
            kind: "text",
            key: "eyebrow",
            label: "Sur-titre",
            placeholder: D.eyebrow,
            max: 60,
            hint: "Au-dessus des prénoms, sur le thème Journal.",
          },
          {
            kind: "textarea",
            key: "lead",
            label: "Accroche",
            rows: 3,
            placeholder: D.lead,
            max: 400,
            hint: standard,
          },
        ],
        onSave: (v) => put({ eyebrow: str(v.eyebrow), lead: str(v.lead) }),
      });
    }
    return setEditor({
      title: "Le formulaire d'adresse",
      value: {
        tag: cfg.lookup.tag,
        title: cfg.lookup.title,
        hint: cfg.lookup.hint,
        button: cfg.lookup.button,
      },
      fields: [
        { kind: "text", key: "tag", label: "Étiquette", placeholder: D.tag, max: 40, hint: standard },
        { kind: "text", key: "title", label: "Titre", placeholder: D.title, max: 80, hint: standard },
        {
          kind: "textarea",
          key: "hint",
          label: "Texte sous le titre",
          rows: 3,
          placeholder: D.hint,
          max: 400,
          hint: "Ce qui dit à l'invité quoi taper. " + standard,
        },
        {
          kind: "text",
          key: "button",
          label: "Bouton",
          placeholder: D.button,
          max: 40,
          hint: standard,
        },
      ],
      onSave: (v) =>
        put({
          tag: str(v.tag),
          title: str(v.title),
          hint: str(v.hint),
          button: str(v.button),
        }),
    });
  };

  const openAdd = (k: AddKey) => {
    switch (k.block) {
      case "meal": {
        // Un repas de plus prend le jour suivant celui du dernier, quand il en
        // reste un : c'est presque toujours ce qu'on veut, et ça se change.
        const used = cfg.meals.map((m) => m.dayKey);
        const free = days.find((d) => !used.includes(d.key)) ?? days[0];
        return setEditor({
          title: "Nouveau repas",
          value: { title: "", dayKey: free?.key ?? "samedi", kidsNote: "", kidsOnly: false, visibleFor: [] },
          fields: mealFields,
          onSave: (v) =>
            setMeals([
              ...cfg.meals,
              {
                id: newRowId(),
                dayKey: (str(v.dayKey) || "samedi") as WeddingDayKey,
                title: str(v.title),
                kidsNote: str(v.kidsNote),
                kidsOnly: Boolean(v.kidsOnly),
                visibleFor: ids(v.visibleFor),
                starters: [],
                mains: [],
                desserts: [],
              },
            ]),
        });
      }
      case "dish":
        return setEditor({
          title: `Nouveau — ${COURSE[k.kind].titre.replace(/^L[ea]'?\s?/i, "").toLowerCase()}`,
          value: { name: "", detail: "", kids: false, visibleFor: [] },
          fields: dishFields(k.kind),
          onSave: (v) =>
            setDishes(k.mealId, k.kind, [
              ...dishesOfMeal(k.mealId, k.kind),
              {
                id: newRowId(),
                name: str(v.name),
                detail: str(v.detail),
                kids: Boolean(v.kids),
                visibleFor: ids(v.visibleFor),
              },
            ]),
        });
      case "step":
        return setEditor({
          title: "Nouvelle étape",
          value: { time: "", title: "", detail: "", visibleFor: [] },
          fields: [...stepFields, visibleForField("montrée")],
          onSave: (v) =>
            setSteps(k.day, [
              ...dayOf(k.day).items,
              {
                id: newRowId(),
                time: str(v.time),
                title: str(v.title),
                detail: str(v.detail),
                visibleFor: ids(v.visibleFor),
              },
            ]),
        });
      case "housingLink":
        return setEditor({
          title: "Nouvelle piste de logement",
          value: { label: "", url: "" },
          fields: linkFields,
          onSave: (v) =>
            set({
              housingLinks: [...cfg.housingLinks, { id: newRowId(), label: str(v.label), url: str(v.url) }],
            }),
        });
      case "venue":
        return setEditor({
          title: "Nouveau lieu",
          value: {
            name: "",
            address: "",
            parkingAddress: "",
            detail: "",
            when: "",
            dayKey: "",
            visibleFor: [],
          },
          fields: [...venueFields(), visibleForField("montré")],
          onSave: (v) =>
            set({
              venues: [
                ...cfg.venues,
                {
                  id: newRowId(),
                  name: str(v.name),
                  address: str(v.address),
                  parkingAddress: str(v.parkingAddress),
                  detail: str(v.detail),
                  when: str(v.when),
                  dayKey: (str(v.dayKey) || null) as WeddingDayKey | null,
                  visibleFor: ids(v.visibleFor),
                },
              ],
            }),
        });
      case "faq":
        return setEditor({
          title: "Nouvelle question",
          value: { question: "", answer: "", visibleFor: [] },
          fields: [...faqFields, visibleForField("montrée")],
          onSave: (v) =>
            set({
              faq: [
                ...cfg.faq,
                {
                  id: newRowId(),
                  question: str(v.question),
                  answer: str(v.answer),
                  visibleFor: ids(v.visibleFor),
                },
              ],
            }),
        });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {save.isPending && (
        <span className="self-end text-sm text-slate-400">Enregistrement…</span>
      )}

      <InviteStats guests={guests ?? []} cfg={cfg} />

      {/* Un échec d'enregistrement doit **arrêter** la saisie, pas se murmurer :
          le faire-part part d'un seul bloc, donc tant que le serveur refuse, tout
          ce qu'on tape ensuite est perdu au rechargement. Le bandeau colle en
          haut et nomme le champ fautif. */}
      {save.isError && (
        <div className="sticky top-0 z-30 flex flex-wrap items-start gap-3 rounded-2xl border border-danger/50 bg-danger-soft p-3.5">
          <IconAlert size={20} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-danger">
              Vos modifications ne sont plus enregistrées.
            </div>
            <p className="mt-0.5 text-xs text-ink-2">
              {(save.error as Error | null)?.message || "Le serveur a refusé la dernière modification."}
              {" — corrigez ce point, puis réessayez. N'actualisez pas la page : ce que vous avez saisi depuis serait perdu."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => save.mutate(cfg)}
            className="btn-primary shrink-0 text-xs"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Le thème est posé juste au-dessus du canevas : c'est le premier choix
          de la mise en page, et son effet se lit dans la ligne du dessous. */}
      <ThemePicker value={cfg.theme} onChange={(theme) => set({ theme })} />

      {/* Le lien public et sa page viennent avant le faire-part : c'est l'ordre
          dans lequel l'invité les rencontre — il tape l'adresse, puis il ouvre
          son invitation. */}
      <PublicLookupLink />

      {/* La page qui répond à ce lien — le premier écran d'un invité qui n'a
          plus son lien propre. Éditable au même titre que le faire-part : c'est
          le même rendu que la vraie page, crayons en plus. La recherche y est
          inerte, il n'y a rien à trouver dans un aperçu. */}
      <div
        className="overflow-hidden rounded-2xl border border-line"
        style={{ background: stationery.C.paper, color: stationery.C.ink }}
      >
        <LookupView
          key={cfg.theme}
          chrome={lookupPreview}
          edit={{ onEdit: openLookupEdit }}
        />
      </div>

      {/* Le canevas : la papeterie garde ses couleurs, quel que soit le thème
          de l'utilisateur — c'est tout l'intérêt d'un aperçu. */}
      <div
        className="overflow-hidden rounded-2xl border border-line"
        style={{ background: stationery.C.paper, color: stationery.C.ink, paddingBottom: 28 }}
      >
        <InvitationView
          key={`${cfg.theme}:${days.map((d) => d.key).join()}`}
          invitation={preview}
          edit={{ onEdit: openEdit, onAdd: openAdd, onReorder: reorder, categories: categories.list }}
        />
      </div>

      {editor && (
        <EditModal
          spec={editor}
          onClose={() => setEditor(null)}
        />
      )}

    </div>
  );
}

/**
 * Le thème du faire-part.
 *
 * Deux papeteries, pas deux contenus : ce qu'on a saisi ne bouge pas d'un thème
 * à l'autre, seules la mise en page, les polices et les couleurs changent. La
 * vignette montre le papier, l'encre et la couleur d'accent — c'est ce qui
 * distingue les deux d'un coup d'œil, mieux qu'un nom.
 */
function ThemePicker({ value, onChange }: { value: InviteTheme; onChange: (v: InviteTheme) => void }) {
  return (
    <div className="card flex flex-col gap-3">
      <div>
        <span className="text-sm font-medium">Thème du faire-part</span>
        <p className="mt-0.5 text-xs text-slate-400">
          Le contenu ne bouge pas : seuls la mise en page, les polices et les couleurs changent —
          pour vos invités comme dans l'aperçu ci-dessous.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {INVITE_THEMES.map((id) => {
          const t = STATIONERY[id];
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={on}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                on ? "border-brand-600 bg-brand-50 dark:bg-brand-600/10" : "border-line hover:bg-surface-2"
              }`}
            >
              <span
                className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-1"
                style={{
                  background: t.C.paper,
                  border: `1px solid ${t.C.ink}`,
                  borderRadius: t.radius === 0 ? 2 : 10,
                  boxShadow: t.shadow === "none" ? undefined : `3px 3px 0 ${t.C.ink}1f`,
                }}
                aria-hidden="true"
              >
                <span style={{ font: `400 17px/1 ${t.SERIF}`, color: t.C.ink }}>Aa</span>
                <span style={{ width: 18, height: 2, background: t.C.accent }} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-xs text-ink-2">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * L'adresse **unique** à faire circuler, celle qui vaut pour tout le monde.
 *
 * Chaque foyer a son lien propre (`/i/<code>`), mais on ne peut pas le publier
 * : il faudrait un message par foyer, et il se perd dans un fil de discussion.
 * Celle-ci se met sur un carton, dans un groupe WhatsApp, au dos de
 * l'enveloppe — l'invité y retrouve son faire-part avec son adresse postale.
 */
function PublicLookupLink() {
  const url = `${window.location.origin}/i`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="card flex flex-col gap-1.5">
      <span className="text-sm font-medium">Lien à communiquer à tous les invités</span>
      <div className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-1 dark:border-slate-700">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{url}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="min-h-tap shrink-0 rounded-lg px-2 text-sm font-medium text-brand-600"
        >
          {copied ? "Copié" : "Copier"}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener"
          aria-label="Ouvrir la page de recherche"
          className="flex h-tap w-tap shrink-0 items-center justify-center text-slate-400 hover:text-brand-600"
        >
          <IconExternal size={18} />
        </a>
      </div>
      <span className="text-xs text-slate-400">
        Chacun y retrouve son faire-part avec son adresse postale — pas besoin d'envoyer un lien
        différent à chaque foyer.
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ce que le faire-part a produit                                      */
/* ------------------------------------------------------------------ */

/**
 * Une ligne « nom …… nombre », avec sa part du total.
 *
 * Le chiffre **mène aux personnes qu'il compte** (`/wedding/invites?main=…`) :
 * un « 1 » en face d'un plat appelle immédiatement la question « lequel ? », et
 * on répondait jusqu'ici en dépliant les foyers un par un.
 */
function TallyRow({ label, n, total, to }: { label: string; n: number; total: number; to: string }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <Link
      to={to}
      className="group -mx-2 flex min-h-7 items-center gap-2 rounded-lg px-2 transition hover:bg-surface-2"
      title={`Voir les convives — ${label}`}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {/* Le nombre et sa part restent collés : à trois colonnes, un pourcentage
          calé au loin se lisait comme celui de la colonne voisine. */}
      <span className="shrink-0 whitespace-nowrap">
        {/* Vert souligné : dans cette app le vert dit « cliquable ». Sans lui,
            une colonne de chiffres se lit comme un tableau mort. */}
        <span className="text-sm font-semibold tabular-nums text-brand-600 underline decoration-brand-600/40 underline-offset-4 group-hover:decoration-brand-600">
          {n}
        </span>
        <span className="ml-1.5 text-xs tabular-nums text-slate-400">({pct} %)</span>
      </span>
    </Link>
  );
}

/**
 * Le décompte d'**un** repas, replié par défaut.
 *
 * Déplié, un repas de trois services tient trois colonnes de lignes : deux
 * repas remplissaient l'écran avant qu'on ait vu le reste de l'onglet. La ligne
 * repliée dit déjà l'essentiel — combien ont choisi, service par service — et
 * on ne déplie que celui qu'on veut détailler.
 */
function MealTally({
  mealId,
  title,
  meta,
  courses,
  diets,
}: {
  mealId: string;
  title: string;
  meta: string;
  courses: {
    kind: Course;
    titre: string;
    param: string;
    eaters: WeddingGuest[];
    rows: { id: string; label: string; n: number }[];
    missing: number;
  }[];
  /** Les convives de **ce** repas qui ont déclaré une allergie ou un régime. */
  diets: WeddingGuest[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-1.5 flex items-start gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-surface-2"
      >
        <IconChevronDown
          size={18}
          className={`mt-1 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">
            {title} <span className="text-sm font-normal text-slate-400">{meta}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
            {courses.map((c) => (
              <span key={c.kind} className="tabular-nums">
                <span className="font-semibold text-ink">{c.eaters.length - c.missing}</span>/
                {c.eaters.length} {c.titre.toLowerCase()}
              </span>
            ))}
          </span>
        </span>
        {/* Les allergies se comptent sur la première ligne, à droite : le
            traiteur veut savoir s'il y en a, pas encore lesquelles. Le détail
            attend le dépliage. */}
        {diets.length > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-warning"
            title={`${diets.length} allergie${diets.length > 1 ? "s" : ""} ou régime${diets.length > 1 ? "s" : ""}`}
          >
            <IconAlert size={16} />
            {diets.length}
          </span>
        )}
      </button>
      {open && (
        /* Trois services côte à côte : ils se comparent d'un regard au lieu de
           s'empiler. */
        <div className="mt-1 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {courses.map((c) => (
            <div key={c.kind}>
              <SectionLabel>{c.titre}</SectionLabel>
              <div className="mt-0.5">
                {c.rows.map((r) => (
                  <TallyRow
                    key={r.id}
                    label={r.label}
                    n={r.n}
                    total={c.eaters.length}
                    to={`/wedding/invites?meal=${encodeURIComponent(mealId)}&${c.param}=${encodeURIComponent(r.id)}`}
                  />
                ))}
                <TallyRow
                  label="Pas encore choisi"
                  n={c.missing}
                  total={c.eaters.length}
                  to={`/wedding/invites?meal=${encodeURIComponent(mealId)}&${c.param}=none`}
                />
              </div>
            </div>
          ))}
          {diets.length > 0 && (
            <div className="sm:col-span-3">
              <SectionLabel>Allergies et régimes · {diets.length}</SectionLabel>
              <ul className="mt-0.5 flex flex-col">
                {diets.map((g) => (
                  <DietRow key={g.id} guest={g} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Une allergie déclarée — la même ligne dans un repas ou hors repas. */
function DietRow({ guest }: { guest: WeddingGuest }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <IconAlert size={16} className="mt-0.5 shrink-0 text-warning" />
      <span>
        <span className="font-medium">{guest.name}</span>
        <span className="text-ink-2"> — {guest.rsvpDiet}</span>
      </span>
    </li>
  );
}

/**
 * Suivi des faire-part et des choix de repas.
 *
 * Les envois se comptent par **foyer** — c'est le foyer qui reçoit un lien —
 * et les plats par **personne**, puisque chacun choisit le sien.
 */
function InviteStats({ guests, cfg }: { guests: WeddingGuest[]; cfg: WeddingInviteConfig }) {
  const days = useMe().household.weddingDays;
  const dayLabelOf = (k: WeddingDayKey) => days.find((d) => d.key === k)?.label ?? k;
  const heads = guests.filter((g) => !g.parentId && !g.archived);
  const total = heads.length;
  const n = (s: InvitationStatus) => heads.filter((h) => h.invitationStatus === s).length;
  const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)} %` : "—");
  const tile = (v: number) => (
    <>
      {v}
      <span className="ml-1.5 text-xs font-normal text-slate-400">{pct(v)}</span>
    </>
  );

  // Un repas ne concerne que les personnes présentes **son** jour.
  const eatersOf = (m: InviteMeal) => guests.filter((g) => !g.archived && g[m.dayKey]);

  /** Les trois services d'un repas, avec ce que chacun a rassemblé. */
  const coursesOf = (m: InviteMeal) => {
    const eaters = eatersOf(m);
    const pick = (g: WeddingGuest, kind: Course) => choiceFor(g.rsvpMeals, m.id)[COURSE_PICK[kind]];
    return (["starters", "mains", "desserts"] as const)
      .map((kind) => ({
        kind,
        titre: COURSE_LABEL[kind],
        // `param` : la clé du filtre côté onglet Invités (`?meal=…&starter=<id>`).
        param: COURSE_PARAM[kind],
        eaters,
        rows: m[kind].map((d) => ({
          id: d.id,
          label: d.name || "Sans nom",
          n: eaters.filter((g) => pick(g, kind) === d.id).length,
        })),
        missing:
          m[kind].length === 0
            ? 0
            : eaters.filter((g) => !m[kind].some((d) => d.id === pick(g, kind))).length,
      }))
      .filter((c) => c.rows.length > 0);
  };

  const servedMeals = mealsInDayOrder(cfg.meals.filter((m) => coursesOf(m).length > 0));
  const diets = guests.filter((g) => !g.archived && g.rsvpDiet);
  /**
   * Les allergies suivent le repas qu'elles concernent. Celles de convives qui
   * ne sont attendus à aucun repas servi restent listées à part : une allergie
   * ne doit jamais disparaître d'un écran parce qu'aucune carte ne la porte.
   */
  const dietsOf = (m: InviteMeal) => diets.filter((g) => g[m.dayKey]);
  const looseDiets = diets.filter((g) => !servedMeals.some((m) => g[m.dayKey]));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Indicator label="Foyers" value={total} />
        <Indicator label="À envoyer" value={tile(n("to_send"))} tone={n("to_send") > 0 ? "orange" : "default"} />
        <Indicator label="Envoyé" value={tile(n("sent"))} />
        <Indicator label="Ouvert" value={tile(n("opened"))} />
        <Indicator label="Répondu" value={tile(n("filled"))} tone={n("filled") > 0 ? "green" : "default"} />
      </div>

      {/* Un bloc par repas, trois services par bloc : ils se comparent d'un
          regard au lieu de s'empiler, et deux repas ne se confondent pas. */}
      {(servedMeals.length > 0 || looseDiets.length > 0) && (
        <div className="card flex flex-col gap-3">
          {servedMeals.map((m) => (
            <MealTally
              key={m.id}
              mealId={m.id}
              title={m.title || "Le repas"}
              meta={`${dayLabelOf(m.dayKey)} · ${eatersOf(m).length} convives`}
              courses={coursesOf(m)}
              diets={dietsOf(m)}
            />
          ))}
          {looseDiets.length > 0 && (
            <div>
              <SectionLabel>Allergies et régimes · {looseDiets.length}</SectionLabel>
              <ul className="mt-0.5 flex flex-col">
                {looseDiets.map((g) => (
                  <DietRow key={g.id} guest={g} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Éditeur générique                                                   */
/* ------------------------------------------------------------------ */

type FieldValue = string | boolean | string[];
type FieldDef =
  // `max` reprend la limite du schéma : le champ s'arrête à la saisie plutôt
  // que d'être tronqué en silence à l'enregistrement.
  | { kind: "text"; key: string; label: string; placeholder?: string; hint?: string; max?: number }
  | { kind: "textarea"; key: string; label: string; rows?: number; placeholder?: string; hint?: string; max?: number }
  | { kind: "date"; key: string; label: string; hint?: string }
  | { kind: "select"; key: string; label: string; options: Option[]; hint?: string }
  | { kind: "switch"; key: string; label: string; hint?: string }
  | { kind: "tags"; key: string; label: string; hint?: string };

interface EditorSpec {
  title: string;
  fields: FieldDef[];
  value: Record<string, FieldValue>;
  onSave: (v: Record<string, FieldValue>) => void;
  /** Absent = création, ou bloc qui ne se supprime pas (l'en-tête, le pied). */
  onDelete?: () => void;
  /**
   * Déplacement dans la liste. `null` = l'élément est déjà en bout de liste.
   * Absent = le bloc n'appartient à aucune liste.
   */
  move?: { up: (() => void) | null; down: (() => void) | null };
}

const str = (v: FieldValue | undefined) => (typeof v === "string" ? v : "");
const ids = (v: FieldValue | undefined) => (Array.isArray(v) ? v : []);

const stepFields: FieldDef[] = [
  { kind: "text", key: "time", label: "Heure", placeholder: "15h10", hint: "Texte libre : « Midi », « En fin d'après-midi »…", max: 20 },
  { kind: "text", key: "title", label: "Titre", placeholder: "Cérémonie civile", max: 120 },
  { kind: "text", key: "detail", label: "Détail", placeholder: "Rendez-vous 15 min avant, parking juste à côté.", max: 400 },
];

const linkFields: FieldDef[] = [
  { kind: "text", key: "label", label: "Libellé", placeholder: "Airbnb autour d'Amécourt", max: 80 },
  { kind: "text", key: "url", label: "Adresse du lien", placeholder: "https://…", max: 400, hint: "Le « https:// » est ajouté tout seul s'il manque." },
];

const faqFields: FieldDef[] = [
  { kind: "text", key: "question", label: "Question", placeholder: "On s'habille comment ?", max: 160 },
  { kind: "textarea", key: "answer", label: "Réponse", rows: 4, max: 1200 },
];

function FieldWrap({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/**
 * Éditeur d'un bloc du faire-part. Volontairement rendu dans le langage de
 * l'app (et non dans celui de la papeterie) : c'est l'outil, pas le résultat.
 */
function EditModal({ spec, onClose }: { spec: EditorSpec; onClose: () => void }) {
  const categories = useWeddingCategories();
  const [v, setV] = useState<Record<string, FieldValue>>(spec.value);
  const put = (key: string, value: FieldValue) => setV((prev) => ({ ...prev, [key]: value }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{spec.title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-ink" aria-label="Fermer">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            spec.onSave(v);
            onClose();
          }}
          className="flex flex-col gap-3"
        >
          {spec.fields.map((f) => {
            switch (f.kind) {
              case "text":
                return (
                  <FieldWrap key={f.key} label={f.label} hint={f.hint}>
                    <Input
                      value={str(v[f.key])}
                      placeholder={f.placeholder}
                      maxLength={f.max}
                      onChange={(e) => put(f.key, e.target.value)}
                    />
                  </FieldWrap>
                );
              case "textarea":
                return (
                  <FieldWrap key={f.key} label={f.label} hint={f.hint}>
                    <textarea
                      rows={f.rows ?? 3}
                      value={str(v[f.key])}
                      placeholder={f.placeholder}
                      maxLength={f.max}
                      onChange={(e) => put(f.key, e.target.value)}
                      className={`${inputClass} resize-y leading-relaxed`}
                    />
                  </FieldWrap>
                );
              case "date":
                return (
                  <FieldWrap key={f.key} label={f.label} hint={f.hint}>
                    <DateInput
                      value={str(v[f.key])}
                      onChange={(d) => put(f.key, d)}
                      placeholder="Aucune date"
                    />
                  </FieldWrap>
                );
              case "select":
                return (
                  <FieldWrap key={f.key} label={f.label} hint={f.hint}>
                    <Select
                      value={str(v[f.key])}
                      onChange={(val) => put(f.key, val)}
                      options={f.options}
                    />
                  </FieldWrap>
                );
              case "tags":
                return (
                  <FieldWrap key={f.key} label={f.label} hint={f.hint}>
                    <TagSelect
                      options={categories.list}
                      value={ids(v[f.key])}
                      onChange={(next) => put(f.key, next)}
                      onCreate={categories.create}
                      placeholder="Tout le monde"
                    />
                  </FieldWrap>
                );
              case "switch":
                return (
                  <div key={f.key} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{f.label}</span>
                      {f.hint && <span className="mt-0.5 block text-xs text-slate-400">{f.hint}</span>}
                    </span>
                    <Switch checked={Boolean(v[f.key])} onChange={() => put(f.key, !v[f.key])} />
                  </div>
                );
            }
          })}

          {/* Réordonner à la souris se fait en glissant dans l'aperçu ; ici, c'est
              le chemin qui marche partout — et le seul qui marche au doigt. */}
          {spec.move && (spec.move.up || spec.move.down) && (
            <div className="flex items-center gap-2 rounded-xl border border-line p-2">
              <span className="min-w-0 flex-1 text-sm text-ink-2">Place dans la liste</span>
              <button
                type="button"
                disabled={!spec.move.up}
                onClick={() => {
                  spec.move?.up?.();
                  onClose();
                }}
                className="btn-ghost min-h-tap px-4 disabled:opacity-40"
              >
                ↑ Monter
              </button>
              <button
                type="button"
                disabled={!spec.move.down}
                onClick={() => {
                  spec.move?.down?.();
                  onClose();
                }}
                className="btn-ghost min-h-tap px-4 disabled:opacity-40"
              >
                ↓ Descendre
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {spec.onDelete ? (
              <button
                type="button"
                onClick={() => {
                  spec.onDelete?.();
                  onClose();
                }}
                className="text-sm font-medium text-danger"
              >
                Supprimer
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-ghost">
                Annuler
              </button>
              <button className="btn-primary">Appliquer</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
