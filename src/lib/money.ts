export function parsePoints(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }

  const points = Number(text);
  if (!Number.isSafeInteger(points) || points <= 0) {
    return null;
  }

  return points;
}

export function formatPoints(points: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(points);
  return `${formatted} pts`;
}
