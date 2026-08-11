import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  /** Bucket R2 pour les fichiers (billets de voyage). */
  FILES: R2Bucket;
  APP_URL: string;
  API_URL: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ANTHROPIC_API_KEY: string;
  /** Comma-separated allowlist of authorized Google emails. */
  ALLOWED_EMAILS: string;
  /** Clé API PRIM Île-de-France Mobilités — repli si non configurée par foyer. */
  PRIM_IDF_MOBILITE_API?: string;
  /** Jeton PRIM — repli si non configuré par foyer. */
  PRIM_JETON?: string;
  /** Clé API TMDB (films + streaming) — repli si non configurée par foyer. */
  TMDB_API_KEY?: string;
  /** Clé API LunchFlow (synchro des soldes bancaires). Fallback si non configurée par foyer. */
  LUNCHFLOW_API_KEY: string;
  /** Jeton d'amorçage du wizard /setup (généré par scripts/setup.sh).
   *  Les routes /setup ne répondent que si ce secret existe ET que la base est vierge. */
  SETUP_TOKEN?: string;
}
