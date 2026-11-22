import { useEffect, useMemo, useState } from 'react';
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import type { FormEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './elecciones2027.css';

type VistaPublica = 'participacion' | 'municipio' | 'circuitos' | 'colegios';
type VistaAdmin = 'resumen' | 'partidos' | 'territorio' | 'mesas' | 'participacion' | 'escrutinio';
type KmlFeature = Feature<Geometry, Record<string, unknown>>;

type Partido = { id: string; nombre: string; sigla: string; color: string };

const vistas: { id: VistaPublica; titulo: string; descripcion: string; icono: string }[] = [
  { id: 'participacion', titulo: 'Participación', descripcion: 'Votantes y nivel de participación', icono: '◉' },
  { id: 'municipio', titulo: 'La Matanza', descripcion: 'Escrutinio municipal', icono: '▥' },
  { id: 'circuitos', titulo: 'Circuitos', descripcion: 'Resultados por circuito electoral', icono: '⌖' },
  { id: 'colegios', titulo: 'Colegios', descripcion: 'Resultados por establecimiento', icono: '▦' },
];

const partidosIniciales: Partido[] = [
  { id: 'p1', nombre: 'Agrupación de ejemplo A', sigla: 'EJ-A', color: '#38BDF8' },
  { id: 'p2', nombre: 'Agrupación de ejemplo B', sigla: 'EJ-B', color: '#F97373' },
  { id: 'p3', nombre: 'Agrupación de ejemplo C', sigla: 'EJ-C', color: '#A78BFA' },
];

const numero = (n: number) => new Intl.NumberFormat('es-AR').format(n);

function AjustarVista({ data }: { data: FeatureCollection | null }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const bounds = L.geoJSON(data as never).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }, [data, map]);
  return null;
}

function textoLocal(element: Element | null, localName: string) {
  if (!element) return '';
  return Array.from(element.getElementsByTagNameNS('*', localName))[0]?.textContent?.trim() ?? '';
}

function convertirKml(kml: string): FeatureCollection {
  const xml = new DOMParser().parseFromString(kml, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('El archivo KML no tiene un formato válido.');
  const placemarks = Array.from(xml.getElementsByTagNameNS('*', 'Placemark'));
  const features: KmlFeature[] = [];

  const coordenadas = (ring: Element): number[][] => {
    const raw = ring.textContent?.trim() ?? '';
    return raw.split(/\s+/).map((pair) => {
      const [lon, lat, altitude] = pair.split(',').map(Number);
      return Number.isFinite(lon) && Number.isFinite(lat)
        ? altitude === undefined ? [lon, lat] : [lon, lat, altitude]
        : [];
    }).filter((pair) => pair.length >= 2);
  };

  placemarks.forEach((placemark, index) => {
    const name = textoLocal(placemark, 'name') || `Polígono ${index + 1}`;
    const description = textoLocal(placemark, 'description');
    const polygons = Array.from(placemark.getElementsByTagNameNS('*', 'Polygon'));
    if (!polygons.length) return;
    const geometries: Geometry[] = polygons.map((polygon) => {
      const outer = Array.from(polygon.getElementsByTagNameNS('*', 'outerBoundaryIs'))[0];
      const outerRing = outer?.getElementsByTagNameNS('*', 'coordinates')[0];
      const exterior = outerRing ? coordenadas(outerRing) : [];
      const innerRings = Array.from(polygon.getElementsByTagNameNS('*', 'innerBoundaryIs'))
        .map((boundary) => boundary.getElementsByTagNameNS('*', 'coordinates')[0])
        .filter(Boolean).map(coordenadas).filter((ring) => ring.length >= 4);
      return { type: 'Polygon', coordinates: [exterior, ...innerRings] } as Geometry;
    }).filter((geometry) => geometry.type === 'Polygon' && geometry.coordinates[0]?.length >= 4);
    if (!geometries.length) return;
    const geometry: Geometry = geometries.length === 1
      ? geometries[0]
      : { type: 'MultiPolygon', coordinates: geometries.map((g) => (g as Polygon).coordinates) };
    features.push({
      type: 'Feature',
      geometry,
      properties: { nombre: name, descripcion: description, indice: index + 1 },
    });
  });
  return { type: 'FeatureCollection', features };
}

function MapaTerritorial({ data, tipo }: { data: FeatureCollection | null; tipo: 'colegios' | 'circuitos' | 'participacion' }) {
  if (!data) return <div className="e27-map-placeholder"><span className="e27-spinner" />Cargando cartografía...</div>;
  return (
    <MapContainer center={[-34.75, -58.62]} zoom={10} scrollWheelZoom className="e27-map">
      <AjustarVista data={data} />
      <TileLayer
        attribution='&copy; OpenStreetMap &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
      />
      <GeoJSON
        key={`${tipo}-${data.features.length}`}
        data={data as never}
        style={() => ({
          color: tipo === 'participacion' ? '#4ADE80' : '#8CA5BD',
          weight: 1.1,
          opacity: 0.85,
          fillColor: tipo === 'participacion' ? '#166534' : '#27445F',
          fillOpacity: 0.34,
        })}
        onEachFeature={(feature, layer) => {
          const props = feature.properties as Record<string, unknown> | null;
          const label = String(props?.nombre ?? props?.circuito ?? 'Unidad territorial');
          const path = layer as L.Path;
          path.bindTooltip(label, { sticky: true, className: 'e27-map-tooltip' });
          path.on('mouseover', () => path.setStyle({ weight: 2.5, fillOpacity: 0.62, color: '#67E8F9' }));
          path.on('mouseout', () => path.setStyle({ weight: 1.1, fillOpacity: 0.34, color: tipo === 'participacion' ? '#4ADE80' : '#8CA5BD' }));
        }}
      />
    </MapContainer>
  );
}

function SinDatos({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="e27-empty-state">
      <span className="e27-empty-icon">◌</span>
      <strong>{titulo}</strong>
      <p>{detalle}</p>
      <span className="e27-empty-tag">SIN DATOS ELECTORALES CARGADOS</span>
    </div>
  );
}

export default function Elecciones2027() {
  const [vista, setVista] = useState<VistaPublica>('participacion');
  const [modoAdmin, setModoAdmin] = useState(false);
  const [vistaAdmin, setVistaAdmin] = useState<VistaAdmin>('resumen');
  const [kmlData, setKmlData] = useState<FeatureCollection | null>(null);
  const [circuitosData, setCircuitosData] = useState<FeatureCollection | null>(null);
  const [errorKml, setErrorKml] = useState('');
  const [partidos, setPartidos] = useState(partidosIniciales);
  const [nuevoPartido, setNuevoPartido] = useState({ nombre: '', sigla: '', color: '#38BDF8' });
  const [colegioSeleccionado, setColegioSeleccionado] = useState('');
  const [busquedaColegio, setBusquedaColegio] = useState('');
  const [mensajeAdmin, setMensajeAdmin] = useState('');

  useEffect(() => {
    let activo = true;
    fetch('/COLEGIOS%20OCTUBRE%202025.kml')
      .then((response) => {
        if (!response.ok) throw new Error('No se encontró el KML en la carpeta public.');
        return response.text();
      })
      .then((kml) => {
        const parsed = convertirKml(kml);
        if (activo) setKmlData(parsed);
      })
      .catch((error: Error) => { if (activo) setErrorKml(error.message); });
    fetch('/circuitos-la-matanza.geojson')
      .then((response) => response.ok ? response.json() : null)
      .then((json) => { if (activo && json?.features) setCircuitosData(json); })
      .catch(() => undefined);
    return () => { activo = false; };
  }, []);

  const colegiosFiltrados = useMemo(() => {
    const features = kmlData?.features ?? [];
    return features.filter((feature) => String(feature.properties?.nombre ?? '').toLowerCase().includes(busquedaColegio.toLowerCase()));
  }, [kmlData, busquedaColegio]);

  const circuitosDisponibles = useMemo(() => {
    const codigos = (circuitosData?.features ?? [])
      .map((feature) => String(feature.properties?.circuito ?? '').trim())
      .filter(Boolean);
    return Array.from(new Set(codigos)).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }, [circuitosData]);

  const tituloVista = vistas.find((item) => item.id === vista)?.titulo ?? 'Participación';

  const agregarPartido = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nuevoPartido.nombre.trim() || !nuevoPartido.sigla.trim()) return;
    setPartidos((actuales) => [...actuales, { ...nuevoPartido, id: `local-${Date.now()}` }]);
    setNuevoPartido({ nombre: '', sigla: '', color: '#38BDF8' });
    setMensajeAdmin('Partido agregado a la vista de demostración. No se guardó en la base de datos.');
  };

  const enviarCargaDemo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMensajeAdmin('Formulario validado visualmente. La persistencia se implementará al conectar Supabase.');
  };

  return (
    <section className="e27-shell">
      <header className="e27-header">
        <div className="e27-heading">
          <span className="e27-kicker">OBSERVATORIO · LA MATANZA</span>
          <h1>Elecciones <em>2027</em></h1>
          <p>Seguimiento electoral y lectura territorial del proceso democrático.</p>
        </div>
        <div className="e27-header-actions">
          <span className="e27-live"><i /> MODO DE DISEÑO</span>
          <button className={`e27-mode-button ${modoAdmin ? 'active' : ''}`} onClick={() => { setModoAdmin(!modoAdmin); setMensajeAdmin(''); }}>
            <span>{modoAdmin ? '◉' : '⚙'}</span>{modoAdmin ? 'Vista pública' : 'Administración'}
          </button>
        </div>
      </header>

      {!modoAdmin ? (
        <>
          <nav className="e27-tabs" aria-label="Secciones de Elecciones 2027">
            {vistas.map((item) => (
              <button key={item.id} className={`e27-tab ${vista === item.id ? 'selected' : ''}`} onClick={() => setVista(item.id)}>
                <span className="e27-tab-icon">{item.icono}</span>
                <span><strong>{item.titulo}</strong><small>{item.descripcion}</small></span>
                {vista === item.id && <i className="e27-tab-indicator" />}
              </button>
            ))}
          </nav>

          <div className="e27-stat-grid">
            <article className="e27-stat-card"><span>PARTICIPACIÓN</span><strong>—</strong><small>Sin información cargada</small><i className="e27-stat-symbol green">◉</i></article>
            <article className="e27-stat-card"><span>MESAS INFORMADAS</span><strong>—</strong><small>Sobre el total habilitado</small><i className="e27-stat-symbol blue">▤</i></article>
            <article className="e27-stat-card"><span>ESCRUTINIO</span><strong>—</strong><small>Mesas con resultado validado</small><i className="e27-stat-symbol violet">▥</i></article>
            <article className="e27-stat-card"><span>ÚLTIMA ACTUALIZACIÓN</span><strong>—</strong><small>Esperando la primera carga</small><i className="e27-stat-symbol amber">◷</i></article>
          </div>

          {vista === 'participacion' && (
            <div className="e27-content-grid">
              <section className="e27-panel e27-map-panel">
                <div className="e27-panel-heading"><div><span className="e27-kicker">PARTICIPACIÓN ELECTORAL</span><h2>Participación por territorio</h2><p>La intensidad del verde representará el porcentaje de electores que votaron.</p></div><span className="e27-map-label">MAPA INTERACTIVO</span></div>
                <div className="e27-map-wrap"><MapaTerritorial data={circuitosData} tipo="participacion" /></div>
                <div className="e27-legend"><span>Menor participación</span><div className="e27-gradient green-gradient" /><span>Mayor participación</span></div>
              </section>
              <aside className="e27-panel e27-side-panel"><span className="e27-kicker">RESUMEN DISTRITAL</span><h2>La Matanza</h2><SinDatos titulo="Todavía no hay participación informada" detalle="Los porcentajes aparecerán cuando se validen los reportes de las mesas." /><div className="e27-note"><b>Cómo se calcula</b><span>Votantes informados ÷ electores habilitados × 100. Los datos se agregan desde cada mesa.</span></div></aside>
            </div>
          )}

          {vista === 'municipio' && (
            <div className="e27-content-grid"><section className="e27-panel"><div className="e27-panel-heading"><div><span className="e27-kicker">ESCRUTINIO MUNICIPAL</span><h2>Resultados · La Matanza</h2><p>Votos, porcentajes y avance del escrutinio para cada agrupación.</p></div></div><SinDatos titulo="El escrutinio todavía no comenzó" detalle="Cuando existan resultados validados por mesa, se actualizarán automáticamente los totales municipales y la comparación entre listas." /></section><aside className="e27-panel"><span className="e27-kicker">AGRUPACIONES</span><h2>Partidos políticos</h2><div className="e27-party-list">{partidos.map((p) => <div className="e27-party-row" key={p.id}><i style={{ background: p.color }} /><span>{p.nombre}</span><small>Sin resultados</small></div>)}</div></aside></div>
          )}

          {vista === 'circuitos' && (
            <div className="e27-content-grid"><section className="e27-panel e27-map-panel"><div className="e27-panel-heading"><div><span className="e27-kicker">DISTRIBUCIÓN TERRITORIAL</span><h2>Resultados por circuito</h2><p>Cada circuito tomará el color del partido que obtenga más votos.</p></div><span className="e27-map-label">CIRCUITOS ELECTORALES</span></div><div className="e27-map-wrap"><MapaTerritorial data={circuitosData} tipo="circuitos" /></div><div className="e27-legend"><span>Sin resultados validados</span><span className="e27-neutral-dot" /></div></section><aside className="e27-panel"><span className="e27-kicker">LECTURA POLÍTICA</span><h2>Mapa de ganadores</h2><SinDatos titulo="Sin circuitos definidos como ganadores" detalle="El mapa cambiará de color a medida que se validen los resultados de las mesas de cada circuito." /></aside></div>
          )}

          {vista === 'colegios' && (
            <div className="e27-content-grid"><section className="e27-panel e27-map-panel"><div className="e27-panel-heading"><div><span className="e27-kicker">GEOGRAFÍA ELECTORAL</span><h2>Colegios electorales</h2><p>Polígonos territoriales importados desde Google My Maps.</p></div><span className="e27-map-label">KML · OCTUBRE 2025</span></div><div className="e27-map-wrap"><MapaTerritorial data={kmlData} tipo="colegios" /></div><div className="e27-map-foot"><span>{kmlData?.features.length ?? '—'} polígonos detectados</span><span>{errorKml || 'Cartografía de referencia · pendiente de vinculación con mesas'}</span></div></section><aside className="e27-panel e27-side-panel"><span className="e27-kicker">DIRECTORIO DE COLEGIOS</span><h2>Establecimientos</h2><input className="e27-search" value={busquedaColegio} onChange={(e) => setBusquedaColegio(e.target.value)} placeholder="Buscar colegio o polígono..." /><div className="e27-school-list">{colegiosFiltrados.slice(0, 80).map((feature, index) => { const name = String(feature.properties?.nombre ?? `Polígono ${index + 1}`); return <button key={`${name}-${index}`} className={`e27-school-row ${colegioSeleccionado === name ? 'active' : ''}`} onClick={() => setColegioSeleccionado(name)}><span className="e27-school-marker">⌖</span><span>{name}</span><small>Ver</small></button>; })}{!colegiosFiltrados.length && <p className="e27-muted">No hay coincidencias.</p>}</div>{colegioSeleccionado && <div className="e27-selection"><b>{colegioSeleccionado}</b><span>Polígono seleccionado. La vinculación con mesas se realizará en la etapa de datos.</span></div>}</aside></div>
          )}
          <div className="e27-footnote"><span>ⓘ</span> Esta interfaz está en etapa de construcción. No muestra resultados electorales reales ni datos oficiales.</div>
        </>
      ) : (
        <div className="e27-admin-layout">
          <aside className="e27-admin-nav"><span className="e27-kicker">GESTIÓN PRIVADA</span><h2>Administración</h2>{([{ id: 'resumen', label: 'Panel general', icon: '▦' }, { id: 'partidos', label: 'Partidos y listas', icon: '⚑' }, { id: 'territorio', label: 'Territorio y KML', icon: '⌖' }, { id: 'mesas', label: 'Colegios y mesas', icon: '▤' }, { id: 'participacion', label: 'Carga de participación', icon: '◉' }, { id: 'escrutinio', label: 'Carga de escrutinio', icon: '▥' }] as { id: VistaAdmin; label: string; icon: string }[]).map((item) => <button key={item.id} className={vistaAdmin === item.id ? 'active' : ''} onClick={() => { setVistaAdmin(item.id); setMensajeAdmin(''); }}><span>{item.icon}</span>{item.label}</button>)}</aside>
          <div className="e27-admin-main">
            <div className="e27-admin-warning"><span>ⓘ</span><div><b>Prototipo de interfaz · sin conexión de escritura</b><small>Los formularios permiten probar la experiencia. Ningún cambio se guarda en Supabase ni se publica al público todavía.</small></div></div>
            {vistaAdmin === 'resumen' && <section className="e27-panel"><span className="e27-kicker">CENTRO DE CONTROL</span><h2>Administración electoral 2027</h2><p className="e27-muted">Desde aquí se organizarán las dimensiones territoriales, las agrupaciones y los reportes de cada mesa.</p><div className="e27-admin-cards"><article><span>Partidos configurados</span><strong>{partidos.length}</strong></article><article><span>Polígonos KML</span><strong>{kmlData?.features.length ?? '—'}</strong></article><article><span>Mesas registradas</span><strong>—</strong></article><article><span>Reportes validados</span><strong>—</strong></article></div><div className="e27-admin-callout"><b>Flujo de trabajo</b><p>Configurar partidos → revisar colegios y circuitos → vincular mesas → habilitar reportes → validar → publicar automáticamente.</p></div></section>}
            {vistaAdmin === 'partidos' && <section className="e27-panel"><span className="e27-kicker">CONFIGURACIÓN ELECTORAL</span><h2>Partidos y listas</h2><p className="e27-muted">Cada agrupación tendrá un color institucional único en todos los mapas y gráficos.</p><form className="e27-form" onSubmit={agregarPartido}><label>Nombre del partido<input value={nuevoPartido.nombre} onChange={(e) => setNuevoPartido({ ...nuevoPartido, nombre: e.target.value })} placeholder="Nombre de la agrupación" required /></label><label>Sigla<input value={nuevoPartido.sigla} onChange={(e) => setNuevoPartido({ ...nuevoPartido, sigla: e.target.value.toUpperCase() })} placeholder="SIGLA" required /></label><label>Color institucional<input type="color" value={nuevoPartido.color} onChange={(e) => setNuevoPartido({ ...nuevoPartido, color: e.target.value })} /></label><button className="e27-primary-button" type="submit">+ Agregar partido (demo)</button></form><div className="e27-party-list admin-party-list">{partidos.map((p) => <div className="e27-party-row" key={p.id}><i style={{ background: p.color }} /><span>{p.nombre}</span><small>{p.sigla}</small></div>)}</div></section>}
            {vistaAdmin === 'territorio' && <section className="e27-panel"><span className="e27-kicker">CARTOGRAFÍA</span><h2>Territorio y archivo KML</h2><p className="e27-muted">Archivo incorporado al frontend: COLEGIOS OCTUBRE 2025.kml.</p><div className="e27-admin-cards"><article><span>Polígonos detectados</span><strong>{kmlData?.features.length ?? '—'}</strong></article><article><span>Estado de lectura</span><strong>{errorKml ? 'Error' : kmlData ? 'OK' : '...'}</strong></article></div><div className="e27-admin-callout"><b>Pendiente de revisión territorial</b><p>Los 343 polígonos identificados en el archivo deben contrastarse con el listado de colegios y asociarse a un identificador estable. No se asignarán mesas por coincidencia aproximada de nombres.</p></div>{errorKml && <p className="e27-error">{errorKml}</p>}</section>}
            {vistaAdmin === 'mesas' && <section className="e27-panel"><span className="e27-kicker">ORGANIZACIÓN DE ESTABLECIMIENTOS</span><h2>Colegios y mesas</h2><SinDatos titulo="Todavía no hay mesas vinculadas" detalle="Primero debemos revisar el padrón de establecimientos, asignar cada colegio a un circuito y registrar las mesas y electores habilitados." /><form className="e27-form e27-form-single" onSubmit={enviarCargaDemo}><label>Nombre o código de colegio<input placeholder="Buscar o identificar establecimiento" /></label><label>Cantidad de mesas<input type="number" min="1" placeholder="Ej. 6" /></label><button className="e27-primary-button">Probar formulario</button></form></section>}
            {vistaAdmin === 'participacion' && <section className="e27-panel"><span className="e27-kicker">REPORTE DE PARTICIPACIÓN</span><h2>Carga de participación por mesa</h2><p className="e27-muted">El reporte registrará cuántos electores votaron en una mesa respecto de su padrón habilitado.</p><form className="e27-form e27-form-single" onSubmit={enviarCargaDemo}><label>Circuito electoral<select defaultValue=""><option value="" disabled>Seleccionar circuito</option>{circuitosDisponibles.map((codigo) => <option key={codigo} value={codigo}>Circuito {codigo}</option>)}</select></label><label>Colegio electoral<input placeholder="Seleccionar establecimiento" /></label><label>Número de mesa<input type="number" min="1" placeholder="Ej. 125" /></label><label>Electores que votaron<input type="number" min="0" placeholder="Cantidad de votantes" /></label><button className="e27-primary-button">Validar reporte (demo)</button></form></section>}
            {vistaAdmin === 'escrutinio' && <section className="e27-panel"><span className="e27-kicker">CARGA DE RESULTADOS</span><h2>Escrutinio por mesa</h2><p className="e27-muted">Se cargará un registro por mesa y el sistema agregará los votos por colegio, circuito y municipio.</p><form className="e27-form e27-form-single" onSubmit={enviarCargaDemo}><label>Circuito electoral<select defaultValue=""><option value="" disabled>Seleccionar circuito</option>{circuitosDisponibles.map((codigo) => <option key={codigo} value={codigo}>Circuito {codigo}</option>)}</select></label><label>Colegio electoral<input placeholder="Seleccionar establecimiento" /></label><label>Número de mesa<input type="number" min="1" placeholder="Ej. 125" /></label><div className="e27-vote-inputs">{partidos.map((p) => <label key={p.id}><span><i style={{ background: p.color }} />{p.nombre}</span><input type="number" min="0" placeholder="Votos" /></label>)}</div><label>Votos en blanco<input type="number" min="0" placeholder="0" /></label><label>Votos nulos<input type="number" min="0" placeholder="0" /></label><button className="e27-primary-button">Validar carga (demo)</button></form></section>}
            {mensajeAdmin && <div className="e27-admin-feedback">✓ {mensajeAdmin}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

