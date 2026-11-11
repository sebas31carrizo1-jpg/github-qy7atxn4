import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import AdminApp from './admin/AdminApp';
import AdminRoute from './admin/AdminRoute';
import EstablecerContrasena from './auth/EstablecerContrasena';

const ruta = window.location.pathname;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {ruta === '/administracion' ? (
      <AdminRoute>
        <AdminApp />
      </AdminRoute>
    ) : ruta === '/establecer-contrasena' ? (
      <EstablecerContrasena />
    ) : (
      <App />
    )}
  </StrictMode>
);
