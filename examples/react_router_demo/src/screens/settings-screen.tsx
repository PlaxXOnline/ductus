import { Link, useNavigate } from 'react-router-dom';

import { abmelden } from '../auth';

/**
 * Bewusst ohne Annotationen (Weg C): Neben dem <Link> wird auch der
 * navigate('/login')-Aufruf mit Literal-Argument zur abgeleiteten Kante.
 */
export function SettingsScreen() {
  const navigate = useNavigate();

  const handleLogout = () => {
    abmelden();
    navigate('/login');
  };

  return (
    <section>
      <h1>Einstellungen</h1>
      <label>
        <input type="checkbox" defaultChecked /> Benachrichtigungen aktivieren
      </label>
      <Link to="/dashboard">Zur Übersicht</Link>
      <button type="button" onClick={handleLogout}>
        Abmelden
      </button>
    </section>
  );
}
