"use client";

import { useSyncExternalStore } from "react";
import { headerIdentity, serverIdentity, subscribeAccount } from "@/typing/ranked/account";

/** Plain anchors: a soft navigation from a page without Clerk's UI into one that needs it throws. */
export function AccountLink({ signIn, account, signInHref, accountHref }: { signIn: string; account: string; signInHref: string; accountHref: string }) {
  const identity = useSyncExternalStore(subscribeAccount, headerIdentity, serverIdentity);
  return (
    <span className="account-box">
      {identity.signedIn ? (
        <a className="hit link-quiet" href={accountHref} data-testid="account-link">
          {identity.name ?? account}
        </a>
      ) : (
        <a className="hit link-quiet account-guest" href={signInHref} data-testid="sign-in-link">
          {signIn}
        </a>
      )}
    </span>
  );
}
