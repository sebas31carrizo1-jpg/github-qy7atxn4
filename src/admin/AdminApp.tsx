
import { useState } from 'react'
import './admin.css'
import AdminUsers from './AdminUsers'
import AdminPermissions from './AdminPermissions'
import AdminActivity from './AdminActivity'

function AdminApp() {
  const [seccionAdmin, setSeccionAdmin] = useState('Panel general')

  const navegar = (nombre: string) => {
    setSeccionAdmin(nombre)
  }

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span>OLM</span>
          <div>
            <strong>OBSERVATORIO</strong>
            <small>LA MATANZA</small>
          </div>
        </div>

        <nav className="admin-nav">
          {[
            'Panel general',
            'Usuarios',
            'Permisos',
            'Actividad',
            'Configuración',
          ].map((item) => (
            <button
              key={item}
              className={seccionAdmin === item ? 'admin-nav-active' : ''}
              onClick={() => navegar(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          Administración
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div>
            <span>OBSERVATORIO LA MATANZA</span>
            <h1>{seccionAdmin}</h1>
          </div>

          <span className="admin-status">
            Panel administrativo
          </span>
        </header>

        {seccionAdmin === 'Panel general' && (
          <>
            <section className="admin-welcome">
              <span>GESTIÓN INSTITUCIONAL</span>
              <h2>Bienvenido al panel de administración</h2>
              <p>
                Desde aquí podrás gestionar usuarios,
                permisos y actividad del Observatorio.
              </p>
            </section>

            <section className="admin-cards">
              <article>
                <span>01</span>
                <h3>Usuarios</h3>
                <p>Administrar colaboradores.</p>
              </article>

              <article>
                <span>02</span>
                <h3>Permisos</h3>
                <p>Gestionar accesos individuales.</p>
              </article>

              <article>
                <span>03</span>
                <h3>Actividad</h3>
                <p>Consultar registros del sistema.</p>
              </article>
            </section>
          </>
        )}

        {seccionAdmin === 'Usuarios' && <AdminUsers />}

        {seccionAdmin === 'Permisos' && <AdminPermissions />}

        {seccionAdmin === 'Actividad' && <AdminActivity />}

        {seccionAdmin === 'Configuración' && (
          <section className="admin-section">
            <h2>Configuración</h2>
            <p>Próximamente: ajustes del sistema.</p>
          </section>
        )}
      </main>
    </div>
  )
}

export default AdminApp
