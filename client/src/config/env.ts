export function getRequiredWsBase(): string {
  const value = import.meta.env.VITE_WS_URL;
  if (typeof value !== 'string') {
    throw new Error('VITE_WS_URL is not set');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('VITE_WS_URL is not set');
  }
  return trimmed.replace(/\/+$/, '');
}
