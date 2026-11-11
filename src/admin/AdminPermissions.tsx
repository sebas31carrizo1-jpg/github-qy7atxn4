import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const modulosObservatorio = [
  { id: 'historico_electoral', nombre: 'Histórico electoral' },
  { id: 'circuitos_electorales', nombre: 'Circuitos electorales' },
  { id: 'datos_matanza', nombre: 'Datos de La Matanza' },
  { id: 'escrutinio_2027', nombre: 'Escrutinio 2027' },
  { id: 'poblacion', nombre: 'Población' },
  { id: 'territorio', nombre: 'Territorio' },
  { id: 'noticias', nombre: 'Noticias' },
  { id: 'estadisticas', nombre: 'Estadísticas' },
  { id: 'concejo_deliberante', nombre: 'Composición del Concejo Deliberante' },
];

type Usuario = {
  id: string;
  full_name: string;
  role: string;
};

type NivelAcceso = 'none' | 'read' | 'edit';

type Permiso = {
  module: string;
  access_level: NivelAcceso;
};

function AdminPermissions() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState('');
  const [permisos, setPermisos] = useState<Record<string, NivelAcceso>>({});
  const [cargando, setCargando] = useState(true);
  const [cargandoPermisos, setCargandoPermisos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    cargarUsuarios();
  }, []);

  useEffect(() => {
    if (usuarioSeleccionado) {
      cargarPermisos(usuarioSeleccionado);
    } else {
      setPermisos({});
    }
  }, [usuarioSeleccionado]);

  async function cargarUsuarios() {
    setCargando(true);
    setError('');

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .order('full_name');

    if (error) {
      setError('No se pudieron cargar los usuarios: ' + error.message);
    } else {
      setUsuarios(data || []);
    }

    setCargando(false);
  }

  async function cargarPermisos(userId: string) {
    setCargandoPermisos(true);
    setError('');
    setMensaje('');

    const { data, error } = await supabase
      .from('user_permissions')
      .select('module, access_level')
      .eq('user_id', userId);

    if (error) {
      setError('No se pudieron cargar los permisos: ' + error.message);
      setCargandoPermisos(false);
      return;
    }

    const iniciales: Record<string, NivelAcceso> = {};

    modulosObservatorio.forEach((modulo) => {
      iniciales[modulo.id] = 'none';
    });
    ((data as Permiso[]) || []).forEach((permiso) => {
      iniciales[permiso.module] = permiso.access_level;
    });

    setPermisos(iniciales);
    setCargandoPermisos(false);
  }

  function cambiarPermiso(moduleId: string, nivel: NivelAcceso) {
    setPermisos((actuales) => ({
      ...actuales,
      [moduleId]: nivel,
    }));
    setMensaje('');
  }

  async function guardarPermisos() {
    if (!usuarioSeleccionado) return;

    setGuardando(true);
    setError('');
    setMensaje('');

    const registros = modulosObservatorio.map((modulo) => ({
      module: modulo.id,
      access_level: permisos[modulo.id] || 'none',
    }));

    const { data, error } = await supabase.functions.invoke(
      'admin-guardar-permisos',
      {
        body: {
          user_id: usuarioSeleccionado,
          permissions: registros,
        },
      }
    );

    if (error) {
      setError('No se pudieron guardar los permisos: ' + error.message);
    } else if (data?.error) {
      setError(data.error);
    } else if (data?.success) {
      setMensaje(data.warning || 'Permisos guardados correctamente.');
    } else {
      setError('La respuesta del servidor no fue la esperada.');
    }

    setGuardando(false);
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <span>CONTROL DE ACCESO</span>
          <h2>Permisos individuales</h2>
          <p>Configurá qué puede consultar o modificar cada colaborador.</p>
        </div>
      </div>

      <div className="admin-card">
        <h3>Seleccionar colaborador</h3>

        {cargando ? (
          <p>Cargando usuarios...</p>
        ) : (
          <select
            value={usuarioSeleccionado}
            onChange={(e) => setUsuarioSeleccionado(e.target.value)}
          >
            <option value="">Seleccioná un usuario</option>
            {usuarios.map((usuario) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.full_name} ({usuario.role})
              </option>
            ))}
          </select>
        )}

        {error && <p className="admin-login-error">{error}</p>}
        {mensaje && <p className="admin-success-message">{mensaje}</p>}

        {usuarioSeleccionado && (
          <>
            <h3 className="admin-permissions-title">
              Módulos del Observatorio
            </h3>

            {cargandoPermisos ? (
              <p>Cargando permisos...</p>
            ) : (
              <>
                <div className="admin-permission-list">
                  {modulosObservatorio.map((modulo, index) => (
                    <div className="admin-permission-item" key={modulo.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>

                      <strong>{modulo.nombre}</strong>

                      <div className="admin-access-options">
                        <button
                          type="button"
                          className={`admin-access-button none ${
                            permisos[modulo.id] === 'none' ? 'selected' : ''
                          }`}
                          aria-pressed={permisos[modulo.id] === 'none'}
                          onClick={() => cambiarPermiso(modulo.id, 'none')}
                        >
                          {permisos[modulo.id] === 'none' ? '✓ ' : ''}
                          Sin acceso
                        </button>

                        <button
                          type="button"
                          className={`admin-access-button read ${
                            permisos[modulo.id] === 'read' ? 'selected' : ''
                          }`}
                          aria-pressed={permisos[modulo.id] === 'read'}
                          onClick={() => cambiarPermiso(modulo.id, 'read')}
                        >
                          {permisos[modulo.id] === 'read' ? '✓ ' : ''}
                          Lectura
                        </button>

                        <button
                          type="button"
                          className={`admin-access-button edit ${
                            permisos[modulo.id] === 'edit' ? 'selected' : ''
                          }`}
                          aria-pressed={permisos[modulo.id] === 'edit'}
                          onClick={() => cambiarPermiso(modulo.id, 'edit')}
                        >
                          {permisos[modulo.id] === 'edit' ? '✓ ' : ''}
                          Edición
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  className="admin-primary-button"
                  onClick={guardarPermisos}
                  disabled={guardando}
                >
                  {guardando ? 'Guardando...' : 'Guardar permisos'}
                </button>
              </>
            )}
          </>
        )}

        {!usuarioSeleccionado && !cargando && (
          <p>Seleccioná un usuario para administrar sus permisos.</p>
        )}
      </div>
    </section>
  );
}

export default AdminPermissions;
