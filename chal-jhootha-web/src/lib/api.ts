const configuredOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();
const apiOrigin = configuredOrigin ? configuredOrigin.replace(/\/$/, '') : '';

export function apiURL(path: string) {
  return apiOrigin ? `${apiOrigin}${path}` : path;
}
