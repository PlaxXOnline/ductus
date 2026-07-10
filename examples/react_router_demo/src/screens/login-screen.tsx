import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { anmelden } from '../auth';

/**
 * Ziel nach erfolgreicher Anmeldung. Bewusst kein String-Literal direkt am
 * navigate()-Aufruf unten: Die Transition login → dashboard beschreibt hier
 * bereits die @journey:decision — eine zusätzlich abgeleitete Kante wäre
 * redundant.
 */
const ZIEL_NACH_ANMELDUNG = '/dashboard';

// Der Screen ist bereits aus der Routen-Tabelle abgeleitet (Weg C); der
// Kommentarblock reichert ihn um Titel, Flow und Beschreibung an (Weg A).
// @journey:screen id="login" title="Anmeldung" flow="auth"
//   description="Bildschirm, auf dem sich der Nutzer mit E-Mail-Adresse und Passwort anmeldet."
export function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');

  // @journey:action label="Anmelden" to="login-check" trigger="submit"
  //
  // @journey:decision id="login-check" title="Zugangsdaten gültig?" flow="auth"
  //   description="Beim Absenden wird geprüft, ob E-Mail-Adresse und Passwort ausgefüllt sind."
  // @journey:action label="Zur Übersicht"
  //   from="login-check" to="dashboard" trigger="auto"
  //   condition="Zugangsdaten gültig"
  // @journey:action label="Fehlerhinweis anzeigen"
  //   from="login-check" to="login" trigger="auto"
  //   condition="Zugangsdaten ungültig"
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (email === '' || passwort === '') {
      setFehler('Bitte E-Mail-Adresse und Passwort eingeben.');
      return;
    }
    anmelden();
    navigate(ZIEL_NACH_ANMELDUNG);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Anmeldung</h1>
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
      {fehler !== '' && <p role="alert">{fehler}</p>}
      <button type="submit">Anmelden</button>
      <Link to="/register">Konto erstellen</Link>
    </form>
  );
}
