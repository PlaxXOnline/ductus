import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// @journey:screen id="register" title="Registration" flow="auth"
//   description="Screen where the user creates a new account."
export function RegisterScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // The edge register → login derived from navigate('/login') merges with
  // this action (same from/to) — manual fields win field by field.
  // @journey:action label="Create account" to="login" trigger="submit"
  //   condition="Registration successful"
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate('/login');
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Registration</h1>
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
      <button type="submit">Create account</button>
    </form>
  );
}
