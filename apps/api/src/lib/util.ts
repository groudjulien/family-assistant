export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export function splitFromKey(
  amountCents: number,
  splitA: number,
  splitB: number,
): { shareA: number; shareB: number } {
  const total = splitA + splitB || 100;
  const shareA = Math.round((amountCents * splitA) / total);
  const shareB = amountCents - shareA;
  return { shareA, shareB };
}
