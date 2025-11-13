export function getOptionalWsBase(): string | null {
  const value = import.meta.env.VITE_WS_URL;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

export function getRequiredWsBase(): string {
  const base = getOptionalWsBase();
  if (!base) {
    throw new Error('VITE_WS_URL is not set');
  }
  return base;
}
