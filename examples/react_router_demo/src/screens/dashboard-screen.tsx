import { Link } from 'react-router-dom';

/**
 * Bewusst ohne Annotationen: Der Screen existiert im Graphen rein aus der
 * react-router-Ableitung (Weg C, source: "derived"). Der sichtbare Text des
 * <Link> wird zum Label der abgeleiteten Kante dashboard → settings.
 */
export function DashboardScreen() {
  return (
    <section>
      <h1>Dashboard</h1>
      <p>Willkommen zurück! Hier erscheinen Ihre aktuellen Kennzahlen.</p>
      <Link to="/settings">Einstellungen</Link>
    </section>
  );
}
