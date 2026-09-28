import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { applyTheme, getTheme } from './utils/theme';
import { takeSplitwiseLoginResult } from './utils/splitwise';

applyTheme(getTheme());
// Back from "Connect Splitwise": keep the session, clean the address bar before the app reads it.
takeSplitwiseLoginResult();

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
