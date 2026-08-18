import { Hono } from "hono";
import { cors } from "hono/cors";
import { withDb, requireAuth, requireSameOrigin } from "./middleware/auth";
import type { AppContext } from "./lib/types";

import authRoutes from "./routes/auth";
import tasksRoutes from "./routes/tasks";
import moneyRoutes from "./routes/money";
import weddingRoutes from "./routes/wedding";
import utilitiesRoutes from "./routes/utilities";
import cashflowRoutes from "./routes/cashflow";
import calendarRoutes from "./routes/calendar";
import chatRoutes from "./routes/chat";
import dashboardRoutes from "./routes/dashboard";
import badgesRoutes from "./routes/badges";
import householdRoutes from "./routes/household";
import coursesRoutes from "./routes/courses";
import f1Routes from "./routes/f1";
import weatherRoutes from "./routes/weather";
import sportRoutes from "./routes/sport";
import plannedRoutes from "./routes/planned";
import activitiesRoutes from "./routes/activities";
import filmsRoutes from "./routes/films";
import tripsRoutes from "./routes/trips";
import transitRoutes from "./routes/transit";
import lunchflowRoutes from "./routes/lunchflow";
import wishRoutes from "./routes/wish";
import listsRoutes from "./routes/lists";
import setupRoutes from "./routes/setup";

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  const handler = cors({
    origin: c.env.APP_URL,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  return handler(c, next);
});

app.use("*", withDb);

app.get("/", (c) =>
  c.json({
    name: "Family Assistant API",
    status: "ok",
    hint: "L'application web tourne sur le front (http://localhost:5173). Endpoints : /health, /auth/google, /api/*",
  }),
);
app.get("/health", (c) => c.json({ ok: true }));

// Images de recettes (R2) : route publique — la clé est un id aléatoire non
// devinable, les balises <img> du front n'envoient pas les cookies cross-site.
app.get("/public/recipe-images/:key", async (c) => {
  const key = c.req.param("key");
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return c.json({ error: "bad_key" }, 400);
  const obj = await c.env.FILES.get(`recipes/${key}`);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || "image/jpeg");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

// Auth (mix of public + /me protected internally)
app.route("/auth", authRoutes);
app.route("/api", authRoutes); // exposes /api/me

// Wizard de premier lancement — hors requireAuth (gardé par SETUP_TOKEN + base
// vierge), mais protégé CSRF comme le reste.
const setupApp = new Hono<AppContext>();
setupApp.use("*", requireSameOrigin);
setupApp.route("/", setupRoutes);
app.route("/api/setup", setupApp);

// Protected API
const api = new Hono<AppContext>();
api.use("*", requireSameOrigin);
api.use("*", requireAuth);
api.route("/tasks", tasksRoutes);
api.route("/", moneyRoutes); // /accounts /categories /transactions /recurring /balance /settlements
api.route("/wedding", weddingRoutes);
api.route("/utilities", utilitiesRoutes);
api.route("/cashflow", cashflowRoutes);
api.route("/calendar", calendarRoutes);
api.route("/chat", chatRoutes);
api.route("/dashboard", dashboardRoutes);
api.route("/badges", badgesRoutes);
api.route("/household", householdRoutes);
api.route("/courses", coursesRoutes);
api.route("/f1", f1Routes);
api.route("/weather", weatherRoutes);
api.route("/sport", sportRoutes);
api.route("/planned", plannedRoutes);
api.route("/transit", transitRoutes);
api.route("/activities", activitiesRoutes);
api.route("/films", filmsRoutes);
api.route("/trips", tripsRoutes);
api.route("/lunchflow", lunchflowRoutes);
api.route("/wish", wishRoutes);
api.route("/lists", listsRoutes);
app.route("/api", api);

export default app;
