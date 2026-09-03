/* ──────────────────────────────────────────────
   DOM Utilities
   ────────────────────────────────────────────── */

export function $(selector: string, parent: Element | Document = document): HTMLElement | null {
  return parent.querySelector(selector);
}

export function $$(selector: string, parent: Element | Document = document): HTMLElement[] {
  return Array.from(parent.querySelectorAll(selector));
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        element.className = value;
      } else if (key.startsWith('data-')) {
        element.setAttribute(key, value);
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

export function setScreen(renderFn: () => HTMLElement): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  const screen = renderFn();
  app.appendChild(screen);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function generateRoomCode(): string {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
