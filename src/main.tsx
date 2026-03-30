import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('Global Error Captured:', event.error);
    if (event.error?.message?.includes('fetch')) {
      console.error('Fetch-related error detected. Stack:', event.error?.stack);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
