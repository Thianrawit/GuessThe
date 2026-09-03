/* ──────────────────────────────────────────────
   Simple Hash Router
   ────────────────────────────────────────────── */

type RouteHandler = (params?: Record<string, string>) => void;

const routes: Map<string, RouteHandler> = new Map();
let notFoundHandler: RouteHandler | null = null;

export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function onNotFound(handler: RouteHandler): void {
  notFoundHandler = handler;
}

export function navigate(path: string, params?: Record<string, string>): void {
  if (params) {
    const query = new URLSearchParams(params).toString();
    window.location.hash = `${path}?${query}`;
  } else {
    window.location.hash = path;
  }
}

export function getCurrentRoute(): { path: string; params: Record<string, string> } {
  const hash = window.location.hash.slice(1) || '/';
  const [path, queryString] = hash.split('?');
  const params: Record<string, string> = {};
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
  }
  return { path, params };
}

function handleRouteChange(): void {
  const { path, params } = getCurrentRoute();
  const handler = routes.get(path);
  if (handler) {
    handler(params);
  } else if (notFoundHandler) {
    notFoundHandler(params);
  }
}

export function initRouter(): void {
  window.addEventListener('hashchange', handleRouteChange);
  // Handle initial load
  if (!window.location.hash) {
    window.location.hash = '/';
  } else {
    handleRouteChange();
  }
}
