import { decryptSecret } from "./crypto";

// Clé effective : valeur saisie par le foyer (chiffrée en base) en priorité,
// sinon repli sur la variable d'environnement. Renvoie null si rien.
async function resolve(
  stored: string | null | undefined,
  envValue: string | undefined,
  secret: string,
): Promise<string | null> {
  if (stored) {
    const key = await decryptSecret(stored, secret);
    if (key) return key;
  }
  return envValue || null;
}

type PrimHousehold = { primApiKey?: string | null; primJeton?: string | null };
type PrimEnv = { SESSION_SECRET: string; PRIM_IDF_MOBILITE_API?: string; PRIM_JETON?: string };

export const resolvePrimKey = (h: PrimHousehold, env: PrimEnv) =>
  resolve(h.primApiKey, env.PRIM_IDF_MOBILITE_API, env.SESSION_SECRET);

export const resolvePrimJeton = (h: PrimHousehold, env: PrimEnv) =>
  resolve(h.primJeton, env.PRIM_JETON, env.SESSION_SECRET);

type TmdbHousehold = { tmdbApiKey?: string | null };
type TmdbEnv = { SESSION_SECRET: string; TMDB_API_KEY?: string };

export const resolveTmdbKey = (h: TmdbHousehold, env: TmdbEnv) =>
  resolve(h.tmdbApiKey, env.TMDB_API_KEY, env.SESSION_SECRET);
