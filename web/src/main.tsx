import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './providers/plugins';
import './styles/index.css';

// Chrome loads speech voices asynchronously; ask early so the first clip has one.
if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
