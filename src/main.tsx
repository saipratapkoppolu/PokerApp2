import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { applyTheme, getTheme } from './utils/theme';
import { takeSplitwiseLoginResult } from './utils/splitwise';
import { startOldGameSweep } from './utils/sweep';

applyTheme(getTheme());
// Back from "Connect Splitwise": keep the session, clean the address bar before the app reads it.
takeSplitwiseLoginResult();
// Delete games idle for 30+ days (logged-in users, at most once a day per device).
startOldGameSweep();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Service worker registration failed', error));
  });
}
