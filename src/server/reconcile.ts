import type { Db } from '@/db/client';
import { clerkIdsAfter, deleteAccount } from './accounts';

const RECONCILE_PAGE = 100;

export interface ClerkUsers {
  users: {
    getUserList(query: { userId: string[]; limit: number }): Promise<{ data: { id: string }[] }>;
    getUser(id: string): Promise<unknown>;
  };
}

/** For a user.deleted webhook that never arrived. Only Clerk's own 404 deletes a row: a failed call or a short page never does. */
export async function reconcile(db: Db, client: ClerkUsers, now: Date): Promise<number> {
  let removed = 0;
  let after: number | undefined;
  for (;;) {
    const page = await clerkIdsAfter(db, { limit: RECONCILE_PAGE, ...(after === undefined ? {} : { after }) });
    if (page.rows.length > 0) {
      const { data } = await client.users.getUserList({ userId: page.rows, limit: RECONCILE_PAGE });
      const known = new Set(data.map((user) => user.id));
      for (const id of page.rows) {
        if (known.has(id)) continue;
        try {
          await client.users.getUser(id);
        } catch (error) {
          if ((error as { status?: unknown }).status === 404 && (await deleteAccount(db, id, now))) removed++;
        }
      }
    }
    if (page.next === null) return removed;
    after = page.next;
  }
}
