import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { signIn } from '../auth';

/**
 * Destination after a successful sign-in. Deliberately no string literal
 * directly at the navigate() call below: the transition login → dashboard is
 * already described by the @journey:decision — an additionally derived edge
 * would be redundant.
 */
const AFTER_SIGN_IN_TARGET = '/dashboard';

// The screen is already derived from the route table (path C); the comment
// block enriches it with a title, flow and description (path A).
// @journey:screen id="login" title="Sign in" flow="auth"
//   description="Screen where the user signs in with email and password."
export function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // @journey:action label="Sign in" to="login-check" trigger="submit"
  //
  // @journey:decision id="login-check" title="Credentials valid?" flow="auth"
  //   description="On submit, the app checks whether email and password are filled in."
  // @journey:action label="Go to dashboard"
  //   from="login-check" to="dashboard" trigger="auto"
  //   condition="Credentials valid"
  // @journey:action label="Show error message"
  //   from="login-check" to="login" trigger="auto"
  //   condition="Credentials invalid"
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (email === '' || password === '') {
      setError('Please enter your email address and password.');
      return;
    }
    signIn();
    navigate(AFTER_SIGN_IN_TARGET);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign in</h1>
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error !== '' && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
      <Link to="/register">Create account</Link>
    </form>
  );
}
