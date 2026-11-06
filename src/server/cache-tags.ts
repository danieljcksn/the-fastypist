// Every cached public reader carries these, and a write that can change a board or a profile revalidates them. Coarse on
// purpose: with 'max' a page serves stale while one background render refreshes it, and nothing renders until someone looks.
export const BOARDS_TAG = "boards";
export const PROFILES_TAG = "profiles";
