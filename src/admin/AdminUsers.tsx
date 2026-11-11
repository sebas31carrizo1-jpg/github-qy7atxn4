import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Usuario = {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
  created_at: string;
};

function AdminUsers() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    cargarUsuarios();
  }, []);

  async function cargarUsuarios() {
    setCargando(true);
    setError('');

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, active, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      setError('No se pudieron cargar los usuarios: ' + error.message);
    } else {
      setUsuarios(data || []);
    }

    setCargando(false);
  }

  async function crearColaborador(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGuardando(true);
    setError('');
    setMensaje('');

    const { data, error } = await supabase.functions.invoke(
      'admin-crear-colaborador',
      {
        body: {
          full_name: nombre.trim(),
          email: email.trim().toLowerCase(),
        },
      }
    );

    if (error) {
      setError('No se pudo crear el colaborador: ' + error.message);
    } else if (data?.error) {
      setError(data.error);
    } else if (data?.success) {
      setMensaje(
        data.warning ||
          'Colaborador creado. Se envió la invitación por correo electrónico.'
      );

      setNombre('');
      setEmail('');
      setMostrarFormulario(false);

      await cargarUsuarios();
    } else {
      setError('El servidor no devolvió una respuesta válida.');
    }

    setGuardando(false);
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <span>GESTIÓN DE ACCESOS</span>
          <h2>Usuarios y colaboradores</h2>
          <p>
            Administrá las cuentas de las personas que trabajan en el
            Observatorio.
          </p>
        </div>

        <button
          className="admin-primary-button"
          onClick={() => {
            setMostrarFormulario(!mostrarFormulario);
            setError('');
            setMensaje('');
          }}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo colaborador'}
        </button>
      </div>

      {mensaje && <p className="admin-success-message">{mensaje}</p>}

      {mostrarFormulario && (
        <div className="admin-card">
          <h3>Registrar nuevo colaborador</h3>
          <p>Se enviará una invitación al correo electrónico indicado.</p>

          <form onSubmit={crearColaborador} className="admin-create-form">
            <label htmlFor="colaborador-nombre">Nombre y apellido</label>
            <input
              id="colaborador-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Juan Pérez"
              minLength={2}
              maxLength={120}
              required
            />

            <label htmlFor="colaborador-email">Correo electrónico</label>
            <input
              id="colaborador-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colaborador@correo.com"
              maxLength={254}
              required
            />

            {error && <p className="admin-login-error">{error}</p>}

            <button
              type="submit"
              className="admin-primary-button"
              disabled={guardando}
            >
              {guardando
                ? 'Enviando invitación...'
                : 'Crear y enviar invitación'}
            </button>
          </form>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-section-header">
          <div>
            <h3>Usuarios registrados</h3>
            <p>{usuarios.length} usuarios encontrados</p>
          </div>

          <button
            className="admin-secondary-button"
            onClick={cargarUsuarios}
            disabled={cargando}
          >
            Actualizar
          </button>
        </div>

        {cargando && <p>Cargando usuarios...</p>}

        {!cargando && usuarios.length === 0 && (
          <p>No hay usuarios registrados.</p>
        )}

        {!cargando && usuarios.length > 0 && (
          <div className="admin-users-list">
            {usuarios.map((usuario) => (
              <div className="admin-user-row" key={usuario.id}>
                <div>
                  <strong>{usuario.full_name}</strong>
                  <p>
                    {usuario.role === 'admin' ? 'Administrador' : 'Colaborador'}
                  </p>
                </div>

                <span
                  className={
                    usuario.active
                      ? 'admin-user-status active'
                      : 'admin-user-status inactive'
                  }
                >
                  {usuario.active ? 'Activo' : 'Deshabilitado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default AdminUsers;
