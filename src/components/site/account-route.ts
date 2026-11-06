// Pages that carry their own ClerkProvider, with UI. The gate stands aside on them, so one page never holds two.

let onAccountRoute = false;
const listeners = new Set<() => void>();

export function markAccountRoute(on: boolean): void {
  onAccountRoute = on;
  for (const listener of listeners) listener();
}

export const isAccountRoute = (): boolean => onAccountRoute;

export function subscribeAccountRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
