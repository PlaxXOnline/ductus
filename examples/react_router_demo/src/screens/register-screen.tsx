import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// @journey:screen id="register" title="Registrierung" flow="auth"
//   description="Bildschirm, auf dem der Nutzer ein neues Konto anlegt."
export function RegisterScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');

  // Die aus navigate('/login') abgeleitete Kante register → login verschmilzt
  // mit dieser Action (gleiches from/to) — manuelle Felder gewinnen feldweise.
  // @journey:action label="Konto erstellen" to="login" trigger="submit"
  //   condition="Registrierung erfolgreich"
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate('/login');
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Registrierung</h1>
      <input
        type="email"
        placeholder="E-Mail-Adresse"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        type="password"
        placeholder="Passwort"
        value={passwort}
        onChange={(event) => setPasswort(event.target.value)}
      />
      <button type="submit">Konto erstellen</button>
    </form>
  );
}
