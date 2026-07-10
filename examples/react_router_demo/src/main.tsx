import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './router';

// @journey:flow id="auth" title="Anmeldung & Registrierung" start="login"
//   description="Von der Anmeldung oder Registrierung bis zur Übersicht."

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
