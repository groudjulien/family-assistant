/**
 * User-Agent des requêtes sortantes vers les services tiers (OpenAgenda,
 * flux RSS, TheMealDB, F1…). Volontairement neutre : il apparaît dans les
 * logs des sites contactés.
 *
 * Ne pas l'utiliser pour les endpoints protégés par de l'anti-bot qui
 * exigent un User-Agent de navigateur complet (oEmbed Instagram, pages
 * de villes…) — ceux-là gardent leur UA navigateur dédié.
 */
export const OUTBOUND_USER_AGENT = "family-assistant/1.0";
