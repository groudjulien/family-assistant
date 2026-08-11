import type { Context } from "hono";
import type { z } from "zod";

export async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => ({}));
  return schema.parse(body);
}
