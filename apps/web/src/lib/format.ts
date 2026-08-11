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

export const monthFr = (ym: string): string => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
};

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
export const currentMonth = (): string => new Date().toISOString().slice(0, 7);
