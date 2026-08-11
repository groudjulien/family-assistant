import { Hono } from "hono";
import { and, eq, asc } from "drizzle-orm";
import { createTaskSchema, updateTaskSchema, reorderTasksSchema } from "@gfa/shared";
import { task } from "../db/schema";
import { parseBody } from "../lib/validate";
import { newId, nowIso } from "../lib/util";
import type { AppContext } from "../lib/types";

const tasks = new Hono<AppContext>();

const toDto = (t: typeof task.$inferSelect) => ({
  ...t,
  status: t.status as "todo" | "doing" | "done",
});

tasks.get("/", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const all = await db
    .select()
    .from(task)
    .where(eq(task.householdId, hid))
    .orderBy(asc(task.position));

  const roots = all.filter((t) => !t.parentTaskId);
  const result = roots
    .sort((a, b) => b.priority - a.priority || a.position - b.position)
    .map((t) => ({
      ...toDto(t),
      subtasks: all
        .filter((s) => s.parentTaskId === t.id)
        .sort((a, b) => a.position - b.position)
        .map(toDto),
    }));
  return c.json(result);
});

tasks.post("/", async (c) => {
  const db = c.get("db");
  const hid = c.get("household").id;
  const body = await parseBody(c, createTaskSchema);

  const siblings = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.householdId, hid),
        body.parentTaskId ? eq(task.parentTaskId, body.parentTaskId) : eq(task.parentTaskId, ""),
      ),
    );
  const maxPos = siblings.reduce((m, s) => Math.max(m, s.position), 0);

  const id = newId();
  const now = nowIso();
  await db.insert(task).values({
    id,
    householdId: hid,
    parentTaskId: body.parentTaskId ?? null,
    title: body.title,
    notes: body.notes ?? null,
    status: "todo",
    priority: body.priority ?? 2,
    position: maxPos + 1,
    dueDate: body.dueDate ?? null,
    assigneeId: body.assigneeId ?? null,
    createdBy: c.get("user").id,
    createdAt: now,
    updatedAt: now,
  });
  const created = (await db.select().from(task).where(eq(task.id, id)).limit(1))[0];
  return c.json(toDto(created), 201);
});

tasks.patch("/reorder", async (c) => {
  const db = c.get("db");
  const body = await parseBody(c, reorderTasksSchema);
  let pos = 1;
  for (const id of body.orderedIds) {
    await db.update(task).set({ position: pos, updatedAt: nowIso() }).where(eq(task.id, id));
    pos += 1;
  }
  return c.json({ ok: true });
});

tasks.patch("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await parseBody(c, updateTaskSchema);
  await db
    .update(task)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.notes !== undefined && { notes: body.notes ?? null }),
      ...(body.status !== undefined && {
        status: body.status,
        // Horodate le passage à « done » (tri de l'onglet Faites) ; efface au retour.
        completedAt: body.status === "done" ? nowIso() : null,
      }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.position !== undefined && { position: body.position }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate ?? null }),
      ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId ?? null }),
      updatedAt: nowIso(),
    })
    .where(eq(task.id, id));
  const updated = (await db.select().from(task).where(eq(task.id, id)).limit(1))[0];
  return c.json(toDto(updated));
});

tasks.delete("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  // delete subtasks too
  await db.delete(task).where(eq(task.parentTaskId, id));
  await db.delete(task).where(eq(task.id, id));
  return c.json({ ok: true });
});

export default tasks;
