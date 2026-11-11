import { useEffect, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type AdminRouteProps = {
  children: ReactNode;
};

function AdminRoute({ children }: AdminRouteProps) {
  const [verificando, setVerificando] = useState(true);
  const [autorizado, setAutorizado] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const verificarAcceso = async () => {
    const { data: sesion } = await supabase.auth.getSession();
    const usuario = sesion.session?.user;

    if (!usuario) {
      setAutorizado(false);
      setVerificando(false);
      return;
    }

    const { data: perfil, error } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', usuario.id)
      .maybeSingle();

    if (error || !perfil || perfil.role !== 'admin' || !perfil.active) {
      await supabase.auth.signOut();
      setAutorizado(false);
      setError('No tenés autorización para acceder al panel.');
      setVerificando(false);
      return;
    }

    setAutorizado(true);
    setVerificando(false);
  };

  useEffect(() => {
    verificarAcceso();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      verificarAcceso();
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const iniciarSesionAdmin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCargando(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError(error.message);
      setCargando(false);
      return;
    }

    await verificarAcceso();
    setPassword('');
    setCargando(false);
  };

  if (verificando) {
    return (
      <div className="admin-access-message">
        Verificando acceso administrativo...
      </div>
    );
  }

  if (!autorizado) {
    return (
      <div className="admin-login-page">
        <form onSubmit={iniciarSesionAdmin} className="admin-login-card">
          <span className="admin-login-logo">OLM</span>
          <h1>Administración</h1>
          <p>Ingresá con tu cuenta de administrador.</p>

          <label htmlFor="admin-email">Correo electrónico</label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="admin-password">Contraseña</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <p className="admin-login-error">{error}</p>}

          <button type="submit" disabled={cargando}>
            {cargando ? 'Verificando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export default AdminRoute;
