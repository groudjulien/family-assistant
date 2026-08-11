import type { Context } from "hono";
import { eq, and } from "drizzle-orm";
import {
  task,
  recipe,
  shoppingItem,
  trip,
  tripItem,
  weddingTodo,
  weddingGuest,
  household,
  user,
} from "../db/schema";
import { newId, nowIso } from "./util";
import type { AppContext } from "./types";
import type { ClaudeToolDef } from "./anthropic";

type Ctx = Context<AppContext>;
type Input = Record<string, unknown>;

/* ----------------------------- helpers ----------------------------- */

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
const numv = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};
const b01 = (v: unknown): number | undefined => {
  if (v === true || v === 1 || v === "true") return 1;
  if (v === false || v === 0 || v === "false") return 0;
  return undefined;
};
const arr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

const db = (c: Ctx) => c.get("db");
const hid = (c: Ctx) => c.get("household").id;

/** Slot membre depuis « a »/« b » ou le prénom configuré du foyer. */
function resolveSlot(c: Ctx, member: string | undefined): "a" | "b" | null {
  if (!member) return null;
  const h = c.get("household");
  const m = member.trim().toLowerCase();
  if (m === "a" || m === h.memberAName.toLowerCase()) return "a";
  if (m === "b" || m === h.memberBName.toLowerCase()) return "b";
  return null;
}

async function resolveAssignee(c: Ctx, member: string | undefined): Promise<string | null> {
  const m = resolveSlot(c, member);
  if (!m) return null;
  const u = (
    await db(c).select().from(user).where(and(eq(user.householdId, hid(c)), eq(user.member, m)))
  )[0];
  return u?.id ?? null;
}

export interface ChatTool {
  def: ClaudeToolDef;
  sensitive: boolean;
  summarize: (input: Input) => string;
  execute: (c: Ctx, input: Input) => Promise<unknown>;
}

/* ------------------------------------------------------------------ */
/* Définition des outils                                               */
/* ------------------------------------------------------------------ */

export const TOOLS: Record<string, ChatTool> = {
  /* ----------------------------- lecture ---------------------------- */
  list_tasks: {
    sensitive: false,
    def: {
      name: "list_tasks",
      description:
        "Liste les tâches du foyer (avec leur id, titre, statut, priorité, échéance, responsable, tâche parente). Utilise-le pour retrouver l'id d'une tâche avant de la modifier ou la supprimer.",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lister les tâches",
    execute: async (c) => {
      const rows = await db(c).select().from(task).where(eq(task.householdId, hid(c)));
      return rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        assigneeId: t.assigneeId,
        parentTaskId: t.parentTaskId,
      }));
    },
  },

  list_recipes: {
    sensitive: false,
    def: {
      name: "list_recipes",
      description: "Liste les recettes (id + titre) pour retrouver l'id d'une recette.",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lister les recettes",
    execute: async (c) => {
      const rows = await db(c).select().from(recipe).where(eq(recipe.householdId, hid(c)));
      return rows.map((r) => ({ id: r.id, title: r.title }));
    },
  },

  list_shopping_items: {
    sensitive: false,
    def: {
      name: "list_shopping_items",
      description: "Liste les articles de la liste de courses (id, nom, quantité).",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lister la liste de courses",
    execute: async (c) => {
      const rows = await db(c).select().from(shoppingItem).where(eq(shoppingItem.householdId, hid(c)));
      return rows.map((r) => ({ id: r.id, name: r.name, quantity: r.quantity }));
    },
  },

  list_trips: {
    sensitive: false,
    def: {
      name: "list_trips",
      description:
        "Liste les voyages et leurs étapes (id, nom, dates, et pour chaque étape : id, type, titre, dates).",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lister les voyages",
    execute: async (c) => {
      const trips = await db(c).select().from(trip).where(eq(trip.householdId, hid(c)));
      const items = await db(c).select().from(tripItem).where(eq(tripItem.householdId, hid(c)));
      return trips.map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        items: items
          .filter((i) => i.tripId === t.id)
          .map((i) => ({
            id: i.id,
            type: i.type,
            mode: i.mode,
            title: i.title,
            startAt: i.startAt,
            endAt: i.endAt,
          })),
      }));
    },
  },

  list_wedding_todos: {
    sensitive: false,
    def: {
      name: "list_wedding_todos",
      description: "Liste les tâches de l'organisation du mariage (id, description, fait, échéance, responsable).",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lister les todos mariage",
    execute: async (c) => {
      const rows = await db(c).select().from(weddingTodo).where(eq(weddingTodo.householdId, hid(c)));
      return rows.map((r) => ({
        id: r.id,
        description: r.description,
        done: !!r.done,
        dueDate: r.dueDate,
        owner: r.owner,
      }));
    },
  },

  list_wedding_guests: {
    sensitive: false,
    def: {
      name: "list_wedding_guests",
      description:
        "Liste les invités du mariage (id, nom, type, présence vendredi/samedi/dimanche, archivé, invité parent éventuel).",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lister les invités",
    execute: async (c) => {
      const rows = await db(c).select().from(weddingGuest).where(eq(weddingGuest.householdId, hid(c)));
      return rows.map((g) => ({
        id: g.id,
        name: g.name,
        type: g.type,
        vendredi: !!g.vendredi,
        samedi: !!g.samedi,
        dimanche: !!g.dimanche,
        archived: !!g.archived,
        parentId: g.parentId,
      }));
    },
  },

  get_money_settings: {
    sensitive: false,
    def: {
      name: "get_money_settings",
      description: "Récupère les réglages d'argent du foyer (clé de répartition entre les deux membres a/b).",
      input_schema: { type: "object", properties: {} },
    },
    summarize: () => "Lire les réglages d'argent",
    execute: async (c) => {
      const h = c.get("household");
      return { defaultSplitA: h.defaultSplitA, defaultSplitB: h.defaultSplitB };
    },
  },

  /* ------------------------------ tâches ---------------------------- */
  create_task: {
    sensitive: false,
    def: {
      name: "create_task",
      description: "Crée une tâche (todo). Pour une sous-tâche, fournis parentTaskId.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre de la tâche" },
          priority: { type: "integer", description: "Priorité 1 (basse) à 4 (haute)", minimum: 1, maximum: 4 },
          dueDate: { type: "string", description: "Échéance YYYY-MM-DD" },
          assignee: { type: "string", enum: ["a", "b"], description: "Responsable" },
          parentTaskId: { type: "string", description: "Id de la tâche parente (sous-tâche)" },
        },
        required: ["title"],
      },
    },
    summarize: (i) => `Créer la tâche « ${str(i.title)} »`,
    execute: async (c, i) => {
      const title = str(i.title);
      if (!title) throw new Error("Titre manquant");
      const id = newId();
      const now = nowIso();
      await db(c)
        .insert(task)
        .values({
          id,
          householdId: hid(c),
          parentTaskId: str(i.parentTaskId) ?? null,
          title,
          status: "todo",
          priority: numv(i.priority) ?? 2,
          position: Date.now(),
          dueDate: str(i.dueDate) ?? null,
          assigneeId: await resolveAssignee(c, str(i.assignee)),
          createdBy: c.get("user").id,
          createdAt: now,
          updatedAt: now,
        });
      return { ok: true, id, title };
    },
  },

  update_task: {
    sensitive: false,
    def: {
      name: "update_task",
      description: "Modifie une tâche existante (titre, priorité, échéance, responsable, statut). Mets status='done' pour la cocher.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 4 },
          dueDate: { type: ["string", "null"] },
          assignee: { type: ["string", "null"], enum: ["a", "b", null] },
          status: { type: "string", enum: ["todo", "done"] },
        },
        required: ["id"],
      },
    },
    summarize: (i) => `Modifier la tâche ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      const set: Record<string, unknown> = { updatedAt: nowIso() };
      if (str(i.title)) set.title = str(i.title);
      if (numv(i.priority) !== undefined) set.priority = numv(i.priority);
      if ("dueDate" in i) set.dueDate = str(i.dueDate) ?? null;
      if ("assignee" in i) set.assigneeId = await resolveAssignee(c, str(i.assignee));
      if (str(i.status)) set.status = str(i.status);
      await db(c).update(task).set(set).where(and(eq(task.id, id), eq(task.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  delete_task: {
    sensitive: true,
    def: {
      name: "delete_task",
      description: "Supprime une tâche (et ses sous-tâches).",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Supprimer la tâche ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(task).where(and(eq(task.parentTaskId, id), eq(task.householdId, hid(c))));
      await db(c).delete(task).where(and(eq(task.id, id), eq(task.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  /* ------------------------- repas / courses ------------------------ */
  add_shopping_item: {
    sensitive: false,
    def: {
      name: "add_shopping_item",
      description: "Ajoute un article à la liste de courses.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "integer", minimum: 1 },
        },
        required: ["name"],
      },
    },
    summarize: (i) => `Ajouter « ${str(i.name)} » aux courses`,
    execute: async (c, i) => {
      const name = str(i.name);
      if (!name) throw new Error("Nom manquant");
      const id = newId();
      await db(c)
        .insert(shoppingItem)
        .values({ id, householdId: hid(c), name, quantity: numv(i.quantity) ?? 1, createdAt: nowIso() });
      return { ok: true, id, name };
    },
  },

  delete_shopping_item: {
    sensitive: true,
    def: {
      name: "delete_shopping_item",
      description: "Retire un article de la liste de courses.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Retirer l'article ${str(i.id)} des courses`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(shoppingItem).where(and(eq(shoppingItem.id, id), eq(shoppingItem.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  create_recipe: {
    sensitive: false,
    def: {
      name: "create_recipe",
      description: "Crée une recette.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          servings: { type: "integer", minimum: 1 },
          prepMinutes: { type: "integer", minimum: 0 },
          totalMinutes: { type: "integer", minimum: 0 },
          vegetarian: { type: "boolean" },
          meat: {
            type: ["string", "null"],
            enum: ["poulet", "veau", "porc", "boeuf", "agneau", "canard", "poisson", null],
          },
          starch: { type: "string", enum: ["pates", "riz", "patate", "semoule", "aucun"] },
          vegetables: { type: "boolean" },
          ingredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          sourceUrl: { type: "string" },
          imageUrl: { type: "string", description: "URL d'une image / photo de la recette" },
        },
        required: ["title"],
      },
    },
    summarize: (i) => `Créer la recette « ${str(i.title)} »`,
    execute: async (c, i) => {
      const title = str(i.title);
      if (!title) throw new Error("Titre manquant");
      const id = newId();
      await db(c)
        .insert(recipe)
        .values({
          id,
          householdId: hid(c),
          title,
          sourceUrl: str(i.sourceUrl) ?? null,
          imageUrl: str(i.imageUrl) ?? null,
          servings: numv(i.servings) ?? 4,
          prepMinutes: numv(i.prepMinutes) ?? null,
          totalMinutes: numv(i.totalMinutes) ?? null,
          vegetarian: b01(i.vegetarian) ?? 0,
          meat: str(i.meat) ?? null,
          starch: str(i.starch) ?? "aucun",
          vegetables: b01(i.vegetables) ?? 0,
          ingredients: JSON.stringify(arr(i.ingredients) ?? []),
          steps: JSON.stringify(arr(i.steps) ?? []),
          createdAt: nowIso(),
        });
      return { ok: true, id, title };
    },
  },

  update_recipe: {
    sensitive: false,
    def: {
      name: "update_recipe",
      description: "Modifie une recette existante.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          servings: { type: "integer", minimum: 1 },
          prepMinutes: { type: "integer", minimum: 0 },
          totalMinutes: { type: "integer", minimum: 0 },
          vegetarian: { type: "boolean" },
          meat: {
            type: ["string", "null"],
            enum: ["poulet", "veau", "porc", "boeuf", "agneau", "canard", "poisson", null],
          },
          starch: { type: "string", enum: ["pates", "riz", "patate", "semoule", "aucun"] },
          vegetables: { type: "boolean" },
          ingredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          sourceUrl: { type: ["string", "null"] },
          imageUrl: { type: ["string", "null"], description: "URL d'une image / photo de la recette" },
        },
        required: ["id"],
      },
    },
    summarize: (i) => `Modifier la recette ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      const set: Record<string, unknown> = {};
      if (str(i.title)) set.title = str(i.title);
      if (numv(i.servings) !== undefined) set.servings = numv(i.servings);
      if ("prepMinutes" in i) set.prepMinutes = numv(i.prepMinutes) ?? null;
      if ("totalMinutes" in i) set.totalMinutes = numv(i.totalMinutes) ?? null;
      if (b01(i.vegetarian) !== undefined) set.vegetarian = b01(i.vegetarian);
      if ("meat" in i) set.meat = str(i.meat) ?? null;
      if (str(i.starch)) set.starch = str(i.starch);
      if (b01(i.vegetables) !== undefined) set.vegetables = b01(i.vegetables);
      if (arr(i.ingredients)) set.ingredients = JSON.stringify(arr(i.ingredients));
      if (arr(i.steps)) set.steps = JSON.stringify(arr(i.steps));
      if ("sourceUrl" in i) set.sourceUrl = str(i.sourceUrl) ?? null;
      if ("imageUrl" in i) set.imageUrl = str(i.imageUrl) ?? null;
      await db(c).update(recipe).set(set).where(and(eq(recipe.id, id), eq(recipe.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  delete_recipe: {
    sensitive: true,
    def: {
      name: "delete_recipe",
      description: "Supprime une recette.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Supprimer la recette ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(recipe).where(and(eq(recipe.id, id), eq(recipe.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  /* ------------------------------ voyages --------------------------- */
  create_trip: {
    sensitive: false,
    def: {
      name: "create_trip",
      description: "Crée un voyage.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["name"],
      },
    },
    summarize: (i) => `Créer le voyage « ${str(i.name)} »`,
    execute: async (c, i) => {
      const name = str(i.name);
      if (!name) throw new Error("Nom manquant");
      const id = newId();
      await db(c)
        .insert(trip)
        .values({
          id,
          householdId: hid(c),
          name,
          startDate: str(i.startDate) ?? null,
          endDate: str(i.endDate) ?? null,
          createdAt: nowIso(),
        });
      return { ok: true, id, name };
    },
  },

  update_trip: {
    sensitive: false,
    def: {
      name: "update_trip",
      description: "Modifie un voyage (nom, dates).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          startDate: { type: ["string", "null"] },
          endDate: { type: ["string", "null"] },
        },
        required: ["id"],
      },
    },
    summarize: (i) => `Modifier le voyage ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      const set: Record<string, unknown> = {};
      if (str(i.name)) set.name = str(i.name);
      if ("startDate" in i) set.startDate = str(i.startDate) ?? null;
      if ("endDate" in i) set.endDate = str(i.endDate) ?? null;
      await db(c).update(trip).set(set).where(and(eq(trip.id, id), eq(trip.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  delete_trip: {
    sensitive: true,
    def: {
      name: "delete_trip",
      description: "Supprime un voyage et toutes ses étapes.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Supprimer le voyage ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(tripItem).where(and(eq(tripItem.tripId, id), eq(tripItem.householdId, hid(c))));
      await db(c).delete(trip).where(and(eq(trip.id, id), eq(trip.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  add_trip_item: {
    sensitive: false,
    def: {
      name: "add_trip_item",
      description:
        "Ajoute une étape à un voyage : transport, logement (lodging) ou activité (activity). Pour un transport, précise le mode.",
      input_schema: {
        type: "object",
        properties: {
          tripId: { type: "string" },
          type: { type: "string", enum: ["transport", "lodging", "activity"] },
          mode: { type: "string", enum: ["voiture", "train", "avion", "bateau", "bus"] },
          title: { type: "string" },
          fromPlace: { type: "string" },
          toPlace: { type: "string" },
          address: { type: "string" },
          url: { type: "string" },
          description: { type: "string" },
          startAt: { type: "string", description: "ISO date/datetime YYYY-MM-DD ou YYYY-MM-DDTHH:mm" },
          endAt: { type: "string" },
        },
        required: ["tripId", "type"],
      },
    },
    summarize: (i) => `Ajouter une étape (${str(i.type)}) au voyage ${str(i.tripId)}`,
    execute: async (c, i) => {
      const tripId = str(i.tripId);
      const type = str(i.type);
      if (!tripId || !type) throw new Error("tripId et type requis");
      const id = newId();
      await db(c)
        .insert(tripItem)
        .values({
          id,
          householdId: hid(c),
          tripId,
          type,
          mode: str(i.mode) ?? null,
          title: str(i.title) ?? null,
          fromPlace: str(i.fromPlace) ?? null,
          toPlace: str(i.toPlace) ?? null,
          address: str(i.address) ?? null,
          url: str(i.url) ?? null,
          description: str(i.description) ?? null,
          startAt: str(i.startAt) ?? null,
          endAt: str(i.endAt) ?? null,
          createdAt: nowIso(),
        });
      return { ok: true, id };
    },
  },

  update_trip_item: {
    sensitive: false,
    def: {
      name: "update_trip_item",
      description: "Modifie une étape de voyage.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          mode: { type: ["string", "null"], enum: ["voiture", "train", "avion", "bateau", "bus", null] },
          title: { type: ["string", "null"] },
          fromPlace: { type: ["string", "null"] },
          toPlace: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          startAt: { type: ["string", "null"] },
          endAt: { type: ["string", "null"] },
        },
        required: ["id"],
      },
    },
    summarize: (i) => `Modifier l'étape de voyage ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      const set: Record<string, unknown> = {};
      for (const f of ["mode", "title", "fromPlace", "toPlace", "address", "url", "description", "startAt", "endAt"]) {
        if (f in i) set[f] = str(i[f]) ?? null;
      }
      await db(c).update(tripItem).set(set).where(and(eq(tripItem.id, id), eq(tripItem.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  delete_trip_item: {
    sensitive: true,
    def: {
      name: "delete_trip_item",
      description: "Supprime une étape de voyage.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Supprimer l'étape de voyage ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(tripItem).where(and(eq(tripItem.id, id), eq(tripItem.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  /* --------------------------- mariage : todo ----------------------- */
  create_wedding_todo: {
    sensitive: false,
    def: {
      name: "create_wedding_todo",
      description: "Crée une tâche d'organisation du mariage.",
      input_schema: {
        type: "object",
        properties: {
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          owner: { type: "string", enum: ["a", "b"] },
        },
        required: ["description"],
      },
    },
    summarize: (i) => `Créer le todo mariage « ${str(i.description)} »`,
    execute: async (c, i) => {
      const description = str(i.description);
      if (!description) throw new Error("Description manquante");
      const id = newId();
      await db(c)
        .insert(weddingTodo)
        .values({
          id,
          householdId: hid(c),
          description,
          dueDate: str(i.dueDate) ?? null,
          owner: resolveSlot(c, str(i.owner)),
          done: 0,
          createdAt: nowIso(),
        });
      return { ok: true, id };
    },
  },

  update_wedding_todo: {
    sensitive: false,
    def: {
      name: "update_wedding_todo",
      description: "Modifie un todo mariage (description, échéance, responsable, fait).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          dueDate: { type: ["string", "null"] },
          owner: { type: ["string", "null"], enum: ["a", "b", null] },
          done: { type: "boolean" },
        },
        required: ["id"],
      },
    },
    summarize: (i) => `Modifier le todo mariage ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      const set: Record<string, unknown> = {};
      if (str(i.description)) set.description = str(i.description);
      if ("dueDate" in i) set.dueDate = str(i.dueDate) ?? null;
      if ("owner" in i) set.owner = resolveSlot(c, str(i.owner));
      if (b01(i.done) !== undefined) set.done = b01(i.done);
      await db(c).update(weddingTodo).set(set).where(and(eq(weddingTodo.id, id), eq(weddingTodo.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  delete_wedding_todo: {
    sensitive: true,
    def: {
      name: "delete_wedding_todo",
      description: "Supprime un todo mariage.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Supprimer le todo mariage ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(weddingTodo).where(and(eq(weddingTodo.id, id), eq(weddingTodo.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  /* -------------------------- mariage : invités --------------------- */
  create_wedding_guest: {
    sensitive: false,
    def: {
      name: "create_wedding_guest",
      description:
        "Ajoute un invité au mariage. Pour rattacher à une famille, fournis parentId (id de l'invité principal).",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["maries", "famille", "amis", "temoin"] },
          vendredi: { type: "boolean" },
          samedi: { type: "boolean" },
          dimanche: { type: "boolean" },
          address: { type: "string" },
          parentId: { type: "string" },
        },
        required: ["name"],
      },
    },
    summarize: (i) => `Ajouter l'invité « ${str(i.name)} »`,
    execute: async (c, i) => {
      const name = str(i.name);
      if (!name) throw new Error("Nom manquant");
      const id = newId();
      await db(c)
        .insert(weddingGuest)
        .values({
          id,
          householdId: hid(c),
          name,
          type: str(i.type) ?? "famille",
          guestGroup: "vendredi",
          vendredi: b01(i.vendredi) ?? 0,
          samedi: b01(i.samedi) ?? 0,
          dimanche: b01(i.dimanche) ?? 0,
          archived: 0,
          parentId: str(i.parentId) ?? null,
          address: str(i.address) ?? null,
          position: Date.now(),
          createdAt: nowIso(),
        });
      return { ok: true, id, name };
    },
  },

  update_wedding_guest: {
    sensitive: false,
    def: {
      name: "update_wedding_guest",
      description: "Modifie un invité (nom, type, présence, adresse, archivage, famille).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["maries", "famille", "amis", "temoin"] },
          vendredi: { type: "boolean" },
          samedi: { type: "boolean" },
          dimanche: { type: "boolean" },
          address: { type: ["string", "null"] },
          archived: { type: "boolean" },
          parentId: { type: ["string", "null"] },
        },
        required: ["id"],
      },
    },
    summarize: (i) => `Modifier l'invité ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      const set: Record<string, unknown> = {};
      if (str(i.name)) set.name = str(i.name);
      if (str(i.type)) set.type = str(i.type);
      if (b01(i.vendredi) !== undefined) set.vendredi = b01(i.vendredi);
      if (b01(i.samedi) !== undefined) set.samedi = b01(i.samedi);
      if (b01(i.dimanche) !== undefined) set.dimanche = b01(i.dimanche);
      if ("address" in i) set.address = str(i.address) ?? null;
      if (b01(i.archived) !== undefined) set.archived = b01(i.archived);
      if ("parentId" in i) set.parentId = str(i.parentId) ?? null;
      await db(c).update(weddingGuest).set(set).where(and(eq(weddingGuest.id, id), eq(weddingGuest.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  delete_wedding_guest: {
    sensitive: true,
    def: {
      name: "delete_wedding_guest",
      description: "Supprime un invité du mariage.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    summarize: (i) => `Supprimer l'invité ${str(i.id)}`,
    execute: async (c, i) => {
      const id = str(i.id);
      if (!id) throw new Error("Id manquant");
      await db(c).delete(weddingGuest).where(and(eq(weddingGuest.id, id), eq(weddingGuest.householdId, hid(c))));
      return { ok: true, id };
    },
  },

  /* ---------------------------- argent ------------------------------ */
  update_money_settings: {
    sensitive: true,
    def: {
      name: "update_money_settings",
      description:
        "Modifie la clé de répartition par défaut du foyer. Fournis le pourcentage du membre a (0-100) ; le membre b prend le complément.",
      input_schema: {
        type: "object",
        properties: { defaultSplitA: { type: "integer", minimum: 0, maximum: 100 } },
        required: ["defaultSplitA"],
      },
    },
    summarize: (i) =>
      `Définir la répartition ${numv(i.defaultSplitA)}% / ${100 - (numv(i.defaultSplitA) ?? 0)}%`,
    execute: async (c, i) => {
      const j = numv(i.defaultSplitA);
      if (j === undefined || j < 0 || j > 100) throw new Error("Pourcentage invalide");
      await db(c)
        .update(household)
        .set({ defaultSplitA: j, defaultSplitB: 100 - j })
        .where(eq(household.id, hid(c)));
      return { ok: true, defaultSplitA: j, defaultSplitB: 100 - j };
    },
  },
};

export const toolDefs = (): ClaudeToolDef[] => Object.values(TOOLS).map((t) => t.def);
