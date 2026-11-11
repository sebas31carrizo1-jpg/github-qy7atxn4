import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

function EstablecerContrasena() {
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [cargando, setCargando] = useState(false);
  const [verificando, setVerificando] = useState(true);
  const [sesionValida, setSesionValida] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);

  useEffect(() => {
    let activo = true;

    async function verificarSesion() {
      const { data, error } = await supabase.auth.getSession();

      if (!activo) return;

      setSesionValida(!error && !!data.session);
      setVerificando(false);
    }

    verificarSesion();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!activo) return;

        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
          setSesionValida(!!session);
        }
      }
    );

    return () => {
      activo = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function guardarContrasena(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (password !== confirmacion) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setCargando(true);

    const { data: sesion } = await supabase.auth.getSession();

    if (!sesion.session) {
      setSesionValida(false);
      setError('Tu invitación no está activa. Solicitá un nuevo enlace.');
      setCargando(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError('No se pudo establecer la contraseña: ' + error.message);
      setCargando(false);
      return;
    }

    setExito(true);
    setPassword('');
    setConfirmacion('');
    setCargando(false);
  }

  if (verificando) {
    return (
      <main className="password-page">
        <section className="password-card">
          <p>Verificando tu invitación...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="password-page">
      <section className="password-card">
        <div className="password-logo">OLM</div>
        <span>OBSERVATORIO LA MATANZA</span>

        {exito ? (
          <>
            <h1>¡Contraseña configurada!</h1>
            <p>Tu contraseña fue guardada correctamente.</p>
            <button onClick={() => (window.location.href = '/')}>
              Ingresar al Observatorio
            </button>
          </>
        ) : !sesionValida ? (
          <>
            <h1>Invitación no válida</h1>
            <p>
              Para establecer tu contraseña necesitás ingresar desde el enlace
              de invitación enviado a tu correo electrónico.
            </p>
            <p>Si el enlace venció, solicitá uno nuevo al administrador.</p>
          </>
        ) : (
          <>
            <h1>Establecé tu contraseña</h1>
            <p>Elegí una contraseña segura para acceder a tu cuenta.</p>

            <form onSubmit={guardarContrasena}>
              <label htmlFor="nueva-password">Nueva contraseña</label>
              <input
                id="nueva-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />

              <label htmlFor="confirmar-password">Repetir contraseña</label>
              <input
                id="confirmar-password"
                type="password"
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />

              {error && <p className="password-error">{error}</p>}

              <button type="submit" disabled={cargando}>
                {cargando ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </form>
          </>
        )}

        {error && !sesionValida && <p className="password-error">{error}</p>}
      </section>
    </main>
  );
}

export default EstablecerContrasena;
