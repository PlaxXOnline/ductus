import { Link } from 'react-router-dom';

/**
 * Deliberately without annotations: the screen exists in the graph purely
 * through the react-router derivation (path C, source: "derived"). The
 * visible text of the <Link> becomes the label of the derived edge
 * dashboard → settings.
 */
export function DashboardScreen() {
  return (
    <section>
      <h1>Dashboard</h1>
      <p>Welcome back! Your latest metrics appear here.</p>
      <Link to="/settings">Settings</Link>
    </section>
  );
}
