export const eur = (cents: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

/** Euros sans centimes */
export const eur0 = (cents: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);

export const eurToCents = (e: number): number => Math.round(e * 100);

export const dateFr = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
};

/** Date sans l'année : « 15 août » */
export const dateFrShort = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
};

export const monthFr = (ym: string): string => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
};

/** « à l'instant » · « il y a 2 h » · « il y a 3 j » · au-delà, la date courte. */
export const relativeFr = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d <= 7) return `il y a ${d} j`;
  return `le ${dateFrShort(iso)}`;
};

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
export const currentMonth = (): string => new Date().toISOString().slice(0, 7);
