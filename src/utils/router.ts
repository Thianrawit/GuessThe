/* ──────────────────────────────────────────────
   Direct HTML5 History Router (No Hash /#)
   ────────────────────────────────────────────── */

type RouteHandler = (params?: Record<string, string>) => void;

const routes: Map<string, RouteHandler> = new Map();
let notFoundHandler: RouteHandler | null = null;

export function registerRoute(path: string, handler: RouteHandler): void {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  routes.set(cleanPath, handler);
}

export function onNotFound(handler: RouteHandler): void {
  notFoundHandler = handler;
}

/** Detect base subfolder if hosted on GitHub Pages (e.g. /GuessThe) */
export function getBasePath(): string {
  const path = window.location.pathname;
  const match = path.match(/^(\/[^\/]+)/);
  if (
    match &&
    !['/main', '/lobby', '/editor', '/game', '/results', '/index.html'].includes(
      match[1]
    )
  ) {
    return match[1];
  }
  return '';
}

/** Navigate to a direct URL path */
export function navigate(path: string, params?: Record<string, string>): void {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const basePath = getBasePath();
  const queryString = params ? `?${new URLSearchParams(params).toString()}` : '';
  const fullPath = `${basePath}${cleanPath}${queryString}`;

  window.history.pushState(null, '', fullPath);
  handleRouteChange();
}

/** Get current route from pathname and query */
export function getCurrentRoute(): { path: string; params: Record<string, string> } {
  // If an old hash remains in URL (e.g. #/main, #/lobby or #/), wipe it out and use direct URL
  if (window.location.hash) {
    const basePath = getBasePath();
    const cleanHash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    const targetPath = cleanHash ? (cleanHash.startsWith('/') ? cleanHash : `/${cleanHash}`) : '/main';
    window.history.replaceState(null, '', `${basePath}${targetPath}`);
  }

  const basePath = getBasePath();
  let path = window.location.pathname;

  if (basePath && path.startsWith(basePath)) {
    path = path.slice(basePath.length);
  }

  path = path.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/main';
  if (!path.startsWith('/')) path = `/${path}`;

  const searchParams = new URLSearchParams(window.location.search);
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

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
  window.addEventListener('popstate', handleRouteChange);

  const basePath = getBasePath();

  // Check if we were redirected from GitHub Pages 404.html with a stored path
  let targetPath = '/main';
  try {
    const redirectPath = sessionStorage.getItem('spa_redirect_path');
    if (redirectPath) {
      sessionStorage.removeItem('spa_redirect_path');
      // Extract just the path part (strip query string for replaceState)
      const pathOnly = redirectPath.split('?')[0] || '/main';
      targetPath = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    }
  } catch { /* sessionStorage unavailable */ }

  // Only allow known routes; fallback to /main for unknown paths
  const knownRoutes = Array.from(routes.keys());
  if (!knownRoutes.includes(targetPath)) {
    targetPath = '/main';
  }

  window.history.replaceState(null, '', `${basePath}${targetPath}`);
  handleRouteChange();
}
