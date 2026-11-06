"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { connect } from "@/typing/ranked/runtime";

function Bridge() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    connect(isSignedIn && userId ? { userId, getToken: (fresh) => getToken(fresh ? { skipCache: true } : undefined) } : null);
    return () => connect(null);
  }, [isLoaded, isSignedIn, userId, getToken]);
  return null;
}

/** With prefetchUI off this brings clerk-js and no UI, so the 263 KB of sign-in screens never reach the typing page. */
export default function AccountIsland() {
  return (
    <ClerkProvider prefetchUI={false}>
      <Bridge />
    </ClerkProvider>
  );
}
