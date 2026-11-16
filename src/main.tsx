import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { STORAGE_KEY, useStore } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep two open tabs in step with each other.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) void useStore.persist.rehydrate();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
