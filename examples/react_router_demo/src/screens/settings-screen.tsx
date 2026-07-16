import { Link, useNavigate } from 'react-router-dom';

import { signOut } from '../auth';

/**
 * Deliberately without annotations (path C): besides the <Link>, the
 * navigate('/login') call with a literal argument also becomes a derived
 * edge.
 */
export function SettingsScreen() {
  const navigate = useNavigate();

  const handleLogout = () => {
    signOut();
    navigate('/login');
  };

  return (
    <section>
      <h1>Settings</h1>
      <label>
        <input type="checkbox" defaultChecked /> Enable notifications
      </label>
      <Link to="/dashboard">Go to dashboard</Link>
      <button type="button" onClick={handleLogout}>
        Sign out
      </button>
    </section>
  );
}
