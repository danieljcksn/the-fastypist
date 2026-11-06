export interface AuthPort {
  userId: string;
  getToken(fresh: boolean): Promise<string | null>;
}

let port: AuthPort | null = null;
const waiting = new Set<(value: AuthPort | null) => void>();

export function connectAuth(next: AuthPort | null): void {
  port = next;
  if (next) {
    for (const resolve of waiting) resolve(next);
    waiting.clear();
  }
}

/** Clerk may still be loading at the end of a test. Null after the wait means the run stays in the outbox for later. */
export function whenAuthed(waitMs: number): Promise<AuthPort | null> {
  if (port) return Promise.resolve(port);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(done);
      resolve(null);
    }, waitMs);
    const done = (value: AuthPort | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    waiting.add(done);
  });
}

export function currentAuth(): AuthPort | null {
  return port;
}
