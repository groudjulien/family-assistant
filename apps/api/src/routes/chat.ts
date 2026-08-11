import { Hono, type Context } from "hono";
import { eq, asc } from "drizzle-orm";
import { sendChatSchema, formatEuros } from "@gfa/shared";
import { chatMessage, chatAction, task, account } from "../db/schema";
import {
  callClaudeTools,
  resolveAnthropicKey,
  type ToolMessage,
  type ClaudeContentBlock,
} from "../lib/anthropic";
import { TOOLS, toolDefs } from "../lib/chat-tools";
import { computeWeddingSummary } from "./wedding";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const chat = new Hono<AppContext>();

function actionDto(r: typeof chatAction.$inferSelect) {
  return {
    id: r.id,
    messageId: r.messageId,
    tool: r.tool,
    summary: r.summary,
    status: r.status,
    createdAt: r.createdAt,
  };
}

chat.get("/", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const messages = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.householdId, hid))
    .orderBy(asc(chatMessage.createdAt));
  const actions = await db
    .select()
    .from(chatAction)
    .where(eq(chatAction.householdId, hid))
    .orderBy(asc(chatAction.createdAt));
  return c.json({ messages, actions: actions.map(actionDto) });
});

async function buildSystemPrompt(c: Context<AppContext>): Promise<string> {
  const db = c.get("db");
  const h = c.get("household");
  const openTasks = (await db.select().from(task).where(eq(task.householdId, h.id))).filter(
    (t) => t.status !== "done" && !t.parentTaskId,
  );
  const accounts = await db.select().from(account).where(eq(account.householdId, h.id));
  const treasury = accounts.reduce((s, a) => s + a.currentBalance, 0);
  const wedding = await computeWeddingSummary(db, h);

  return [
    `Tu es l'assistant personnel du foyer "${h.name}" (${h.memberAName} et ${h.memberBName}).`,
    `Les deux membres du foyer sont identifiés par des slots techniques : "a" = ${h.memberAName}, "b" = ${h.memberBName}. Quand un outil attend un membre (assignee, owner…), utilise "a" ou "b".`,
    `Tu réponds en français, de façon concise et utile.`,
    `Contexte actuel du foyer :`,
    `- Tâches en cours : ${openTasks.length} (${openTasks.slice(0, 5).map((t) => t.title).join(", ")}).`,
    `- Trésorerie totale (soldes saisis) : ${formatEuros(treasury)}.`,
    `- Mariage le ${wedding.targetDate} : objectif ${formatEuros(wedding.targetAmount)}, épargné ${formatEuros(wedding.savedToDate)} (${wedding.percentFunded}%), il reste ${wedding.monthsLeft} mois, versement requis ${formatEuros(wedding.monthlyRequired)}/mois.`,
    ``,
    `Tu disposes d'outils pour agir sur les données du foyer : tâches, repas/recettes & liste de courses, voyages, organisation du mariage (todos et invités), et réglages d'argent.`,
    `Pour modifier ou supprimer un élément, retrouve d'abord son id avec les outils list_* (ne devine jamais un id).`,
    `Quand tu dois créer ou modifier plusieurs éléments (par ex. plusieurs sous-tâches, ou plusieurs étapes de voyage depuis une liste), émets TOUS les appels d'outils nécessaires — un par élément — dans le même tour, sans attendre entre chaque.`,
    `Les suppressions et les changements liés à l'argent nécessitent une confirmation de l'utilisateur : quand tu appelles ces outils, l'action n'est PAS exécutée immédiatement mais proposée à l'utilisateur. Dans ce cas, indique clairement que tu attends sa validation.`,
    `N'affirme jamais qu'une action est faite sans avoir réellement appelé l'outil correspondant : c'est l'appel de l'outil qui exécute l'action, pas ta phrase.`,
  ].join("\n");
}

chat.post("/", async (c) => {
  const db = c.get("db");
  const h = c.get("household");
  const u = c.get("user");
  const body = await parseBody(c, sendChatSchema);
  const now = nowIso();

  await db.insert(chatMessage).values({
    id: newId(),
    householdId: h.id,
    role: "user",
    content: body.content,
    model: null,
    inputTokens: null,
    outputTokens: null,
    userId: u.id,
    createdAt: now,
  });

  const history = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.householdId, h.id))
    .orderBy(asc(chatMessage.createdAt));

  const anthMessages: ToolMessage[] = history.slice(-20).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let system = await buildSystemPrompt(c);
  // Outils : CRUD du foyer + recherche web (server tool Anthropic) si l'utilisateur l'a activée.
  const tools: object[] = [...toolDefs()];
  if (body.webSearch) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
    system +=
      "\nLa recherche web est activée : tu peux utiliser l'outil web_search pour trouver une information en ligne, par exemple l'URL d'une image de recette à passer ensuite à update_recipe.";
  }
  const assistantId = newId();
  const pendingActions: (typeof chatAction.$inferSelect)[] = [];

  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = "";

  const apiKey = await resolveAnthropicKey(c.get("household"), c.env);
  if (!apiKey) return c.json({ error: "no_api_key" }, 400);

  try {
    for (let iter = 0; iter < 8; iter++) {
      const turn = await callClaudeTools(apiKey, body.model, system, anthMessages, tools, 4096);
      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;

      const text = turn.blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) finalText = text;

      // Rejoue le tour assistant tel quel (texte + tool_use + résultats server tools)
      anthMessages.push({ role: "assistant", content: turn.blocks });

      // pause_turn : recherche web en cours côté Anthropic → on relance pour continuer
      if (turn.stopReason === "pause_turn") continue;

      // On exécute les tool_use présents QUEL QUE SOIT le stop_reason : si la réponse
      // a été tronquée (stop_reason "max_tokens") alors qu'elle contenait des tool_use,
      // il ne faut pas sortir sans les exécuter (sinon actions perdues + tokens gâchés).
      const toolUses = turn.blocks.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) break;

      const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];

      for (const tu of toolUses) {
        const tool = tu.name ? TOOLS[tu.name] : undefined;
        const input = (tu.input ?? {}) as Record<string, unknown>;
        if (!tool) {
          results.push({ type: "tool_result", tool_use_id: tu.id ?? "", content: "Outil inconnu.", is_error: true });
          continue;
        }
        if (tool.sensitive) {
          const aid = newId();
          const row = {
            id: aid,
            householdId: h.id,
            messageId: assistantId,
            tool: tu.name as string,
            input: JSON.stringify(input),
            summary: tool.summarize(input),
            status: "pending",
            result: null,
            createdAt: nowIso(),
          };
          await db.insert(chatAction).values(row);
          pendingActions.push(row as typeof chatAction.$inferSelect);
          results.push({
            type: "tool_result",
            tool_use_id: tu.id ?? "",
            content: `Action proposée à l'utilisateur, en attente de sa confirmation (non exécutée) : ${row.summary}.`,
          });
        } else {
          try {
            const out = await tool.execute(c, input);
            results.push({ type: "tool_result", tool_use_id: tu.id ?? "", content: JSON.stringify(out) });
          } catch (err) {
            results.push({
              type: "tool_result",
              tool_use_id: tu.id ?? "",
              content: `Erreur: ${String(err)}`,
              is_error: true,
            });
          }
        }
      }

      anthMessages.push({ role: "user", content: results as unknown as ClaudeContentBlock[] });
    }
  } catch (e) {
    return c.json({ error: "claude_failed", detail: String(e) }, 502);
  }

  if (!finalText) finalText = pendingActions.length > 0 ? "J'ai préparé l'action, confirme-la pour que je l'exécute." : "…";

  const assistantMsg = {
    id: assistantId,
    householdId: h.id,
    role: "assistant" as const,
    content: finalText,
    model: body.model,
    inputTokens,
    outputTokens,
    userId: null,
    createdAt: nowIso(),
  };
  await db.insert(chatMessage).values(assistantMsg);
  return c.json({ message: assistantMsg, actions: pendingActions.map(actionDto) });
});

/* -------- Confirmation / annulation des actions sensibles ---------- */

chat.post("/actions/:id/confirm", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  const row = (
    await db.select().from(chatAction).where(eq(chatAction.id, id))
  )[0];
  if (!row || row.householdId !== hid) return c.json({ error: "not_found" }, 404);
  if (row.status !== "pending") return c.json(actionDto(row));

  const tool = TOOLS[row.tool];
  if (!tool) return c.json({ error: "unknown_tool" }, 400);

  try {
    const out = await tool.execute(c, JSON.parse(row.input));
    await db
      .update(chatAction)
      .set({ status: "confirmed", result: JSON.stringify(out) })
      .where(eq(chatAction.id, id));
    return c.json({ ...actionDto(row), status: "confirmed" });
  } catch (e) {
    return c.json({ error: "execution_failed", detail: String(e) }, 500);
  }
});

chat.post("/actions/:id/cancel", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const id = c.req.param("id");
  const row = (await db.select().from(chatAction).where(eq(chatAction.id, id)))[0];
  if (!row || row.householdId !== hid) return c.json({ error: "not_found" }, 404);
  if (row.status === "pending") {
    await db.update(chatAction).set({ status: "cancelled" }).where(eq(chatAction.id, id));
  }
  return c.json({ ...actionDto(row), status: "cancelled" });
});

export default chat;
