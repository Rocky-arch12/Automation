import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/legacy.css';
import './styles/app.css';
import { bootstrapBackendParamFromQuery } from './services/apiClient';
import App from './App';

bootstrapBackendParamFromQuery();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
