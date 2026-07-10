/** Simulierter Anmeldezustand (echte Apps nutzen hier z. B. einen AuthContext). */
export let angemeldet = false;

export function anmelden(): void {
  angemeldet = true;
}

export function abmelden(): void {
  angemeldet = false;
}
