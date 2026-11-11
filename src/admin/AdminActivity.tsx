
function AdminActivity() {
  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <span>SEGURIDAD Y SEGUIMIENTO</span>
          <h2>Registro de actividad</h2>
          <p>
            Consultá las acciones realizadas por los usuarios
            dentro del Observatorio.
          </p>
        </div>
      </div>

      <div className="admin-empty-state">
        <span>◷</span>
        <h3>Historial de actividad</h3>
        <p>
          Próximamente vas a poder consultar ingresos,
          modificaciones de permisos, altas y bajas de usuarios.
        </p>
      </div>
    </section>
  )
}

export default AdminActivity

