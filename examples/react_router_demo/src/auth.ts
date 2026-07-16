/** Simulated sign-in state (real apps would use e.g. an AuthContext here). */
export let isLoggedIn = false;

export function signIn(): void {
  isLoggedIn = true;
}

export function signOut(): void {
  isLoggedIn = false;
}
