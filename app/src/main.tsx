import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppProvider } from './store.tsx';
import '@fontsource-variable/geist';
import '@fontsource-variable/noto-serif-display/standard.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
