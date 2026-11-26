import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { GeoJSON, MapContainer, useMap } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './elecciones2027.css';
import { supabase } from '../../lib/supabase';

type Perfil = {
  user_id: string;
  email: string;
  nombre: string;
  rol: 'administrador_general' | 'responsable_escuela';
  activo: boolean;
};

type Colegio = {
  id: string;
  nombre: string;
  circuito: string | null;
  // Identificador estable del nombre original del KML; no se modifica al cambiar el nombre visible.
  nombre_normalizado?: string | null;
  identificador_kml?: string | null;
};

type ResultadoPartidoPublico = {
  partido_id: string;
  nombre: string;
  color: string;
  votos: number;
};

type ParticipacionPublicaMesa = {
  mesa_id: string;
  votantes: number;
  hora: string;
};

type EscrutinioPublicoMesa = {
  mesa_id: string;
  votos_blancos: number;
  votos_nulos: number;
  partidos: ResultadoPartidoPublico[];
};

type Mesa = {
  id: string;
  numero: number;
  electores_habilitados: number;
  colegio_id: string;
};

type EscrutinioCargaGuardado = {
  id: string;
  user_id: string;
  estado: string;
  votos_partidos: Record<string, number>;
  votos_blancos: number;
  votos_nulos: number;
};

type MesaConfiguracion = {
  numero: string;
};

type MesaAdminConfiguracion = {
  id: string | null;
  numero: string;
  reportes_total: number;
};

type UsuarioAdmin = {
  user_id: string;
  email: string;
  nombre: string;
  rol: 'responsable_escuela';
  activo: boolean;
  creado_en?: string | null;
  reportes_participacion: number;
  reportes_escrutinio: number;
  colegios: Array<{
    colegio_id: string;
    nombre: string;
    circuito: string | null;
    activo: boolean;
    mesas: Array<{ id: string; numero: number; reportes_total: number; reportes_participacion: number; reportes_escrutinio: number }>;
    numeros_mesas: number[];
    cantidad_mesas: number;
  }> ;
};

type Asignacion = {
  colegio_id: string;
  elecciones_colegios: Colegio | Colegio[] | null;
};

type Partido = { id: string; nombre: string; sigla: string; color: string };

type ReportePendiente = {
  id: string;
  mesa_id: string;
  user_id: string;
  estado: string;
  creado_en: string;
  colegio?: string;
  mesa?: number;
  tipo: 'participacion' | 'escrutinio';
};

type DatoCircuito = {
  circuito: string;
  porcentaje: number;
  votantes?: number;
  habilitados?: number;
  partido?: string;
  color?: string;
  votos?: number;
};

type ResultadoGanadorColegio = {
  partido_id: string;
  partido: string;
  color: string;
  votos: number;
  porcentaje: number;
  total_escrutado: number;
};

const municipioUrl = `${import.meta.env.BASE_URL}la-matanza-municipio.geojson`;

// Catálogo inicial de los 25 circuitos electorales de La Matanza.
// En la siguiente etapa se vinculará con los circuitos registrados en Supabase.
const CIRCUITOS_ELECTORALES = [
  '0626', '0626A', '0627', '0628', '0629',
  '0629A', '0629B', '0630', '0631', '0631A',
  '0631B', '0631C', '0631D', '0632', '0632A',
  '0632B', '0633', '0634', '0635', '0635A',
  '0635B', '0635C', '0635D', '0635E', '0635F',
] as const;

// Cortes horarios para registrar la participación acumulada durante la jornada.
const HORARIOS_PARTICIPACION = Array.from({ length: 21 }, (_, index) => {
  const totalMinutos = 8 * 60 + index * 30;
  const hora = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${String(hora).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
});

function AjustarMapa({ data, circuito = '' }: { data: FeatureCollection | null; circuito?: string }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const features = circuito
      ? data.features.filter((feature) => {
          const props = feature.properties as Record<string, unknown> | null;
          return String(props?.circuito ?? props?.CIRCUITO ?? '').trim() === circuito;
        })
      : data.features;
    if (!features.length) return;
    const bounds = L.geoJSON({ type: 'FeatureCollection', features } as never).getBounds();
    if (!bounds.isValid()) return;
    if (circuito) map.fitBounds(bounds, { padding: [38, 38], maxZoom: 12, animate: true });
    else map.fitBounds(bounds, { padding: [25, 25] });
  }, [data, circuito, map]);
  return null;
}


function convertirKml(kml: string): FeatureCollection {
  const xml = new DOMParser().parseFromString(kml, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('El archivo KML no tiene un formato válido.');

  const normalizarCarpeta = (valor: string) => valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  // El KML contiene una carpeta independiente llamada "circuitos".
  // Se excluye esa capa: en esta vista solo deben quedar polígonos de establecimientos.
  const placemarks: Element[] = [];
  const recorrerCapas = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tipo = child.localName;
      if (tipo === 'Folder') {
        const nombreCarpeta = Array.from(child.getElementsByTagNameNS('*', 'name'))[0]?.textContent?.trim() || '';
        if (normalizarCarpeta(nombreCarpeta) === 'circuitos') continue;
        recorrerCapas(child);
      } else if (tipo === 'Placemark') {
        placemarks.push(child);
      } else {
        // El KML suele envolver las carpetas dentro de Document/Folder raíz.
        recorrerCapas(child);
      }
    }
  };
  recorrerCapas(xml.documentElement);

  const features: any[] = [];
  const leerTexto = (node: Element, tag: string) =>
    Array.from(node.getElementsByTagNameNS('*', tag))[0]?.textContent?.trim() || '';

  for (const placemark of placemarks) {
    const nombre = leerTexto(placemark, 'name');
    // Los puntos y recorridos del KML no son polígonos de colegios.
    if (!nombre || !placemark.getElementsByTagNameNS('*', 'Polygon').length) continue;

    const polygons = Array.from(placemark.getElementsByTagNameNS('*', 'Polygon'));
    const coordinates = polygons.map((polygon) => {
      const rings = Array.from(polygon.getElementsByTagNameNS('*', 'coordinates'));
      return rings.map((ring) => (ring.textContent || '').trim().split(/\s+/)
        .map((pair) => pair.split(',').slice(0, 2).map(Number))
        .filter((pair) => pair.length === 2 && pair.every(Number.isFinite)));
    }).filter((poly) => poly[0]?.length >= 4);

    if (!coordinates.length) continue;
    features.push({
      type: 'Feature',
      geometry: coordinates.length === 1
        ? { type: 'Polygon', coordinates: coordinates[0] }
        : { type: 'MultiPolygon', coordinates },
      properties: { nombre, tipo: 'establecimiento' },
    });
  }

  return { type: 'FeatureCollection', features };
}

function normalizarNombreColegio(valor: string) {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bn[º°]\s*/g, '')
    .replace(/\bn(?=\d)/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function CentrarPoligonoColegio({
  data,
  colegioSeleccionado,
}: {
  data: FeatureCollection;
  colegioSeleccionado?: string;
}) {
  const map = useMap();

  useEffect(() => {
    const objetivo = normalizarNombreColegio(colegioSeleccionado || '');
    if (!objetivo) return;
    const feature = data.features.find((item) => {
      const nombre = String((item.properties as any)?.nombre || '');
      return normalizarNombreColegio(nombre) === objetivo;
    });
    if (!feature) return;
    const bounds = L.geoJSON(feature as never).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 14, animate: true });
    }
  }, [data, colegioSeleccionado, map]);

  return null;
}

function colorGanadorPorIntensidad(color: string, porcentaje: number) {
  const hex = /^#([0-9a-f]{6})$/i.test(color) ? color.slice(1) : '168eae';
  const rgb = [0, 2, 4].map((pos) => parseInt(hex.slice(pos, pos + 2), 16));
  const intensidad = Math.max(0, Math.min(100, porcentaje)) / 100;
  // El tono crece con el porcentaje: una victoria ajustada queda clara y una
  // victoria amplia se acerca al color pleno del partido.
  const proporcionColor = 0.18 + intensidad * 0.82;
  const resultado = rgb.map((canal) => Math.round(255 - (255 - canal) * proporcionColor));
  return `#${resultado.map((canal) => canal.toString(16).padStart(2, '0')).join('')}`;
}

function MapaColegios({
  data,
  colegioSeleccionado,
  resultados,
  onSeleccionar,
}: {
  data: FeatureCollection | null;
  colegioSeleccionado?: string;
  resultados: Record<string, ResultadoGanadorColegio>;
  onSeleccionar: (nombre: string) => void;
}) {
  if (!data) return <div className="e27-map-loading">Cargando los polígonos de colegios…</div>;
  const seleccionado = normalizarNombreColegio(colegioSeleccionado || '');
  const firmaResultados = Object.entries(resultados)
    .map(([key, resultado]) => `${key}:${resultado.partido_id}:${resultado.porcentaje.toFixed(2)}`)
    .join('|');

  return (
    <MapContainer center={[-34.75, -58.62]} zoom={10} scrollWheelZoom className="e27-map e27-map-college-only">
      <AjustarMapa data={data} />
      <CentrarPoligonoColegio data={data} colegioSeleccionado={colegioSeleccionado} />
      <GeoJSON
        key={firmaResultados}
        data={data as never}
        style={(feature) => {
          const name = String((feature?.properties as any)?.nombre || '');
          const llave = normalizarNombreColegio(name);
          const isSelected = Boolean(seleccionado) && llave === seleccionado;
          const resultado = resultados[llave];
          const fillColor = resultado
            ? colorGanadorPorIntensidad(resultado.color, resultado.porcentaje)
            : '#f7fafc';
          return {
            color: isSelected ? '#087f9f' : resultado ? resultado.color : '#a8b7c2',
            weight: isSelected ? 2.4 : resultado ? 1.05 : 0.7,
            fillColor: isSelected && resultado ? colorGanadorPorIntensidad(resultado.color, Math.max(resultado.porcentaje, 55)) : isSelected ? '#b8e9f4' : fillColor,
            fillOpacity: resultado ? 0.86 : isSelected ? 0.62 : 0.34,
            opacity: 1,
            interactive: true,
            className: isSelected
              ? 'e27-college-polygon e27-college-polygon-selected'
              : resultado
                ? 'e27-college-polygon e27-college-polygon-with-results'
                : 'e27-college-polygon',
          };
        }}
        onEachFeature={(feature, layer) => {
          const name = String((feature.properties as any)?.nombre || 'Colegio');
          const resultado = resultados[normalizarNombreColegio(name)];
          const detalle = resultado
            ? `<strong>${resultado.partido}</strong><br/>${resultado.porcentaje.toFixed(1)}% · ${numeroAR(resultado.votos)} votos`
            : 'Sin escrutinio publicado';
          layer.bindTooltip(`<strong>${name}</strong><br/>${detalle}<br/><small>Hacé clic para consultar el establecimiento</small>`, {
            sticky: true,
            className: 'e27-college-tooltip',
          });
          layer.on('click', () => onSeleccionar(name));
        }}
      />
    </MapContainer>
  );
}

function MapaMunicipal({ data, color }: { data: FeatureCollection | null; color: string }) {
  if (!data) return <div className="e27-map-loading">Cargando mapa municipal…</div>;
  return (
    <MapContainer center={[-34.75, -58.62]} zoom={10} scrollWheelZoom className="e27-map e27-map-municipio">
      <AjustarMapa data={data} />
      <GeoJSON
        key={color}
        data={data as never}
        style={() => ({
          color: '#17324d',
          weight: 2,
          opacity: 1,
          fillColor: color,
          fillOpacity: 0.82,
        })}
      />
    </MapContainer>
  );
}

function MapaCircuitos({
  data,
  valores,
  modo,
  selectedCircuit = '',
  onSeleccionarCircuito,
}: {
  data: FeatureCollection | null;
  valores: Record<string, DatoCircuito>;
  modo: 'participacion' | 'resultados';
  selectedCircuit?: string;
  onSeleccionarCircuito?: (codigo: string) => void;
}) {
  if (!data) return <div className="e27-map-loading">Cargando circuitos electorales…</div>;

  const colorVerde = (porcentaje: number) => {
    if (porcentaje <= 0) return '#e5e7eb';
    const t = Math.max(0, Math.min(1, porcentaje / 100));
    const start = [220, 252, 231];
    const end = [20, 83, 45];
    return `rgb(${start.map((v, i) => Math.round(v + (end[i] - v) * t)).join(',')})`;
  };

  return (
    <MapContainer center={[-34.75, -58.62]} zoom={10} scrollWheelZoom className="e27-map">
      <AjustarMapa data={data} circuito={selectedCircuit} />
      <GeoJSON
        key={`${modo}-${Object.keys(valores).length}-${selectedCircuit}`}
        data={data as never}
        style={(feature) => {
          const props = feature?.properties as Record<string, unknown> | undefined;
          const codigo = String(props?.circuito ?? props?.CIRCUITO ?? '').trim();
          const dato = valores[codigo];
          const seleccionado = Boolean(selectedCircuit) && codigo === selectedCircuit;
          const fill = modo === 'participacion'
            ? colorVerde(dato?.porcentaje ?? 0)
            : (dato?.color || '#dceef6');
          const intensidad = modo === 'participacion'
            ? 0.85
            : dato ? 0.28 + Math.min(1, dato.porcentaje / 100) * 0.65 : 0.24;
          return {
            color: seleccionado ? '#e89a21' : '#526b7e',
            weight: seleccionado ? 4.5 : 1.5,
            opacity: selectedCircuit && !seleccionado ? 0.55 : 1,
            fillColor: fill,
            fillOpacity: seleccionado ? Math.max(intensidad, 0.78) : selectedCircuit ? intensidad * 0.48 : intensidad,
          };
        }}
        onEachFeature={(feature, layer) => {
          const props = feature.properties as Record<string, unknown> | undefined;
          const codigo = String(props?.circuito ?? props?.CIRCUITO ?? '').trim() || 'Circuito';
          const dato = valores[codigo];
          const detalle = modo === 'participacion'
            ? dato
              ? `${dato.porcentaje.toFixed(1)}% de participación · ${numeroAR(dato.votantes || 0)} votantes`
              : 'Sin reporte publicado'
            : dato
              ? `${dato.partido} · ${dato.porcentaje.toFixed(1)}% · ${numeroAR(dato.votos || 0)} votos`
              : 'Sin escrutinio publicado';
          layer.bindTooltip(`<strong>${codigo}</strong><br/>${detalle}<br/><small>Tocá para ver el detalle del circuito</small>`, {
            sticky: true,
            className: 'e27-map-tooltip',
          });
          if (codigo !== 'Circuito') {
            layer.on('click', () => onSeleccionarCircuito?.(codigo));
          }
        }}
      />
    </MapContainer>
  );
}

function numeroAR(valor: number) {
  return new Intl.NumberFormat('es-AR').format(valor);
}

function textoError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const detalle = error as { message?: unknown; details?: unknown; hint?: unknown };
    const partes = [detalle.message, detalle.details, detalle.hint]
      .filter((parte) => typeof parte === 'string' && parte.trim())
      .map((parte) => String(parte).trim());
    if (partes.length) return partes.join(' · ');
  }
  return fallback;
}

async function textoErrorFuncion(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = await context.clone().json() as { error?: unknown; message?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) return body.error;
        if (typeof body.message === 'string' && body.message.trim()) return body.message;
      } catch {
        // Si la respuesta no trae JSON, usamos el mensaje original.
      }
    }
  }
  return textoError(error, fallback);
}

export default function Elecciones2027() {
  const [vista, setVista] = useState<'participacion' | 'municipio' | 'circuitos' | 'colegios'>('participacion');
  const [mostrarLogin, setMostrarLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [colegios, setColegios] = useState<Colegio[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [reportes, setReportes] = useState<ReportePendiente[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [municipio, setMunicipio] = useState<FeatureCollection | null>(null);
  const [circuitosGeo, setCircuitosGeo] = useState<FeatureCollection | null>(null);
  const [participacionCircuitos, setParticipacionCircuitos] = useState<Record<string, DatoCircuito>>({});
  const [resultadosCircuitos, setResultadosCircuitos] = useState<Record<string, DatoCircuito>>({});
  const [colegiosPublicos, setColegiosPublicos] = useState<Colegio[]>([]);
  const [mesasPublicas, setMesasPublicas] = useState<Mesa[]>([]);
  const [reportesParticipacionPublicos, setReportesParticipacionPublicos] = useState<any[]>([]);
  const [reportesEscrutinioPublicos, setReportesEscrutinioPublicos] = useState<any[]>([]);
  const [circuitoSeleccionado, setCircuitoSeleccionado] = useState('');
  const [circuitoResultadoSeleccionado, setCircuitoResultadoSeleccionado] = useState('');
  const [colegioSeleccionadoPublico, setColegioSeleccionadoPublico] = useState('');
  const [colegioPoligonoSeleccionado, setColegioPoligonoSeleccionado] = useState('');
  const [busquedaColegio, setBusquedaColegio] = useState('');
  const [mostrarResultadosBusquedaColegio, setMostrarResultadosBusquedaColegio] = useState(false);
  const [errorDatosPublicos, setErrorDatosPublicos] = useState('');
  const [rolElegido, setRolElegido] = useState<'administrador_general' | 'responsable_escuela'>('administrador_general');
  const [errorMunicipio, setErrorMunicipio] = useState('');
  const [colegiosKml, setColegiosKml] = useState<FeatureCollection | null>(null);
  const [colorGanador, setColorGanador] = useState('#E5E7EB');
  const [nombreGanador, setNombreGanador] = useState('Resultados aún no publicados');
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [actualizandoDatos, setActualizandoDatos] = useState(false);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null);
  const actualizacionEnCursoRef = useRef(false);
  const cartografiaCargadaRef = useRef(false);
  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);
  const [tipoCarga, setTipoCarga] = useState<'participacion' | 'escrutinio' | null>(null);
  const [votantes, setVotantes] = useState('');
  const [franjaHora, setFranjaHora] = useState('12:00');
  const [franjasGuardadas, setFranjasGuardadas] = useState<Record<string, string>>({});
  const [franjaEditando, setFranjaEditando] = useState(false);
  const [cargandoFranjas, setCargandoFranjas] = useState(false);
  const [mesaEditandoElectores, setMesaEditandoElectores] = useState<string | null>(null);
  const [votantesUltimoRegistro, setVotantesUltimoRegistro] = useState<number | null>(null);
  const [horaUltimoRegistro, setHoraUltimoRegistro] = useState('');
  const [escrutinioGuardado, setEscrutinioGuardado] = useState<EscrutinioCargaGuardado | null>(null);
  const [escrutinioEditando, setEscrutinioEditando] = useState(false);
  const [escrutinioDeOtraCuenta, setEscrutinioDeOtraCuenta] = useState(false);
  const [votos, setVotos] = useState<Record<string, string>>({});
  const [blancos, setBlancos] = useState('0');
  const [nulos, setNulos] = useState('0');
  const [estadoConexion, setEstadoConexion] = useState<'comprobando' | 'conectado' | 'error'>('comprobando');
  const [seccionAdmin, setSeccionAdmin] = useState<'inicio' | 'responsables' | 'usuarios' | 'partidos' | 'colegios' | 'escrutinio'>('inicio');
  const [colegioEditandoId, setColegioEditandoId] = useState<string | null>(null);
  const [colegioNombreEditado, setColegioNombreEditado] = useState('');
  const [guardandoColegio, setGuardandoColegio] = useState<string | null>(null);
  const [colegioMesasEditandoId, setColegioMesasEditandoId] = useState<string | null>(null);
  const [configuracionMesasColegio, setConfiguracionMesasColegio] = useState<Record<string, MesaAdminConfiguracion[]>>({});
  const [guardandoConfiguracionColegio, setGuardandoConfiguracionColegio] = useState<string | null>(null);
  const [responsableAsignarPorColegio, setResponsableAsignarPorColegio] = useState<Record<string, string>>({});
  const [cantidadColegiosActivos, setCantidadColegiosActivos] = useState(0);
  const [cantidadColegiosCartografiados, setCantidadColegiosCartografiados] = useState(0);
  const [cantidadMesasActivas, setCantidadMesasActivas] = useState(0);
  const [guardandoAltaResponsable, setGuardandoAltaResponsable] = useState(false);
  const [cuentaCreadaEmail, setCuentaCreadaEmail] = useState('');
  const [responsablePassword, setResponsablePassword] = useState('');
  const [confirmarResponsablePassword, setConfirmarResponsablePassword] = useState('');
  const [usuariosAdmin, setUsuariosAdmin] = useState<UsuarioAdmin[]>([]);
  const [cargandoUsuariosAdmin, setCargandoUsuariosAdmin] = useState(false);
  const [usuarioPasswordEditando, setUsuarioPasswordEditando] = useState<string | null>(null);
  const [nuevaPasswordUsuario, setNuevaPasswordUsuario] = useState('');
  const [confirmarNuevaPasswordUsuario, setConfirmarNuevaPasswordUsuario] = useState('');
  const [guardandoPasswordUsuario, setGuardandoPasswordUsuario] = useState<string | null>(null);
  const [usuarioMesasEditando, setUsuarioMesasEditando] = useState<string | null>(null);
  const [configuracionMesasUsuario, setConfiguracionMesasUsuario] = useState<Record<string, MesaAdminConfiguracion[]>>({});
  const [guardandoMesasUsuario, setGuardandoMesasUsuario] = useState<string | null>(null);
  const [usuarioEliminarConfirmando, setUsuarioEliminarConfirmando] = useState<string | null>(null);
  const [confirmacionEliminarUsuario, setConfirmacionEliminarUsuario] = useState('');
  const [asignacionEliminarConfirmando, setAsignacionEliminarConfirmando] = useState<string | null>(null);
  const [mesaEliminarConfirmando, setMesaEliminarConfirmando] = useState<string | null>(null);
  const [confirmacionEliminarMesa, setConfirmacionEliminarMesa] = useState('');
  const [eliminandoElemento, setEliminandoElemento] = useState<string | null>(null);
  const [pestanaEscrutinio, setPestanaEscrutinio] = useState<'carga' | 'pendientes' | 'publicados'>('carga');
  const [circuitoDashboard, setCircuitoDashboard] = useState('');
  const [responsableNombre, setResponsableNombre] = useState('');
  const [responsableEmail, setResponsableEmail] = useState('');
  const [responsableColegio, setResponsableColegio] = useState('');
  const [responsableCantidadMesas, setResponsableCantidadMesas] = useState('1');
  const [responsableMesasConfig, setResponsableMesasConfig] = useState<MesaConfiguracion[]>([{ numero: '1' }]);
  const [electoresPorMesa, setElectoresPorMesa] = useState<Record<string, string>>({});
  const [guardandoElectoresMesa, setGuardandoElectoresMesa] = useState<string | null>(null);
  const [partidoNombre, setPartidoNombre] = useState('');
  const [partidoSigla, setPartidoSigla] = useState('');
  const [partidoColor, setPartidoColor] = useState('#2563eb');
  const [guardandoPartido, setGuardandoPartido] = useState(false);

  const cambiarCantidadMesasResponsable = (valor: string) => {
    setResponsableCantidadMesas(valor);
        const cantidad = Number(valor);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
      setResponsableMesasConfig([]);
      return;
    }
    setResponsableMesasConfig((actuales) =>
      Array.from({ length: cantidad }, (_, index) => actuales[index] ?? ({
        numero: String(index + 1),
      }))
    );
  };

  const actualizarMesaResponsable = (indice: number, campo: keyof MesaConfiguracion, valor: string) => {
        setResponsableMesasConfig((actuales) => actuales.map((mesa, i) =>
      i === indice ? { ...mesa, [campo]: valor } : mesa
    ));
  };

  const crearResponsableEnSupabase = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (perfil?.rol !== 'administrador_general') {
      setMensaje('Solo el Administrador General puede crear responsables.');
      return;
    }
    const cantidad = Number(responsableCantidadMesas);
    if (!responsableNombre.trim() || !responsableEmail.trim() || !responsableColegio) {
      setMensaje('Completá nombre, correo y establecimiento.');
      return;
    }
    if (responsablePassword.length < 12) {
      setMensaje('La contraseña inicial debe tener al menos 12 caracteres.');
      return;
    }
    if (responsablePassword !== confirmarResponsablePassword) {
      setMensaje('Las contraseñas iniciales no coinciden.');
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100 || responsableMesasConfig.length !== cantidad) {
      setMensaje('Ingresá una cantidad de mesas válida, entre 1 y 100.');
      return;
    }
    const numeros = responsableMesasConfig.map((mesa) => Number(mesa.numero));
    if (numeros.some((numero) => !Number.isInteger(numero) || numero < 1)) {
      setMensaje('Cada mesa debe tener un número entero mayor que cero.');
      return;
    }
    if (new Set(numeros).size !== numeros.length) {
      setMensaje('No puede haber números de mesa repetidos dentro del mismo establecimiento.');
      return;
    }

    setGuardandoAltaResponsable(true);
    setCuentaCreadaEmail('');
    setMensaje('Creando la cuenta y guardando las mesas en Supabase…');
    try {
      const { data, error: functionError } = await supabase.functions.invoke('dynamic-elecciones-crear-responsable', {
        body: {
          nombre: responsableNombre.trim().replace(/\s+/g, ' '),
          email: responsableEmail.trim().toLowerCase(),
          password: responsablePassword,
          colegio_id: responsableColegio,
          mesas: numeros,
        },
      });
      if (functionError) {
        throw new Error(`No se pudo ejecutar la función segura. Verificá que elecciones-crear-responsable esté desplegada con la versión nueva. ${functionError.message}`);
      }
      if (!data?.success) {
        throw new Error(data?.error || 'La función no confirmó la creación de la cuenta.');
      }
      setCuentaCreadaEmail(responsableEmail.trim().toLowerCase());
      setMensaje(`Cuenta creada para ${responsableEmail.trim()}. Se guardaron ${numeros.length} mesas y la asignación del establecimiento. La contraseña inicial es la que acabás de definir; entregala por un canal privado.`);
      setResponsableNombre('');
      setResponsableEmail('');
      setResponsablePassword('');
      setConfirmarResponsablePassword('');
      await cargarPerfil(perfil.user_id);
      await cargarPublico();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : 'No se pudo crear el responsable.');
    } finally {
      setGuardandoAltaResponsable(false);
    }
  };

  const cargarUsuariosAdmin = useCallback(async () => {
    if (perfil?.rol !== 'administrador_general') return;
    setCargandoUsuariosAdmin(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: { action: 'listar' },
      });
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.success) throw new Error(data?.error || 'No se pudo cargar el listado de usuarios.');
      setUsuariosAdmin((data.usuarios ?? []) as UsuarioAdmin[]);
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo cargar el listado de usuarios.'));
    } finally {
      setCargandoUsuariosAdmin(false);
    }
  }, [perfil]);

  useEffect(() => {
    if (perfil?.rol === 'administrador_general' && (seccionAdmin === 'usuarios' || seccionAdmin === 'colegios')) {
      void cargarUsuariosAdmin();
    }
  }, [perfil, seccionAdmin, cargarUsuariosAdmin]);

  const guardarPasswordUsuario = async (userId: string) => {
    if (nuevaPasswordUsuario.length < 12) {
      setMensaje('La nueva contraseña debe tener al menos 12 caracteres.');
      return;
    }
    if (nuevaPasswordUsuario !== confirmarNuevaPasswordUsuario) {
      setMensaje('Las nuevas contraseñas no coinciden.');
      return;
    }
    setGuardandoPasswordUsuario(userId);
    setMensaje('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: { action: 'cambiar_password', user_id: userId, password: nuevaPasswordUsuario },
      });
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.success) throw new Error(data?.error || 'No se pudo cambiar la contraseña.');
      setUsuarioPasswordEditando(null);
      setNuevaPasswordUsuario('');
      setConfirmarNuevaPasswordUsuario('');
      setMensaje('La contraseña se actualizó correctamente.');
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo cambiar la contraseña.'));
    } finally {
      setGuardandoPasswordUsuario(null);
    }
  };

  const guardarConfiguracionMesasDeUsuario = async (userId: string, colegioId: string) => {
    const key = `${userId}:${colegioId}`;
    const configuracion = configuracionMesasUsuario[key] ?? [];
    const mesas = configuracion.map((mesa) => ({
      id: mesa.id,
      numero: Number(mesa.numero),
    }));

    if (mesas.length < 1 || mesas.length > 100) {
      setMensaje('El colegio debe tener entre 1 y 100 mesas.');
      return;
    }
    if (mesas.some((mesa) => !Number.isInteger(mesa.numero) || mesa.numero < 1 || mesa.numero > 100000)) {
      setMensaje('Cada número de mesa debe ser un entero entre 1 y 100.000.');
      return;
    }
    if (new Set(mesas.map((mesa) => mesa.numero)).size !== mesas.length) {
      setMensaje('Hay números repetidos. Cada mesa del colegio debe tener un número distinto.');
      return;
    }

    setGuardandoMesasUsuario(key);
    setMensaje('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: {
          action: 'actualizar_configuracion_mesas',
          user_id: userId,
          colegio_id: colegioId,
          mesas,
        },
      });
      if (invokeError) throw invokeError;
      if (!data?.success) throw new Error(data?.error || 'No se pudo actualizar la configuración de mesas.');
      setMensaje(data.mensaje || 'Se actualizó la configuración de mesas del colegio.');
      setUsuarioMesasEditando(null);
      setConfiguracionMesasUsuario((old) => ({ ...old, [key]: [] }));
      await Promise.all([cargarUsuariosAdmin(), cargarPublico()]);
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo actualizar la configuración de mesas.'));
    } finally {
      setGuardandoMesasUsuario(null);
    }
  };

  const quitarAsignacionColegio = async (userId: string, colegioId: string) => {
    const key = `${userId}:${colegioId}`;
    setEliminandoElemento(key);
    setMensaje('');
    try {
      const { data, error } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: { action: 'quitar_asignacion_colegio', user_id: userId, colegio_id: colegioId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'No se pudo quitar el colegio asignado.');
      setMensaje(data.mensaje || 'Se quitó la asignación.');
      setAsignacionEliminarConfirmando(null);
      await cargarUsuariosAdmin();
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo quitar el colegio asignado.'));
    } finally {
      setEliminandoElemento(null);
    }
  };

  const eliminarResponsable = async (userId: string) => {
    if (confirmacionEliminarUsuario !== 'ELIMINAR CUENTA') {
      setMensaje('Escribí exactamente ELIMINAR CUENTA para confirmar.');
      return;
    }
    setEliminandoElemento(userId);
    setMensaje('');
    try {
      const { data, error } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: {
          action: 'eliminar_responsable',
          user_id: userId,
          confirmacion: confirmacionEliminarUsuario,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'No se pudo eliminar la cuenta.');
      setMensaje(data.mensaje || 'Se eliminó la cuenta del responsable.');
      setUsuarioEliminarConfirmando(null);
      setConfirmacionEliminarUsuario('');
      await Promise.all([cargarUsuariosAdmin(), cargarPublico()]);
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo eliminar la cuenta.'));
    } finally {
      setEliminandoElemento(null);
    }
  };

  const eliminarMesaDePrueba = async (mesaId: string) => {
    if (confirmacionEliminarMesa !== 'ELIMINAR MESA Y SUS REPORTES') {
      setMensaje('Escribí exactamente ELIMINAR MESA Y SUS REPORTES para confirmar.');
      return;
    }
    setEliminandoElemento(mesaId);
    setMensaje('');
    try {
      const { data, error } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: {
          action: 'eliminar_mesa',
          mesa_id: mesaId,
          confirmacion: confirmacionEliminarMesa,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'No se pudo eliminar la mesa.');
      setMensaje(data.mensaje || 'Se eliminó la mesa y sus reportes asociados.');
      setMesaEliminarConfirmando(null);
      setConfirmacionEliminarMesa('');
      setUsuarioMesasEditando(null);
      await Promise.all([cargarUsuariosAdmin(), cargarPublico()]);
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo eliminar la mesa.'));
    } finally {
      setEliminandoElemento(null);
    }
  };

  const cargarPublico = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoDatos(true);
    setErrorDatosPublicos('');
    const [mapaResponse, circuitosResponse, partidosResponse, colegiosPublicosResponse, mesasPublicasResponse, reportesResponse, participacionResponse] = await Promise.all([
      !silencioso && !cartografiaCargadaRef.current
        ? fetch(municipioUrl).then(async (r) => {
            if (!r.ok) throw new Error(`No se encontró ${municipioUrl}. Colocá el archivo en public/la-matanza-municipio.geojson.`);
            return r.json();
          }).catch((e) => { setErrorMunicipio(e instanceof Error ? e.message : 'No se pudo cargar el polígono municipal.'); return null; })
        : Promise.resolve(null),
      !silencioso && !cartografiaCargadaRef.current
        ? fetch(`${import.meta.env.BASE_URL}circuitos-la-matanza.geojson`).then(async (r) => {
            if (!r.ok) throw new Error('No se encontró public/circuitos-la-matanza.geojson');
            return r.json();
          }).catch((e) => { setMensaje(e instanceof Error ? e.message : 'No se pudo cargar la cartografía de circuitos.'); return null; })
        : Promise.resolve(null),
      supabase.from('elecciones_partidos').select('id,nombre,sigla,color').eq('activo', true),
      supabase.from('elecciones_colegios').select('id,nombre,nombre_normalizado,identificador_kml,circuito').eq('activo', true).order('nombre'),
      supabase.from('elecciones_mesas').select('id,numero,electores_habilitados,colegio_id').eq('activo', true).order('numero'),
      supabase.from('elecciones_reportes_escrutinio')
        .select('id,mesa_id,votos_blancos,votos_nulos,elecciones_escrutinio_partidos(votos,partido_id,elecciones_partidos(id,nombre,color)),elecciones_mesas(id,numero,colegio_id,elecciones_colegios(id,nombre,nombre_normalizado,identificador_kml,circuito))')
        .eq('estado', 'publicado'),
      supabase.from('elecciones_reportes_participacion')
        .select('id,mesa_id,elecciones_participacion_franjas(votantes,hora),elecciones_mesas(id,numero,colegio_id,electores_habilitados,elecciones_colegios(id,nombre,nombre_normalizado,identificador_kml,circuito))')
        .eq('estado', 'publicado'),
    ]);

    if (!silencioso && !cartografiaCargadaRef.current) {
      if (mapaResponse?.features) setMunicipio(mapaResponse);
      if (circuitosResponse?.features) setCircuitosGeo(circuitosResponse);
      fetch(`${import.meta.env.BASE_URL}COLEGIOS%20OCTUBRE%202025.kml`)
        .then((r) => r.ok ? r.text() : Promise.reject(new Error('No se encontró el KML')))
        .then((raw) => setColegiosKml(convertirKml(raw)))
        .catch((e) => setMensaje(e.message || 'No se pudo cargar el KML.'));
      cartografiaCargadaRef.current = true;
    }

    if (!partidosResponse.error && partidosResponse.data) setPartidos(partidosResponse.data as Partido[]);
    // El conteo oficial se obtiene desde una vista SQL calculada sobre las tablas reales.
    const { data: resumenDB, error: resumenError } = await supabase
      .from('elecciones_resumen_general')
      .select('colegios_activos,colegios_cartografiados,mesas_activas')
      .maybeSingle();
    if (!resumenError && resumenDB) {
      setCantidadColegiosActivos(Number(resumenDB.colegios_activos || 0));
      setCantidadColegiosCartografiados(Number(resumenDB.colegios_cartografiados || 0));
      setCantidadMesasActivas(Number(resumenDB.mesas_activas || 0));
    }

    if (!colegiosPublicosResponse.error && colegiosPublicosResponse.data) {
      const lista = colegiosPublicosResponse.data as Colegio[];
      setColegiosPublicos(lista);
      setColegioSeleccionadoPublico((actual) => actual && lista.some((c) => c.id === actual) ? actual : (lista[0]?.id || ''));
    } else {
      setColegiosPublicos([]);
    }
    if (!mesasPublicasResponse.error && mesasPublicasResponse.data) {
      setMesasPublicas(mesasPublicasResponse.data as Mesa[]);
    } else {
      setMesasPublicas([]);
    }
    if (!reportesResponse.error && reportesResponse.data) {
      setReportesEscrutinioPublicos(reportesResponse.data as any[]);
    } else {
      setReportesEscrutinioPublicos([]);
    }
    if (!participacionResponse.error && participacionResponse.data) {
      setReportesParticipacionPublicos(participacionResponse.data as any[]);
    } else {
      setReportesParticipacionPublicos([]);
    }

    const erroresLectura = [
      colegiosPublicosResponse.error,
      mesasPublicasResponse.error,
      reportesResponse.error,
      participacionResponse.error,
      resumenError,
    ].filter(Boolean);
    if (erroresLectura.length) {
      setErrorDatosPublicos('No se pudieron consultar todos los datos públicos. Revisá los permisos de lectura de colegios, mesas y reportes publicados en Supabase.');
    }

    if (!reportesResponse.error && reportesResponse.data) {
      const porCircuito: Record<string, Record<string, { nombre: string; color: string; votos: number }>> = {};
      const votosNoPartidariosPorCircuito: Record<string, { blancos: number; nulos: number }> = {};
      const totales: Record<string, { nombre: string; color: string; votos: number }> = {};
      for (const reporte of reportesResponse.data as any[]) {
        const mesaRel = Array.isArray(reporte.elecciones_mesas) ? reporte.elecciones_mesas[0] : reporte.elecciones_mesas;
        const colegioRel = Array.isArray(mesaRel?.elecciones_colegios) ? mesaRel.elecciones_colegios[0] : mesaRel?.elecciones_colegios;
        const circuito = String(colegioRel?.circuito ?? '').trim();
        if (circuito) {
          if (!porCircuito[circuito]) porCircuito[circuito] = {};
          if (!votosNoPartidariosPorCircuito[circuito]) votosNoPartidariosPorCircuito[circuito] = { blancos: 0, nulos: 0 };
          votosNoPartidariosPorCircuito[circuito].blancos += Number(reporte.votos_blancos || 0);
          votosNoPartidariosPorCircuito[circuito].nulos += Number(reporte.votos_nulos || 0);
        }
        for (const fila of reporte.elecciones_escrutinio_partidos ?? []) {
          const partido = Array.isArray(fila.elecciones_partidos) ? fila.elecciones_partidos[0] : fila.elecciones_partidos;
          if (!partido) continue;
          const key = String(fila.partido_id);
          const cantidad = Number(fila.votos || 0);
          if (!totales[key]) totales[key] = { nombre: partido.nombre, color: partido.color || '#168eae', votos: 0 };
          totales[key].votos += cantidad;
          if (circuito) {
            if (!porCircuito[circuito][key]) porCircuito[circuito][key] = { nombre: partido.nombre, color: partido.color || '#168eae', votos: 0 };
            porCircuito[circuito][key].votos += cantidad;
          }
        }
      }
      const ganador = Object.values(totales).sort((a, b) => b.votos - a.votos)[0];
      setColorGanador(ganador?.color || '#d9f0f9');
      setNombreGanador(ganador ? `${ganador.nombre} · ${numeroAR(ganador.votos)} votos` : 'Resultados aún no publicados');
      const porCircuitoMap: Record<string, DatoCircuito> = {};
      for (const [codigo, partidosCircuito] of Object.entries(porCircuito)) {
        const lista = Object.values(partidosCircuito).sort((a, b) => b.votos - a.votos);
        const votosPartidarios = lista.reduce((sum, item) => sum + item.votos, 0);
        const votosNoPartidarios = votosNoPartidariosPorCircuito[codigo] || { blancos: 0, nulos: 0 };
        const totalEscrutado = votosPartidarios + votosNoPartidarios.blancos + votosNoPartidarios.nulos;
        const winner = lista[0];
        if (winner && totalEscrutado > 0) porCircuitoMap[codigo] = {
          circuito: codigo, partido: winner.nombre, color: winner.color,
          votos: winner.votos, porcentaje: winner.votos / totalEscrutado * 100,
        };
      }
      setResultadosCircuitos(porCircuitoMap);
    } else {
      setResultadosCircuitos({});
      setColorGanador('#d9f0f9');
      setNombreGanador('Resultados aún no publicados');
    }

    if (!participacionResponse.error && participacionResponse.data) {
      const ultimaPorMesa = new Map<string, number>();
      for (const reporte of participacionResponse.data as any[]) {
        const franjas = [...(reporte.elecciones_participacion_franjas ?? [])]
          .sort((a: any, b: any) => String(b.hora).localeCompare(String(a.hora)));
        if (franjas[0] && reporte.mesa_id) ultimaPorMesa.set(String(reporte.mesa_id), Number(franjas[0].votantes || 0));
      }
      const colegiosPorId = new Map((colegiosPublicosResponse.data ?? []).map((colegio: any) => [String(colegio.id), colegio]));
      const acumulados: Record<string, { votantes: number; habilitados: number }> = {};
      for (const mesa of mesasPublicasResponse.data ?? []) {
        const colegio = colegiosPorId.get(String((mesa as any).colegio_id)) as any;
        const circuito = String(colegio?.circuito ?? '').trim();
        if (!circuito) continue;
        if (!acumulados[circuito]) acumulados[circuito] = { votantes: 0, habilitados: 0 };
        acumulados[circuito].habilitados += Number((mesa as any).electores_habilitados || 0);
        acumulados[circuito].votantes += ultimaPorMesa.get(String((mesa as any).id)) || 0;
      }
      const datos: Record<string, DatoCircuito> = {};
      for (const [codigo, dato] of Object.entries(acumulados)) {
        datos[codigo] = {
          circuito: codigo, votantes: dato.votantes, habilitados: dato.habilitados,
          porcentaje: dato.habilitados ? Math.min(100, dato.votantes / dato.habilitados * 100) : 0,
        };
      }
      setParticipacionCircuitos(datos);
    } else {
      setParticipacionCircuitos({});
    }
    if (!silencioso) setCargandoDatos(false);
  }, []);

  useEffect(() => {
    let vigente = true;
    const verificar = async () => {
      const { error: dbError } = await supabase.from('elecciones_partidos').select('id').limit(1);
      if (vigente) setEstadoConexion(dbError ? 'error' : 'conectado');
    };
    verificar().catch(() => vigente && setEstadoConexion('error'));
    cargarPublico();
    return () => { vigente = false; };
  }, [cargarPublico]);

  const cargarPerfil = useCallback(async (userId: string) => {
    const { data: p, error: perfilError } = await supabase
      .from('elecciones_perfiles')
      .select('user_id,email,nombre,rol,activo')
      .eq('user_id', userId)
      .maybeSingle();
    if (perfilError || !p || !p.activo) throw new Error('La cuenta no está habilitada para Elecciones 2027.');

    // El saludo usa el nombre real cargado en elecciones_perfiles.nombre.
    // Si quedó un nombre genérico por una carga anterior, buscamos el nombre de Auth.
    const nombreGuardado = String(p.nombre ?? '').trim();
    const nombreEsRol = /^(administrador general|responsable de escuela)$/i.test(nombreGuardado);
    let nombreVisible = nombreGuardado;
    if (!nombreVisible || nombreEsRol) {
      const { data: authUserData } = await supabase.auth.getUser();
      const metadata = authUserData.user?.user_metadata ?? {};
      const nombreMetadata = String(metadata.full_name ?? metadata.name ?? '').trim();
      const correo = String(p.email ?? authUserData.user?.email ?? '').trim();
      const nombreDesdeCorreo = correo.includes('@')
        ? correo.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (letra) => letra.toUpperCase())
        : '';
      nombreVisible = nombreMetadata || nombreDesdeCorreo || (p.rol === 'responsable_escuela' ? 'Responsable de Escuela' : 'Administrador General');
    }
    setPerfil({ ...p, nombre: nombreVisible } as Perfil);
    if (p.rol === 'responsable_escuela') {
      const { data: asignaciones, error: asignacionError } = await supabase
        .from('elecciones_usuario_colegios')
        .select('colegio_id,elecciones_colegios(id,nombre,nombre_normalizado,identificador_kml,circuito)')
        .eq('user_id', userId);
      if (asignacionError) throw asignacionError;
      const asignados = ((asignaciones ?? []) as unknown as Asignacion[]).map((a) =>
        Array.isArray(a.elecciones_colegios) ? a.elecciones_colegios[0] : a.elecciones_colegios
      ).filter(Boolean) as Colegio[];
      setColegios(asignados);
      const ids = asignados.map((c) => c.id);
      if (ids.length) {
        const { data: mesasData, error: mesasError } = await supabase
          .from('elecciones_mesas')
          .select('id,numero,electores_habilitados,colegio_id')
          .in('colegio_id', ids)
          .eq('activo', true)
          .order('numero');
        if (mesasError) throw mesasError;
        const mesasCargadas = (mesasData ?? []) as Mesa[];
        setMesas(mesasCargadas);
        setElectoresPorMesa(Object.fromEntries(mesasCargadas.map((mesa) => [
          mesa.id, mesa.electores_habilitados > 0 ? String(mesa.electores_habilitados) : '',
        ])));
      } else {
        setMesas([]);
        setElectoresPorMesa({});
      }
    } else {
      const { data: colegiosAdmin, error: colegiosError } = await supabase
        .from('elecciones_colegios')
        .select('id,nombre,nombre_normalizado,identificador_kml,circuito')
        .eq('activo', true)
        .order('circuito', { ascending: true })
        .order('nombre', { ascending: true });
      if (colegiosError) throw colegiosError;
      setColegios((colegiosAdmin ?? []) as Colegio[]);
      setCantidadColegiosActivos((colegiosAdmin ?? []).length);
      setCantidadColegiosCartografiados((colegiosAdmin ?? []).filter((colegio: any) => Boolean(colegio.identificador_kml)).length);
      const { data: resumenAdmin } = await supabase
        .from('elecciones_resumen_general')
        .select('colegios_activos,colegios_cartografiados,mesas_activas')
        .maybeSingle();
      if (resumenAdmin) {
        setCantidadColegiosActivos(Number(resumenAdmin.colegios_activos || 0));
        setCantidadColegiosCartografiados(Number(resumenAdmin.colegios_cartografiados || 0));
        setCantidadMesasActivas(Number(resumenAdmin.mesas_activas || 0));
      }
      setMesas([]);
      setElectoresPorMesa({});
    }
  }, []);

  const cargarReportesAdmin = useCallback(async () => {
    const [part, escr] = await Promise.all([
      supabase.from('elecciones_reportes_participacion')
        .select('id,mesa_id,user_id,estado,creado_en,elecciones_mesas(numero,elecciones_colegios(nombre))')
        .eq('estado', 'pendiente').order('creado_en', { ascending: true }),
      supabase.from('elecciones_reportes_escrutinio')
        .select('id,mesa_id,user_id,estado,creado_en,elecciones_mesas(numero,elecciones_colegios(nombre))')
        .eq('estado', 'pendiente').order('creado_en', { ascending: true }),
    ]);
    const normalizar = (rows: any[] | null, tipo: 'participacion' | 'escrutinio') =>
      (rows ?? []).map((r) => {
        const mesa = Array.isArray(r.elecciones_mesas) ? r.elecciones_mesas[0] : r.elecciones_mesas;
        const colegioRel = mesa?.elecciones_colegios;
        const colegio = Array.isArray(colegioRel) ? colegioRel[0] : colegioRel;
        return { ...r, mesa: mesa?.numero, colegio: colegio?.nombre, tipo } as ReportePendiente;
      });
    setReportes([...normalizar(part.data, 'participacion'), ...normalizar(escr.data, 'escrutinio')]);
    if (part.error || escr.error) setMensaje('No se pudieron consultar todos los reportes pendientes. Revisá las políticas y relaciones de Supabase.');
  }, []);

  useEffect(() => {
    if (perfil?.rol === 'administrador_general') void cargarReportesAdmin();
  }, [perfil, cargarReportesAdmin]);

  const actualizarDatos = useCallback(async () => {
    if (actualizacionEnCursoRef.current || cargando || mesaActiva) return;

    const hayEdicionLocalDeElectores = mesas.some((mesa) => {
      const valorGuardado = mesa.electores_habilitados > 0 ? String(mesa.electores_habilitados) : '';
      return Object.prototype.hasOwnProperty.call(electoresPorMesa, mesa.id)
        && electoresPorMesa[mesa.id] !== valorGuardado;
    });

    actualizacionEnCursoRef.current = true;
    setActualizandoDatos(true);
    try {
      const tareas: Promise<unknown>[] = [cargarPublico(true)];
      // No reemplazar lo que el responsable esté escribiendo en el padrón.
      if (perfil && !hayEdicionLocalDeElectores) tareas.push(cargarPerfil(perfil.user_id));
      if (perfil?.rol === 'administrador_general') tareas.push(cargarReportesAdmin());
      await Promise.all(tareas);
      setUltimaActualizacion(new Date());
    } catch (error) {
      console.warn('No se pudo completar la actualización automática:', textoError(error, 'Error de actualización.'));
    } finally {
      actualizacionEnCursoRef.current = false;
      setActualizandoDatos(false);
    }
  }, [cargando, mesaActiva, mesas, electoresPorMesa, cargarPublico, perfil, cargarPerfil, cargarReportesAdmin]);

  useEffect(() => {
    if (!tipoCarga || !mesaActiva) return;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !cargando) {
        setTipoCarga(null);
        setMesaActiva(null);
        setMensaje('');
      }
    };
    window.addEventListener('keydown', cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener('keydown', cerrarConEscape);
    };
  }, [tipoCarga, mesaActiva, cargando]);

  useEffect(() => {
    if (perfil?.rol === 'administrador_general') return;
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void actualizarDatos();
    }, 15000);
    return () => window.clearInterval(intervalo);
  }, [actualizarDatos, perfil?.rol]);

  useEffect(() => {
    let vigente = true;
    supabase.auth.getSession().then(({ data }) => {
      if (vigente && data.session?.user) cargarPerfil(data.session.user.id).catch(() => undefined);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setPerfil(null); setColegios([]); setMesas([]); setReportes([]); setElectoresPorMesa({}); setGuardandoElectoresMesa(null); setCantidadColegiosActivos(0); setCantidadColegiosCartografiados(0); setCantidadMesasActivas(0);
      }
    });
    return () => { vigente = false; listener.subscription.unsubscribe(); };
  }, [cargarPerfil]);

  const iniciarSesion = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setCargando(true); setError(''); setMensaje('');
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.user) throw new Error(authError?.message || 'No se pudo iniciar sesión.');
      const { data: perfilIngresado, error: perfilCheckError } = await supabase
        .from('elecciones_perfiles')
        .select('rol,activo')
        .eq('user_id', data.user.id)
        .maybeSingle();
      if (perfilCheckError || !perfilIngresado?.activo) throw new Error('La cuenta no está habilitada.');
      if (perfilIngresado.rol !== rolElegido) {
        await supabase.auth.signOut();
        setPerfil(null);
        throw new Error(rolElegido === 'administrador_general'
          ? 'Esta cuenta no tiene perfil de Administrador General.'
          : 'Esta cuenta no tiene perfil de Responsable de Escuela.');
      }
      await cargarPerfil(data.user.id);
      setMostrarLogin(false); setPassword('');
    } catch (err) {
      await supabase.auth.signOut();
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally { setCargando(false); }
  };

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    setPerfil(null); setColegios([]); setMesas([]); setReportes([]); setElectoresPorMesa({}); setCantidadColegiosActivos(0); setCantidadColegiosCartografiados(0); setCantidadMesasActivas(0);
    setMensaje('Sesión cerrada.');
  };

  const iniciarEdicionMesasColegio = (colegioId: string) => {
    const actuales = mesas.filter((mesa) => mesa.colegio_id === colegioId)
      .sort((a, b) => Number(a.numero) - Number(b.numero));
    setConfiguracionMesasColegio((old) => ({
      ...old,
      [colegioId]: actuales.map((mesa) => ({ id: mesa.id, numero: String(mesa.numero), reportes_total: 0 })),
    }));
    setColegioMesasEditandoId(colegioId);
    setMensaje('');
  };

  const guardarConfiguracionColegioAdmin = async (colegio: Colegio) => {
    const configuracion = configuracionMesasColegio[colegio.id] ?? [];
    const numeros = configuracion.map((mesa) => Number(mesa.numero));
    if (configuracion.length < 1 || configuracion.length > 100 ||
        numeros.some((n) => !Number.isInteger(n) || n < 1 || n > 100000) ||
        new Set(numeros).size !== numeros.length) {
      setMensaje('La configuración debe tener entre 1 y 100 mesas, con números enteros y sin repetir.');
      return;
    }
    setGuardandoConfiguracionColegio(colegio.id);
    setMensaje('');
    try {
      const { data, error } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: {
          action: 'actualizar_configuracion_colegio',
          colegio_id: colegio.id,
          nombre: colegio.nombre,
          mesas: configuracion.map((mesa) => ({ id: mesa.id, numero: Number(mesa.numero) })),
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'No se pudo guardar la configuración del colegio.');
      setMensaje(data.mensaje || 'Se guardó la configuración del establecimiento.');
      setColegioMesasEditandoId(null);
      setConfiguracionMesasColegio((old) => ({ ...old, [colegio.id]: [] }));
      await cargarPublico();
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo guardar la configuración del colegio.'));
    } finally {
      setGuardandoConfiguracionColegio(null);
    }
  };

  const asignarColegioDesdeAdmin = async (colegioId: string) => {
    const userId = responsableAsignarPorColegio[colegioId];
    if (!userId) { setMensaje('Seleccioná un responsable antes de asignar el colegio.'); return; }
    setGuardandoConfiguracionColegio(colegioId);
    setMensaje('');
    try {
      const { data, error } = await supabase.functions.invoke('dynamic-elecciones-administrar-usuarios', {
        body: { action: 'asignar_colegio', user_id: userId, colegio_id: colegioId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'No se pudo asignar el colegio.');
      setMensaje(data.mensaje || 'Colegio asignado al responsable.');
      setResponsableAsignarPorColegio((old) => ({ ...old, [colegioId]: '' }));
      await cargarUsuariosAdmin();
    } catch (err) {
      setMensaje(await textoErrorFuncion(err, 'No se pudo asignar el colegio.'));
    } finally {
      setGuardandoConfiguracionColegio(null);
    }
  };

  const guardarNombreColegio = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const colegioId = colegioEditandoId;
    const nombreNuevo = colegioNombreEditado.trim().replace(/\s+/g, ' ');
    if (!colegioId) return;
    if (nombreNuevo.length < 3) {
      setMensaje('El nombre del establecimiento debe tener al menos 3 caracteres.');
      return;
    }
    const colegioActual = colegios.find((colegio) => colegio.id === colegioId);
    if (!colegioActual) {
      setMensaje('No se encontró el establecimiento que querés editar. Actualizá la lista e intentá nuevamente.');
      return;
    }
    const normalizadoNuevo = normalizarNombreColegio(nombreNuevo);
    const repetido = colegios.some((colegio) =>
      colegio.id !== colegioId && normalizarNombreColegio(colegio.nombre) === normalizadoNuevo
    );
    if (repetido) {
      setMensaje('Ya existe otro establecimiento con ese nombre. Revisá el listado antes de guardar.');
      return;
    }

    setGuardandoColegio(colegioId);
    setMensaje('');
    try {
      // Solo se modifica el nombre visible. identificador_kml permanece intacto.
      const payload = { nombre: nombreNuevo };
      const { data, error: updateError } = await supabase
        .from('elecciones_colegios')
        .update(payload)
        .eq('id', colegioId)
        .select('id,nombre,nombre_normalizado,identificador_kml,circuito')
        .single();
      if (updateError) {
        if (updateError.code === '42501' || /permission|policy|rls/i.test(updateError.message)) {
          throw new Error('Supabase no autorizó el cambio. Ejecutá primero el SQL de permisos para que solo el Administrador General pueda renombrar colegios.');
        }
        throw new Error(updateError.message);
      }
      const actualizado = data as Colegio;
      setColegios((actuales) => actuales.map((colegio) => colegio.id === colegioId ? actualizado : colegio));
      setColegiosPublicos((actuales) => actuales.map((colegio) => colegio.id === colegioId ? actualizado : colegio));
      setColegioEditandoId(null);
      setColegioNombreEditado('');
      setMensaje(`Se actualizó el nombre del establecimiento: ${actualizado.nombre}.`);
      await cargarPublico();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : 'No se pudo actualizar el nombre del establecimiento.');
    } finally {
      setGuardandoColegio(null);
    }
  };

  const guardarPartidoEnSupabase = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (perfil?.rol !== 'administrador_general') {
      setMensaje('Solo el Administrador General puede administrar partidos.');
      return;
    }
    const nombre = partidoNombre.trim().replace(/\s+/g, ' ');
    const sigla = partidoSigla.trim().toUpperCase();
    if (nombre.length < 3 || !sigla) {
      setMensaje('Ingresá el nombre y la sigla del partido.');
      return;
    }
    setGuardandoPartido(true);
    setMensaje('');
    try {
      const { data, error: insertError } = await supabase
        .from('elecciones_partidos')
        .insert({ nombre, sigla, color: partidoColor, activo: true, orden: partidos.length + 1 })
        .select('id,nombre,sigla,color')
        .single();
      if (insertError) {
        if (insertError.code === '23505') throw new Error('Ya existe un partido con ese nombre o sigla.');
        if (insertError.code === '42501') throw new Error('Supabase no autorizó el alta. Revisá la política de Administrador General.');
        throw insertError;
      }
      setPartidos((actuales) => [...actuales, data as Partido].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      setPartidoNombre('');
      setPartidoSigla('');
      setPartidoColor('#168eae');
      setMensaje(`El partido ${nombre} quedó guardado en Supabase.`);
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : 'No se pudo guardar el partido.');
    } finally {
      setGuardandoPartido(false);
    }
  };

  const aprobarReporte = async (r: ReportePendiente) => {
    setMensaje('');
    const tabla = r.tipo === 'participacion' ? 'elecciones_reportes_participacion' : 'elecciones_reportes_escrutinio';
    const { error: updateError } = await supabase.from(tabla).update({ estado: 'publicado', actualizado_en: new Date().toISOString() }).eq('id', r.id);
    if (updateError) { setMensaje(`No se pudo aprobar: ${updateError.message}`); return; }
    setMensaje('Reporte aprobado y publicado.');
    await cargarReportesAdmin();
    await cargarPublico();
  };

  const guardarElectoresMesa = async (mesa: Mesa) => {
    const valor = (electoresPorMesa[mesa.id] ?? '').trim();
    const cantidad = Number(valor);
    if (!valor || !Number.isSafeInteger(cantidad) || cantidad < 1) {
      setMensaje(`Ingresá una cantidad válida de electores habilitados para la Mesa ${mesa.numero}.`);
      return;
    }

    setGuardandoElectoresMesa(mesa.id);
    setMensaje('');
    try {
      const { data, error: updateError } = await supabase
        .from('elecciones_mesas')
        .update({ electores_habilitados: cantidad })
        .eq('id', mesa.id)
        .select('id,electores_habilitados')
        .maybeSingle();

      if (updateError) {
        if (updateError.code === '42501' || /permission|policy|row-level/i.test(updateError.message)) {
          throw new Error('Supabase bloqueó la actualización por permisos. Revisá la política segura de electores para responsables.');
        }
        throw updateError;
      }
      if (!data) throw new Error('No se actualizó la mesa. Verificá que el establecimiento esté asignado a tu usuario.');

      setMesas((actuales) => actuales.map((item) => item.id === mesa.id
        ? { ...item, electores_habilitados: cantidad }
        : item
      ));
      setElectoresPorMesa((actuales) => ({ ...actuales, [mesa.id]: String(cantidad) }));
      setMesaEditandoElectores(null);
      await cargarPublico(true);
      setMensaje(`Se guardaron ${cantidad.toLocaleString('es-AR')} electores habilitados para la Mesa ${mesa.numero}.`);
    } catch (err) {
      setMensaje(`No se pudo guardar el padrón de la Mesa ${mesa.numero}: ${textoError(err, 'Error de guardado.')}`);
    } finally {
      setGuardandoElectoresMesa(null);
    }
  };

  const abrirCarga = async (mesa: Mesa, tipo: 'participacion' | 'escrutinio') => {
    if (!Number.isInteger(mesa.electores_habilitados) || mesa.electores_habilitados < 1) {
      setMensaje(`Primero informá y guardá los electores habilitados de la Mesa ${mesa.numero}.`);
      return;
    }

    setMesaActiva(mesa);
    setTipoCarga(tipo);
    setMensaje('');
    setVotos({});
    setBlancos('0');
    setNulos('0');
    setFranjasGuardadas({});
    setFranjaHora(HORARIOS_PARTICIPACION[0]);
    setFranjaEditando(false);
    setVotantes('');
    setVotantesUltimoRegistro(null);
    setHoraUltimoRegistro('');
    setEscrutinioGuardado(null);
    setEscrutinioEditando(false);
    setEscrutinioDeOtraCuenta(false);
    setCargandoFranjas(true);

    try {
      const { data: reporteParticipacion, error: consultaError } = await supabase
        .from('elecciones_reportes_participacion')
        .select('id,user_id,estado,elecciones_participacion_franjas(id,hora,votantes)')
        .eq('mesa_id', mesa.id)
        .maybeSingle();
      if (consultaError) throw consultaError;

      const filas = Array.isArray(reporteParticipacion?.elecciones_participacion_franjas)
        ? reporteParticipacion.elecciones_participacion_franjas
        : [];
      const guardadas: Record<string, string> = {};
      for (const fila of filas as Array<{ hora: string; votantes: number }>) {
        const hora = String(fila.hora ?? '').slice(0, 5);
        if (HORARIOS_PARTICIPACION.includes(hora)) guardadas[hora] = String(fila.votantes ?? 0);
      }
      setFranjasGuardadas(guardadas);

      const horasGuardadas = HORARIOS_PARTICIPACION.filter((hora) => guardadas[hora] !== undefined);
      const ultimoHorario = horasGuardadas.at(-1) ?? '';
      setHoraUltimoRegistro(ultimoHorario);
      setVotantesUltimoRegistro(ultimoHorario ? Number(guardadas[ultimoHorario]) : null);

      const primeraFranjaPendiente = HORARIOS_PARTICIPACION.find((hora) => guardadas[hora] === undefined);
      const franjaInicial = primeraFranjaPendiente ?? (ultimoHorario || HORARIOS_PARTICIPACION[0]);
      setFranjaHora(franjaInicial);
      setVotantes(guardadas[franjaInicial] ?? '');
      setFranjaEditando(false);

      if (tipo === 'escrutinio') {
        const { data: reporte, error: escrutinioError } = await supabase
          .from('elecciones_reportes_escrutinio')
          .select('id,user_id,estado,votos_blancos,votos_nulos,elecciones_escrutinio_partidos(partido_id,votos)')
          .eq('mesa_id', mesa.id)
          .maybeSingle();
        if (escrutinioError) throw escrutinioError;

        if (reporte) {
          const votosGuardados = Object.fromEntries(
            (reporte.elecciones_escrutinio_partidos ?? []).map((fila: any) => [
              String(fila.partido_id),
              Number(fila.votos ?? 0),
            ])
          );
          const registro: EscrutinioCargaGuardado = {
            id: reporte.id,
            user_id: reporte.user_id,
            estado: reporte.estado,
            votos_partidos: votosGuardados,
            votos_blancos: Number(reporte.votos_blancos ?? 0),
            votos_nulos: Number(reporte.votos_nulos ?? 0),
          };
          setEscrutinioGuardado(registro);
          setEscrutinioDeOtraCuenta(reporte.user_id !== perfil?.user_id);
          setVotos(Object.fromEntries(Object.entries(votosGuardados).map(([id, cantidad]) => [id, String(cantidad)])));
          setBlancos(String(registro.votos_blancos));
          setNulos(String(registro.votos_nulos));
        } else {
          setEscrutinioEditando(true);
        }
      }
    } catch (err) {
      setMensaje(err instanceof Error
        ? `No se pudieron recuperar los datos guardados: ${err.message}`
        : 'No se pudieron recuperar los datos guardados.');
    } finally {
      setCargandoFranjas(false);
    }
  };

  const seleccionarFranja = (hora: string) => {
    const guardado = franjasGuardadas[hora] !== undefined;
    const primeraFranjaPendiente = HORARIOS_PARTICIPACION.find((item) => franjasGuardadas[item] === undefined);
    if (!guardado && hora !== primeraFranjaPendiente) return;

    setFranjaHora(hora);
    // Seleccionar una franja guardada muestra primero su resumen gris.
    // La edición se habilita únicamente al pulsar el botón "Editar" del resumen.
    setFranjaEditando(false);
    setVotantes(guardado ? franjasGuardadas[hora] : '');
    setMensaje('');
  };

  const enviarParticipacion = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mesaActiva || !perfil) return;

    const cantidad = Number(votantes);
    const electoresHabilitados = Number(mesaActiva.electores_habilitados || 0);
    if (!votantes.trim() || !Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > electoresHabilitados) {
      setMensaje(`La cantidad debe ser un número entero entre 0 y ${electoresHabilitados} electores.`);
      return;
    }

    const indiceHora = HORARIOS_PARTICIPACION.indexOf(franjaHora);
    if (indiceHora < 0) {
      setMensaje('Seleccioná un horario válido entre las 08:00 y las 18:00.');
      return;
    }
    const horaPrevia = indiceHora > 0 ? HORARIOS_PARTICIPACION[indiceHora - 1] : '';
    const horaSiguiente = indiceHora < HORARIOS_PARTICIPACION.length - 1 ? HORARIOS_PARTICIPACION[indiceHora + 1] : '';
    const acumuladoPrevio = horaPrevia && franjasGuardadas[horaPrevia] !== undefined ? Number(franjasGuardadas[horaPrevia]) : null;
    const acumuladoSiguiente = horaSiguiente && franjasGuardadas[horaSiguiente] !== undefined ? Number(franjasGuardadas[horaSiguiente]) : null;

    if (acumuladoPrevio !== null && cantidad < acumuladoPrevio) {
      setMensaje(`El acumulado de las ${franjaHora} no puede ser menor al de las ${horaPrevia} (${acumuladoPrevio} votantes).`);
      return;
    }
    if (acumuladoSiguiente !== null && cantidad > acumuladoSiguiente) {
      setMensaje(`El acumulado de las ${franjaHora} no puede superar al de las ${horaSiguiente} (${acumuladoSiguiente} votantes).`);
      return;
    }
    if (!franjaEditando && indiceHora > 0 && acumuladoPrevio === null) {
      setMensaje(`Primero guardá la franja anterior de las ${horaPrevia}.`);
      return;
    }

    setCargando(true);
    setMensaje('');
    try {
      const { data, error } = await supabase.rpc('guardar_participacion_franja_responsable', {
        p_mesa_id: mesaActiva.id,
        p_hora: `${franjaHora}:00`,
        p_votantes: cantidad,
      });
      if (error) throw error;
      const resultado = data as unknown as {
        success: boolean;
        estado_reporte?: string;
        porcentaje?: number;
        mensaje?: string;
      };
      if (!resultado?.success) throw new Error('Supabase no confirmó el guardado de la participación.');

      const estabaEditando = franjaEditando;
      const franjaGuardada = franjaHora;
      const guardadasActualizadas = { ...franjasGuardadas, [franjaGuardada]: String(cantidad) };
      setFranjasGuardadas(guardadasActualizadas);
      setFranjaEditando(false);

      const primeraPendiente = HORARIOS_PARTICIPACION.find((hora) => guardadasActualizadas[hora] === undefined);
      if (estabaEditando) {
        // Tras corregir una franja, conservarla seleccionada y mostrarla en gris.
        setFranjaHora(franjaGuardada);
        setVotantes(String(cantidad));
      } else if (primeraPendiente) {
        // Una franja nueva completada habilita la siguiente, sin saltar horarios.
        setFranjaHora(primeraPendiente);
        setVotantes('');
      } else {
        setFranjaHora(franjaGuardada);
        setVotantes(String(cantidad));
      }

      const ultimaHoraActual = HORARIOS_PARTICIPACION.filter((hora) => guardadasActualizadas[hora] !== undefined).at(-1) ?? '';
      setHoraUltimoRegistro(ultimaHoraActual);
      setVotantesUltimoRegistro(ultimaHoraActual ? Number(guardadasActualizadas[ultimaHoraActual]) : null);
      setMensaje(resultado.mensaje || `Se guardó el acumulado de las ${franjaHora}.`);
      await cargarPublico(true);
    } catch (err) {
      setMensaje(`No se pudo guardar la participación: ${textoError(err, 'Error de guardado.')}`);
    } finally {
      setCargando(false);
    }
  };

  const enviarEscrutinio = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mesaActiva || !perfil) return;
    if (votantesUltimoRegistro === null) {
      setMensaje('Primero cargá al menos una franja de participación para esta mesa.');
      return;
    }
    if (escrutinioDeOtraCuenta) {
      setMensaje('Este escrutinio pertenece a otra cuenta. Pedile al Administrador General que revise la asignación.');
      return;
    }

    const filas = partidos.map((partido) => ({
      partido_id: partido.id,
      votos: Number(votos[partido.id] ?? ''),
    }));
    if (filas.some((fila) => !Number.isSafeInteger(fila.votos) || fila.votos < 0)) {
      setMensaje('Ingresá una cantidad entera e igual o mayor que cero para cada partido.');
      return;
    }
    const votosPartidos = filas.reduce((total, fila) => total + fila.votos, 0);
    const cantidadBlancos = Number(blancos || 0);
    const cantidadNulos = Number(nulos || 0);
    if (!Number.isSafeInteger(cantidadBlancos) || cantidadBlancos < 0 || !Number.isSafeInteger(cantidadNulos) || cantidadNulos < 0) {
      setMensaje('Los votos en blanco y nulos deben ser números enteros iguales o mayores que cero.');
      return;
    }
    if (votosPartidos > votantesUltimoRegistro) {
      setMensaje(`La suma de votos de los partidos (${votosPartidos}) supera los ${votantesUltimoRegistro} votantes registrados en la mesa.`);
      return;
    }
    if (votosPartidos + cantidadBlancos + cantidadNulos > votantesUltimoRegistro) {
      setMensaje(`La suma total de votos (${votosPartidos + cantidadBlancos + cantidadNulos}) supera los ${votantesUltimoRegistro} votantes registrados en la mesa.`);
      return;
    }

    setCargando(true);
    setMensaje('');
    try {
      const { data, error } = await supabase.rpc('guardar_escrutinio_responsable', {
        p_mesa_id: mesaActiva.id,
        p_votos: filas,
        p_votos_blancos: cantidadBlancos,
        p_votos_nulos: cantidadNulos,
      });
      if (error) throw error;
      const resultado = data as unknown as {
        success: boolean;
        reporte_id: string;
        estado: string;
        mensaje?: string;
      };
      if (!resultado?.success || !resultado.reporte_id) {
        throw new Error('Supabase no confirmó el guardado del escrutinio.');
      }

      const registro: EscrutinioCargaGuardado = {
        id: resultado.reporte_id,
        user_id: perfil.user_id,
        estado: resultado.estado || 'pendiente',
        votos_partidos: Object.fromEntries(filas.map((fila) => [fila.partido_id, fila.votos])),
        votos_blancos: cantidadBlancos,
        votos_nulos: cantidadNulos,
      };
      setEscrutinioGuardado(registro);
      setEscrutinioEditando(false);
      setVotos(Object.fromEntries(filas.map((fila) => [fila.partido_id, String(fila.votos)])));
      setBlancos(String(cantidadBlancos));
      setNulos(String(cantidadNulos));
      setMensaje(resultado.mensaje || 'El escrutinio quedó guardado y enviado a revisión.');
      await cargarPublico(true);
    } catch (err) {
      setMensaje(`No se pudo guardar el escrutinio: ${textoError(err, 'Error de guardado.')}`);
    } finally {
      setCargando(false);
    }
  };
  const participacionPublicaPorMesa = useMemo(() => {
    const mapa = new Map<string, ParticipacionPublicaMesa>();
    for (const reporte of reportesParticipacionPublicos) {
      const filas = [...(reporte.elecciones_participacion_franjas ?? [])]
        .sort((a: any, b: any) => String(b.hora).localeCompare(String(a.hora)));
      const ultima = filas[0];
      if (!ultima || !reporte.mesa_id) continue;
      mapa.set(String(reporte.mesa_id), {
        mesa_id: String(reporte.mesa_id),
        votantes: Number(ultima.votantes || 0),
        hora: String(ultima.hora || ''),
      });
    }
    return mapa;
  }, [reportesParticipacionPublicos]);

  const escrutinioPublicoPorMesa = useMemo(() => {
    const mapa = new Map<string, EscrutinioPublicoMesa>();
    for (const reporte of reportesEscrutinioPublicos) {
      if (!reporte.mesa_id) continue;
      const partidosMesa: ResultadoPartidoPublico[] = (reporte.elecciones_escrutinio_partidos ?? []).map((fila: any) => {
        const partido = Array.isArray(fila.elecciones_partidos) ? fila.elecciones_partidos[0] : fila.elecciones_partidos;
        if (!partido) return null;
        return {
          partido_id: String(fila.partido_id),
          nombre: String(partido.nombre || 'Partido'),
          color: String(partido.color || '#168eae'),
          votos: Number(fila.votos || 0),
        };
      }).filter(Boolean) as ResultadoPartidoPublico[];
      mapa.set(String(reporte.mesa_id), {
        mesa_id: String(reporte.mesa_id),
        votos_blancos: Number(reporte.votos_blancos || 0),
        votos_nulos: Number(reporte.votos_nulos || 0),
        partidos: partidosMesa.sort((a, b) => b.votos - a.votos),
      });
    }
    return mapa;
  }, [reportesEscrutinioPublicos]);

  const sumarPartidos = (mesasParaSumar: Mesa[]) => {
    const acumulados = new Map<string, ResultadoPartidoPublico>();
    for (const mesa of mesasParaSumar) {
      const resultado = escrutinioPublicoPorMesa.get(mesa.id);
      for (const partido of resultado?.partidos ?? []) {
        const actual = acumulados.get(partido.partido_id);
        if (actual) actual.votos += partido.votos;
        else acumulados.set(partido.partido_id, { ...partido });
      }
    }
    return Array.from(acumulados.values()).sort((a, b) => b.votos - a.votos);
  };

  const colegiosDelCircuito = useMemo(
    () => colegiosPublicos.filter((colegio) => String(colegio.circuito || '').trim() === circuitoSeleccionado),
    [colegiosPublicos, circuitoSeleccionado],
  );
  const idsColegiosCircuito = useMemo(() => new Set(colegiosDelCircuito.map((colegio) => colegio.id)), [colegiosDelCircuito]);
  const mesasDelCircuito = useMemo(
    () => mesasPublicas.filter((mesa) => idsColegiosCircuito.has(mesa.colegio_id)),
    [mesasPublicas, idsColegiosCircuito],
  );
  const mesasCircuitoConParticipacion = mesasDelCircuito.filter((mesa) => participacionPublicaPorMesa.has(mesa.id)).length;
  const votantesCircuito = mesasDelCircuito.reduce((total, mesa) => total + (participacionPublicaPorMesa.get(mesa.id)?.votantes || 0), 0);
  const habilitadosCircuito = mesasDelCircuito.reduce((total, mesa) => total + Number(mesa.electores_habilitados || 0), 0);
  const porcentajeCircuitoSeleccionado = habilitadosCircuito > 0 ? Math.min(100, votantesCircuito / habilitadosCircuito * 100) : 0;

  // Indicadores territoriales del circuito seleccionado en la vista de resultados.
  const colegiosCircuitoResultados = useMemo(
    () => colegiosPublicos.filter((colegio) => String(colegio.circuito || '').trim() === circuitoResultadoSeleccionado),
    [colegiosPublicos, circuitoResultadoSeleccionado],
  );
  const idsColegiosCircuitoResultados = useMemo(
    () => new Set(colegiosCircuitoResultados.map((colegio) => colegio.id)),
    [colegiosCircuitoResultados],
  );
  const mesasCircuitoResultados = useMemo(
    () => mesasPublicas.filter((mesa) => idsColegiosCircuitoResultados.has(mesa.colegio_id)).sort((a, b) => a.numero - b.numero),
    [mesasPublicas, idsColegiosCircuitoResultados],
  );
  const partidosCircuitoResultados = sumarPartidos(mesasCircuitoResultados);
  const totalVotosPartidosCircuito = partidosCircuitoResultados.reduce((total, partido) => total + partido.votos, 0);
  const mesasCircuitoConParticipacionResultado = mesasCircuitoResultados.filter((mesa) => participacionPublicaPorMesa.has(mesa.id)).length;
  const votantesCircuitoResultado = mesasCircuitoResultados.reduce((total, mesa) => total + (participacionPublicaPorMesa.get(mesa.id)?.votantes || 0), 0);
  const habilitadosCircuitoResultado = mesasCircuitoResultados.reduce((total, mesa) => total + Number(mesa.electores_habilitados || 0), 0);
  const porcentajeParticipacionCircuitoResultado = habilitadosCircuitoResultado > 0
    ? Math.min(100, votantesCircuitoResultado / habilitadosCircuitoResultado * 100)
    : 0;
  const mesasCircuitoConEscrutinio = mesasCircuitoResultados.filter((mesa) => escrutinioPublicoPorMesa.has(mesa.id)).length;
  const votosBlancosCircuito = mesasCircuitoResultados.reduce((total, mesa) => total + (escrutinioPublicoPorMesa.get(mesa.id)?.votos_blancos || 0), 0);
  const votosNulosCircuito = mesasCircuitoResultados.reduce((total, mesa) => total + (escrutinioPublicoPorMesa.get(mesa.id)?.votos_nulos || 0), 0);
  const totalVotosEscrutadosCircuito = totalVotosPartidosCircuito + votosBlancosCircuito + votosNulosCircuito;
  const resultadosVotosCircuito = [
    ...partidosCircuitoResultados.map((partido) => ({
      key: partido.partido_id,
      nombre: partido.nombre,
      color: partido.color,
      votos: partido.votos,
    })),
    { key: 'votos-blancos', nombre: 'Votos en blanco', color: '#64748b', votos: votosBlancosCircuito },
    { key: 'votos-nulos', nombre: 'Votos nulos', color: '#8b5cf6', votos: votosNulosCircuito },
  ].filter((item) => item.votos > 0);

  const seleccionarCircuito = (codigo: string) => {
    setCircuitoSeleccionado(codigo);
    setCircuitoResultadoSeleccionado(codigo);
  };

  const seleccionarColegioPublico = (colegio: Colegio) => {
    const identificadorPoligono = String(
      colegio.identificador_kml || colegio.nombre_normalizado || colegio.nombre
    ).trim();
    setColegioSeleccionadoPublico(colegio.id);
    setColegioPoligonoSeleccionado(identificadorPoligono);
    setBusquedaColegio(colegio.nombre);
    setMostrarResultadosBusquedaColegio(false);
  };

  const seleccionarPoligonoColegio = (nombrePoligono: string) => {
    setColegioPoligonoSeleccionado(nombrePoligono);
    const nombreNormalizado = normalizarNombreColegio(nombrePoligono);
    const coincidencia = colegiosPublicos.find((colegio) => {
      const nombreKmlEstable = String(colegio.identificador_kml || colegio.nombre_normalizado || '').trim();
      return nombreKmlEstable === nombreNormalizado || normalizarNombreColegio(colegio.nombre) === nombreNormalizado;
    });
    setColegioSeleccionadoPublico(coincidencia?.id || '');
    setBusquedaColegio(coincidencia?.nombre || nombrePoligono);
    setMostrarResultadosBusquedaColegio(false);
  };

  const colegiosFiltradosPorBusqueda = useMemo(() => {
    const consulta = normalizarNombreColegio(busquedaColegio);
    if (!consulta) return [];
    return colegiosPublicos
      .filter((colegio) => {
        const nombre = normalizarNombreColegio(colegio.nombre);
        const circuito = normalizarNombreColegio(String(colegio.circuito || ''));
        return nombre.includes(consulta) || circuito.includes(consulta);
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, 8);
  }, [colegiosPublicos, busquedaColegio]);

  const colegioPublicoActivo = colegiosPublicos.find((colegio) => colegio.id === colegioSeleccionadoPublico) || null;
  const mesasDelColegio = useMemo(
    () => mesasPublicas.filter((mesa) => mesa.colegio_id === colegioSeleccionadoPublico).sort((a, b) => a.numero - b.numero),
    [mesasPublicas, colegioSeleccionadoPublico],
  );
  const mesasColegioConParticipacion = mesasDelColegio.filter((mesa) => participacionPublicaPorMesa.has(mesa.id)).length;
  const mesasColegioConEscrutinio = mesasDelColegio.filter(
    (mesa) => escrutinioPublicoPorMesa.has(mesa.id)
  ).length;
  
  const porcentajeMesasEscrutadasColegio = mesasDelColegio.length
    ? (mesasColegioConEscrutinio / mesasDelColegio.length) * 100
    : 0;
  const votantesColegio = mesasDelColegio.reduce((total, mesa) => total + (participacionPublicaPorMesa.get(mesa.id)?.votantes || 0), 0);
  const habilitadosColegio = mesasDelColegio.reduce((total, mesa) => total + Number(mesa.electores_habilitados || 0), 0);
  const porcentajeColegio = habilitadosColegio > 0 ? Math.min(100, votantesColegio / habilitadosColegio * 100) : 0;
  const partidosColegio = sumarPartidos(mesasDelColegio);
  const totalVotosColegio = partidosColegio.reduce((total, partido) => total + partido.votos, 0);
  const votosBlancosColegio = mesasDelColegio.reduce(
    (total, mesa) => total + (escrutinioPublicoPorMesa.get(mesa.id)?.votos_blancos || 0),
    0,
  );
  const votosNulosColegio = mesasDelColegio.reduce(
    (total, mesa) => total + (escrutinioPublicoPorMesa.get(mesa.id)?.votos_nulos || 0),
    0,
  );
  const totalVotosEscrutadosColegio =
    totalVotosColegio + votosBlancosColegio + votosNulosColegio;

  // Ganador y porcentaje por establecimiento para colorear cada polígono KML.
  // El denominador incluye votos partidarios, blancos y nulos, igual que la
  // distribución que ve el usuario en el panel del colegio.
  const resultadosPorColegio = useMemo(() => {
    const resultados: Record<string, ResultadoGanadorColegio> = {};

    for (const colegio of colegiosPublicos) {
      const mesasColegio = mesasPublicas.filter((mesa) => mesa.colegio_id === colegio.id);
      const acumulados = new Map<string, { partido_id: string; partido: string; color: string; votos: number }>();
      let blancos = 0;
      let nulos = 0;

      for (const mesa of mesasColegio) {
        const escrutinio = escrutinioPublicoPorMesa.get(mesa.id);
        if (!escrutinio) continue;
        blancos += escrutinio.votos_blancos;
        nulos += escrutinio.votos_nulos;

        for (const fila of escrutinio.partidos) {
          const actual = acumulados.get(fila.partido_id);
          if (actual) actual.votos += fila.votos;
          else acumulados.set(fila.partido_id, {
            partido_id: fila.partido_id,
            partido: fila.nombre,
            color: fila.color,
            votos: fila.votos,
          });
        }
      }

      const lista = Array.from(acumulados.values()).sort((a, b) => b.votos - a.votos);
      const ganador = lista[0];
      const votosPartidarios = lista.reduce((total, item) => total + item.votos, 0);
      const totalEscrutado = votosPartidarios + blancos + nulos;
      if (!ganador || totalEscrutado <= 0 || ganador.votos <= 0) continue;

      const resultado: ResultadoGanadorColegio = {
        ...ganador,
        porcentaje: (ganador.votos / totalEscrutado) * 100,
        total_escrutado: totalEscrutado,
      };

      const identificadores = [
        colegio.identificador_kml,
        colegio.nombre_normalizado,
        colegio.nombre,
      ];
      for (const identificador of identificadores) {
        const llave = normalizarNombreColegio(String(identificador || ''));
        if (llave) resultados[llave] = resultado;
      }
    }

    return resultados;
  }, [colegiosPublicos, mesasPublicas, escrutinioPublicoPorMesa]);

  const mesasActivasMunicipio = mesasPublicas;
  const votantesMunicipio = mesasActivasMunicipio.reduce((total, mesa) => total + (participacionPublicaPorMesa.get(mesa.id)?.votantes || 0), 0);
  const habilitadosMunicipio = mesasActivasMunicipio.reduce((total, mesa) => total + Number(mesa.electores_habilitados || 0), 0);
  const porcentajeMunicipio = habilitadosMunicipio > 0 ? Math.min(100, votantesMunicipio / habilitadosMunicipio * 100) : 0;
  const mesasMunicipioConParticipacion = mesasActivasMunicipio.filter((mesa) => participacionPublicaPorMesa.has(mesa.id)).length;
  const circuitosActivosMunicipio = new Set(
    colegiosPublicos.map((colegio) => String(colegio.circuito || '').trim()).filter(Boolean)
  ).size;
  const partidosMunicipio = sumarPartidos(mesasActivasMunicipio);
  const totalVotosMunicipio = partidosMunicipio.reduce((total, partido) => total + partido.votos, 0);
  const votosBlancosMunicipio = mesasActivasMunicipio.reduce(
    (total, mesa) => total + (escrutinioPublicoPorMesa.get(mesa.id)?.votos_blancos || 0), 0,
  );
  const votosNulosMunicipio = mesasActivasMunicipio.reduce(
    (total, mesa) => total + (escrutinioPublicoPorMesa.get(mesa.id)?.votos_nulos || 0), 0,
  );
  const totalVotosEscrutadosMunicipio = totalVotosMunicipio + votosBlancosMunicipio + votosNulosMunicipio;
  const resultadosVotosMunicipio = [
    ...partidosMunicipio.map((partido) => ({
      key: partido.partido_id,
      nombre: partido.nombre,
      color: partido.color,
      votos: partido.votos,
    })),
    { key: 'votos-blancos', nombre: 'Votos en blanco', color: '#64748b', votos: votosBlancosMunicipio },
    { key: 'votos-nulos', nombre: 'Votos nulos', color: '#8b5cf6', votos: votosNulosMunicipio },
  ].filter((item) => item.votos > 0);
  const mesasMunicipioConEscrutinio = mesasActivasMunicipio.filter((mesa) => escrutinioPublicoPorMesa.has(mesa.id)).length;
  const porcentajeMesasCerradasMunicipio = mesasActivasMunicipio.length
    ? (mesasMunicipioConEscrutinio / mesasActivasMunicipio.length) * 100
    : 0;
  const avanceCierrePorCircuito = CIRCUITOS_ELECTORALES.map((codigo) => {
    const idsColegios = new Set(
      colegiosPublicos
        .filter((colegio) => String(colegio.circuito || '').trim() === codigo)
        .map((colegio) => colegio.id)
    );
    const mesasDelCircuito = mesasActivasMunicipio.filter((mesa) => idsColegios.has(mesa.colegio_id));
    const cerradas = mesasDelCircuito.filter((mesa) => escrutinioPublicoPorMesa.has(mesa.id)).length;
    return {
      codigo,
      total: mesasDelCircuito.length,
      cerradas,
      porcentaje: mesasDelCircuito.length ? (cerradas / mesasDelCircuito.length) * 100 : 0,
    };
  });

  const colegioPorId = useMemo(() => Object.fromEntries(colegios.map((c) => [c.id, c])), [colegios]);
  const electoresMesaActiva = Number(mesaActiva?.electores_habilitados || 0);
  const ultimoHorarioGuardado = HORARIOS_PARTICIPACION.filter((hora) => franjasGuardadas[hora] !== undefined).slice(-1)[0] || '';
  const indiceSiguienteFranja = HORARIOS_PARTICIPACION.findIndex((hora) => franjasGuardadas[hora] === undefined);
  const indiceFranjaSeleccionada = HORARIOS_PARTICIPACION.indexOf(franjaHora);
  const horaPreviaSeleccionada = indiceFranjaSeleccionada > 0 ? HORARIOS_PARTICIPACION[indiceFranjaSeleccionada - 1] : '';
  const acumuladoPreviaSeleccionada = horaPreviaSeleccionada && franjasGuardadas[horaPreviaSeleccionada] !== undefined
    ? Number(franjasGuardadas[horaPreviaSeleccionada])
    : null;
  const hayValorEnEdicion = votantes.trim() !== '';
  const votantesActuales = hayValorEnEdicion
    ? Number(votantes)
    : acumuladoPreviaSeleccionada ?? (ultimoHorarioGuardado ? Number(franjasGuardadas[ultimoHorarioGuardado]) : 0);
  const totalVotosPartidosActual = partidos.reduce((total, partido) => total + (Number(votos[partido.id] || 0) || 0), 0);
  const totalEscrutinioActual = totalVotosPartidosActual + (Number(blancos || 0) || 0) + (Number(nulos || 0) || 0);
  const escrutinioSuperaParticipacion = votantesUltimoRegistro !== null
    && (totalVotosPartidosActual > votantesUltimoRegistro || totalEscrutinioActual > votantesUltimoRegistro);
  const porcentajeParticipacionActual = electoresMesaActiva > 0 && Number.isFinite(votantesActuales)
    ? Math.max(0, Math.min(100, (votantesActuales / electoresMesaActiva) * 100))
    : 0;
  const porcentajeParticipacionRedondeado = Math.round(porcentajeParticipacionActual);

  return (
    <section className="e27-shell">
      <header className="e27-header">
        <div className="e27-heading">
          <span className="e27-kicker">OBSERVATORIO · LA MATANZA</span>
          <h1>Elecciones <em>2027</em></h1>
          <p>Seguimiento electoral, participación y resultados oficiales validados.</p>
        </div>
        <div className="e27-header-actions">
          <span className={`e27-connection e27-connection-${estadoConexion}`}>
            <i /> {estadoConexion === 'conectado' ? 'Supabase conectado' : estadoConexion === 'error' ? 'Sin conexión con Supabase' : 'Verificando Supabase…'}
          </span>
          <button
            type="button"
            className="e27-white-button e27-refresh-button"
            onClick={() => void actualizarDatos()}
            disabled={actualizandoDatos || Boolean(mesaActiva)}
            title={ultimaActualizacion ? `Última actualización: ${ultimaActualizacion.toLocaleTimeString('es-AR')}` : 'Actualización automática cada 15 segundos'}
          >
            {actualizandoDatos ? 'Actualizando…' : '↻ Actualizar datos'}
          </button>
          {!perfil ? (
            <button type="button" className="e27-white-button e27-admin-access-button" onClick={() => { setError(''); setMostrarLogin(true); }}>Administración</button>
          ) : (
            <div className="e27-session">
              <span className="e27-session-identity">
                <strong>{perfil.nombre.trim().toLowerCase() === (perfil.rol === 'administrador_general' ? 'administrador general' : 'responsable de escuela') ? 'Sesión activa' : perfil.nombre}</strong>
                <small>{perfil.rol === 'administrador_general' ? 'Administrador General' : 'Responsable de Escuela'}</small>
              </span>
              <button type="button" className="e27-white-button e27-white-button-small" onClick={cerrarSesion}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </header>

      {!perfil ? (
        <>
          <nav className="e27-tabs" aria-label="Secciones públicas">
            {[
              ['participacion', 'Participación', 'Votantes y participación'],
              ['municipio', 'La Matanza', 'Ganador municipal'],
              ['circuitos', 'Circuitos', 'Resultados territoriales'],
              ['colegios', 'Colegios', 'Establecimientos'],
            ].map(([id, label, desc]) => (
              <button key={id} className={`e27-tab ${vista === id ? 'selected' : ''}`} onClick={() => setVista(id as typeof vista)}>
                <span>{id === 'municipio' ? '▰' : id === 'colegios' ? '▦' : id === 'circuitos' ? '⌖' : '◉'}</span>
                <div><strong>{label}</strong><small>{desc}</small></div>
              </button>
            ))}
          </nav>

          {vista === 'municipio' ? (
            <div className="e27-public-split e27-municipio-layout">
              <section className="e27-panel e27-public-map-panel">
                <div className="e27-panel-heading">
                  <div><span className="e27-kicker">MAPA MUNICIPAL · LA MATANZA</span><h2>Resultados municipales</h2><p>El municipio se muestra como una única unidad territorial. El color identifica al partido con más votos publicados.</p></div>
                  <span className="e27-map-label">LA MATANZA</span>
                </div>
                <div className="e27-map-wrap e27-map-wrap-municipio"><MapaMunicipal data={municipio} color={colorGanador} /></div>
                {errorMunicipio && <div className="e27-feedback e27-map-error">{errorMunicipio}</div>}
                <div className="e27-winner-line"><i style={{ background: colorGanador }} /><strong>{nombreGanador}</strong></div>
              </section>
              <aside className="e27-panel e27-public-summary-panel">
                <span className="e27-kicker">PARTICIPACIÓN GENERAL</span>
                <div className="e27-big-turnout"><strong>{habilitadosMunicipio ? `${Math.round(porcentajeMunicipio)}%` : '—'}</strong><span>del padrón habilitado votó</span></div>
                <div className="e27-progress-track"><span style={{ width: `${porcentajeMunicipio}%` }} /></div>
                <div className="e27-public-mini-stats">
                  <article><small>VOTANTES REGISTRADOS</small><strong>{numeroAR(votantesMunicipio)}</strong></article>
                  <article><small>MESAS CON PARTICIPACIÓN</small><strong>{numeroAR(mesasMunicipioConParticipacion)} / {numeroAR(mesasActivasMunicipio.length)}</strong></article>
                </div>
                <div className="e27-party-results-heading"><div><span className="e27-kicker">ESCRUTINIO PUBLICADO</span><h3>Distribución de votos escrutados</h3></div><small>{numeroAR(totalVotosEscrutadosMunicipio)} votos escrutados</small></div>
                {resultadosVotosMunicipio.length ? (
                  <div className="e27-party-results-list">
                    {resultadosVotosMunicipio.map((item) => {
                      const porcentaje = totalVotosEscrutadosMunicipio > 0
                        ? (item.votos / totalVotosEscrutadosMunicipio) * 100
                        : 0;
                      return (
                        <article className="e27-party-result" key={item.key}>
                          <div className="e27-party-result-line"><span><i style={{ background: item.color }} />{item.nombre}</span><strong>{porcentaje.toFixed(1)}%</strong></div>
                          <div className="e27-party-result-track"><span style={{ width: `${Math.min(100, porcentaje)}%`, background: item.color }} /></div>
                          <small>{numeroAR(item.votos)} votos</small>
                        </article>
                      );
                    })}
                  </div>
                ) : <div className="e27-empty-state"><strong>Todavía no hay escrutinios publicados</strong><span>Los resultados aparecerán cuando se aprueben las cargas de las mesas.</span></div>}
                {errorDatosPublicos && <div className="e27-public-data-warning">{errorDatosPublicos}</div>}
              </aside>
            </div>
          ) : vista === 'colegios' ? (
            <div
              className="e27-public-split e27-college-layout"
              style={{ alignItems: 'stretch' }}
            >
              <section
                className="e27-panel e27-public-map-panel"
                style={{
                  minWidth: 0,
                  minHeight: 'fit-content',
                  boxSizing: 'border-box',
                }}
              >
                <div className="e27-panel-heading e27-college-map-heading">
                  <div>
                    <span className="e27-kicker">CARTOGRAFÍA DE ESTABLECIMIENTOS</span>
                    <h2>Mapa de colegios</h2>
                    <p>Hacé clic directamente sobre el polígono de un colegio o elegilo en el panel lateral.</p>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '7px',
                    flexShrink: 0,
                  }}>
                    <span className="e27-map-label">SOLO POLÍGONOS DE COLEGIOS</span>
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #b8ddeb',
                      borderRadius: '14px',
                      padding: '14px 16px',
                      minWidth: '154px',
                      minHeight: '116px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      boxSizing: 'border-box',
                      boxShadow: '0 3px 10px rgba(20,70,100,0.08)',
                      textAlign: 'center',
                    }}>
                      <span style={{
                        display: 'block',
                        fontSize: '9px',
                        fontWeight: 800,
                        color: '#087f9f',
                        letterSpacing: '1px',
                      }}>
                        MESAS CERRADAS
                      </span>
                      <strong style={{
                        display: 'block',
                        fontSize: '32px',
                        lineHeight: 1.2,
                        color: '#087f9f',
                      }}>
                        {mesasDelColegio.length
                          ? `${porcentajeMesasEscrutadasColegio.toFixed(1)}%`
                          : '—'}
                      </strong>
                      <small style={{ color: '#526b7e', fontSize: '10px' }}>
                        {numeroAR(mesasColegioConEscrutinio)} de {numeroAR(mesasDelColegio.length)} mesas
                      </small>
                    </div>
                  </div>
                </div>
                <div className="e27-map-wrap e27-map-wrap-colleges"><MapaColegios data={colegiosKml} resultados={resultadosPorColegio} colegioSeleccionado={colegioPublicoActivo?.identificador_kml || colegioPublicoActivo?.nombre_normalizado || colegioPublicoActivo?.nombre || colegioPoligonoSeleccionado} onSeleccionar={seleccionarPoligonoColegio} /></div>
                <div className="e27-map-foot">{colegiosKml?.features.length ?? '—'} polígonos de establecimientos · La capa de circuitos está excluida</div>
                <div className="e27-college-map-legend">
                  <div className="e27-college-map-legend-parties">
                    <strong>Partido ganador por colegio</strong>
                    {partidos.filter((partido) => Object.values(resultadosPorColegio).some((resultado) => resultado.partido_id === partido.id)).map((partido) => (
                      <span key={partido.id}><i style={{ background: partido.color }} />{partido.nombre}</span>
                    ))}
                    {!Object.keys(resultadosPorColegio).length && <small>Los polígonos se colorearán cuando haya escrutinios publicados.</small>}
                  </div>
                  <small className="e27-college-map-strength">Color más claro = menor porcentaje · Color más intenso = mayor porcentaje</small>
                </div>
              </section>
              <aside
                className="e27-panel e27-public-summary-panel"
                style={{
                  height: '100%',
                  minHeight: 0,
                  maxHeight: 'none',
                  overflowY: 'auto',
                  alignSelf: 'stretch',
                  boxSizing: 'border-box',
                }}
              >
                <span className="e27-kicker">CONSULTA POR ESTABLECIMIENTO</span>
                <h2>Participación y escrutinio</h2>
                <div className="e27-school-search-block">
                  <label className="e27-public-filter" htmlFor="e27-buscar-colegio">Buscar establecimiento
                    <div className="e27-school-search-control">
                      <input
                        id="e27-buscar-colegio"
                        type="search"
                        value={busquedaColegio}
                        onChange={(e) => {
                          setBusquedaColegio(e.target.value);
                          setMostrarResultadosBusquedaColegio(true);
                        }}
                        onFocus={() => setMostrarResultadosBusquedaColegio(true)}
                        placeholder="Escribí el nombre del colegio…"
                        autoComplete="off"
                        aria-label="Buscar establecimiento por nombre o circuito"
                      />
                      {busquedaColegio && <button type="button" className="e27-school-search-clear" onClick={() => {
                        setBusquedaColegio('');
                        setMostrarResultadosBusquedaColegio(false);
                      }}>Limpiar</button>}
                    </div>
                  </label>
                  {mostrarResultadosBusquedaColegio && busquedaColegio.trim().length > 0 && (
                    <div className="e27-school-search-results" role="listbox" aria-label="Resultados de búsqueda de colegios">
                      {colegiosFiltradosPorBusqueda.length ? colegiosFiltradosPorBusqueda.map((colegio) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={colegio.id === colegioSeleccionadoPublico}
                          className="e27-school-search-option"
                          key={colegio.id}
                          onClick={() => seleccionarColegioPublico(colegio)}
                        >
                          <span>{colegio.nombre}</span>
                          <small>Circuito {colegio.circuito || '—'}</small>
                        </button>
                      )) : <div className="e27-school-search-empty">No encontramos establecimientos con esa búsqueda.</div>}
                    </div>
                  )}
                </div>
                <label className="e27-public-filter">Seleccionar colegio
                  <select value={colegioSeleccionadoPublico} onChange={(e) => {
                    const colegio = colegiosPublicos.find((item) => item.id === e.target.value);
                    if (colegio) seleccionarColegioPublico(colegio);
                    else {
                      setColegioSeleccionadoPublico('');
                      setColegioPoligonoSeleccionado('');
                      setBusquedaColegio('');
                    }
                  }}>
                    <option value="">Seleccionar colegio</option>
                    {colegiosPublicos.map((colegio) => <option key={colegio.id} value={colegio.id}>{colegio.nombre} · Circuito {colegio.circuito || '—'}</option>)}
                  </select>
                </label>
                {colegioPublicoActivo ? (
                  <>
                    {/* ENCABEZADO DEL ESTABLECIMIENTO */}
                    <div className="e27-selected-school">
                      <strong>{colegioPublicoActivo.nombre}</strong>
                      <span>Circuito {colegioPublicoActivo.circuito || '—'}</span>
                    </div>

                    {/* RESULTADOS PUBLICADOS: PARTIDOS, VOTOS EN BLANCO Y NULOS */}
                    <section className="e27-all-circuit-parties e27-college-party-results">
                      <div className="e27-party-results-heading">
                        <div>
                          <span className="e27-kicker">ESCRUTINIO PUBLICADO</span>
                          <h3>Distribución de votos escrutados</h3>
                        </div>
                        <small>{numeroAR(totalVotosEscrutadosColegio)} votos escrutados</small>
                      </div>

                      {totalVotosEscrutadosColegio > 0 ? (
                        <div className="e27-party-results-list">
                          {partidosColegio.map((partido) => {
                            const porcentaje = (partido.votos / totalVotosEscrutadosColegio) * 100;

                            return (
                              <article className="e27-party-result" key={partido.partido_id}>
                                <div className="e27-party-result-line">
                                  <span>
                                    <i style={{ background: partido.color }} />
                                    {partido.nombre}
                                  </span>
                                  <strong>{porcentaje.toFixed(1)}%</strong>
                                </div>
                                <div className="e27-party-result-track">
                                  <span
                                    style={{
                                      width: `${Math.min(100, porcentaje)}%`,
                                      background: partido.color,
                                    }}
                                  />
                                </div>
                                <small>{numeroAR(partido.votos)} votos</small>
                              </article>
                            );
                          })}

                          <article className="e27-party-result" key="votos-blancos-colegio">
                            <div className="e27-party-result-line">
                              <span>
                                <i style={{ background: '#64748b' }} />
                                Votos en blanco
                              </span>
                              <strong>
                                {(votosBlancosColegio / totalVotosEscrutadosColegio * 100).toFixed(1)}%
                              </strong>
                            </div>
                            <div className="e27-party-result-track">
                              <span
                                style={{
                                  width: `${Math.min(100, votosBlancosColegio / totalVotosEscrutadosColegio * 100)}%`,
                                  background: '#64748b',
                                }}
                              />
                            </div>
                            <small>{numeroAR(votosBlancosColegio)} votos</small>
                          </article>

                          <article className="e27-party-result" key="votos-nulos-colegio">
                            <div className="e27-party-result-line">
                              <span>
                                <i style={{ background: '#8b5cf6' }} />
                                Votos nulos
                              </span>
                              <strong>
                                {(votosNulosColegio / totalVotosEscrutadosColegio * 100).toFixed(1)}%
                              </strong>
                            </div>
                            <div className="e27-party-result-track">
                              <span
                                style={{
                                  width: `${Math.min(100, votosNulosColegio / totalVotosEscrutadosColegio * 100)}%`,
                                  background: '#8b5cf6',
                                }}
                              />
                            </div>
                            <small>{numeroAR(votosNulosColegio)} votos</small>
                          </article>
                        </div>
                      ) : (
                        <div className="e27-empty-state">
                          <strong>No hay escrutinios publicados</strong>
                          <span>
                            Los resultados aparecerán cuando se aprueben los escrutinios de las mesas.
                          </span>
                        </div>
                      )}
                    </section>

                    {/* ESTADÍSTICAS GENERALES DEL COLEGIO */}
                    <div
                      className="e27-public-mini-stats"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        alignItems: 'stretch',
                        gap: '10px',
                      }}
                    >
                      <article style={{ minWidth: 0, minHeight: '76px', boxSizing: 'border-box' }}>
                        <small>MESAS DEL COLEGIO</small>
                        <strong>{numeroAR(mesasDelColegio.length)}</strong>
                      </article>
                      <article style={{ minWidth: 0, minHeight: '76px', boxSizing: 'border-box' }}>
                        <small>MESAS CON PARTICIPACIÓN</small>
                        <strong>
                          {numeroAR(mesasColegioConParticipacion)} / {numeroAR(mesasDelColegio.length)}
                        </strong>
                      </article>
                    </div>

                    {/* PARTICIPACIÓN DEL ESTABLECIMIENTO */}
                    <section className="e27-all-circuit-turnout">
                      <span className="e27-kicker">PARTICIPACIÓN GENERAL</span>
                      <div className="e27-big-turnout">
                        <strong>{habilitadosColegio ? `${porcentajeColegio.toFixed(1)}%` : '—'}</strong>
                        <span>del padrón habilitado votó</span>
                      </div>
                      <div className="e27-progress-track">
                        <span style={{ width: `${porcentajeColegio}%` }} />
                      </div>
                      <div className="e27-all-circuit-turnout-caption">
                        <b>{numeroAR(votantesColegio)} votantes registrados</b>
                        <span>sobre {numeroAR(habilitadosColegio)} electores habilitados</span>
                      </div>
                    </section>

                    {/* DETALLE INDIVIDUAL DE LAS MESAS */}
                    <div className="e27-mesa-public-list">
                      {mesasDelColegio.map((mesa) => {
                        const participacion = participacionPublicaPorMesa.get(mesa.id);
                        const porcentaje = Number(mesa.electores_habilitados || 0) > 0 && participacion
                          ? Math.min(
                              100,
                              participacion.votantes / Number(mesa.electores_habilitados) * 100,
                            )
                          : 0;
                        const escrutinio = escrutinioPublicoPorMesa.get(mesa.id);
                        const ganadorMesa = escrutinio?.partidos[0];

                        return (
                          <article className="e27-mesa-public-card" key={mesa.id}>
                            <div className="e27-mesa-public-top">
                              <strong>Mesa {mesa.numero}</strong>
                              <span>
                                {participacion
                                  ? `${Math.round(porcentaje)}% participación`
                                  : 'Sin participación publicada'}
                              </span>
                            </div>
                            <div className="e27-mesa-public-meta">
                              <small>
                                {numeroAR(participacion?.votantes || 0)} votantes ·{' '}
                                {numeroAR(Number(mesa.electores_habilitados || 0))} electores
                              </small>
                              <small>
                                {escrutinio
                                  ? `Escrutinio: ${ganadorMesa?.nombre || 'publicado'}`
                                  : 'Escrutinio pendiente'}
                              </small>
                            </div>
                            {escrutinio?.partidos?.length ? (
                              <div className="e27-mesa-party-line">
                                {escrutinio.partidos.map((partido) => (
                                  <span key={partido.partido_id}>
                                    <i style={{ background: partido.color }} />
                                    {partido.nombre}: <b>{numeroAR(partido.votos)}</b>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}

                      {!mesasDelColegio.length && (
                        <div className="e27-empty-state">
                          <strong>Este colegio todavía no tiene mesas activas</strong>
                          <span>Las mesas aparecerán cuando estén registradas en el sistema.</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : colegioPoligonoSeleccionado ? (
                  <div className="e27-empty-state e27-polygon-unlinked-state">
                    <strong>{colegioPoligonoSeleccionado} · polígono seleccionado</strong>
                    <span>El mapa seleccionó este colegio, pero no se encontró un establecimiento activo con ese mismo nombre en Supabase. Para mostrar mesas, participación y resultados, hay que vincular este polígono con el registro del colegio.</span>
                  </div>
                ) : <div className="e27-empty-state"><strong>{colegiosPublicos.length ? 'Seleccioná un colegio' : 'No hay colegios disponibles'}</strong><span>Podés seleccionar un polígono del mapa o elegir un establecimiento en la lista para consultar cantidad y números de mesas, participación y resultados por partido.</span></div>}
                {errorDatosPublicos && <div className="e27-public-data-warning">{errorDatosPublicos}</div>}
              </aside>
            </div>
          ) : vista === 'participacion' ? (
            <div className="e27-public-split e27-participation-layout">
              <section className="e27-panel e27-public-map-panel">
                <div className="e27-panel-heading"><div><span className="e27-kicker">MAPA DE PARTICIPACIÓN · {circuitoSeleccionado ? `CIRCUITO ${circuitoSeleccionado}` : 'TOTAL MUNICIPAL'}</span><h2>{circuitoSeleccionado ? `Participación del circuito ${circuitoSeleccionado}` : 'Participación total en La Matanza'}</h2><p>La intensidad del verde representa el porcentaje de votantes registrado y publicado en cada circuito.</p></div><span className="e27-map-label">VERDE = PARTICIPACIÓN</span></div>
                <div className="e27-map-wrap e27-map-wrap-participation"><MapaCircuitos
                    data={circuitosGeo}
                    valores={participacionCircuitos}
                    modo="participacion"
                    selectedCircuit={circuitoSeleccionado}
                    onSeleccionarCircuito={seleccionarCircuito}
                  /></div>
                <div className="e27-legend"><span>0%</span><div className="e27-gradient green-gradient" /><span>100%</span></div>
              </section>
              <aside className="e27-panel e27-public-summary-panel">
                <span className="e27-kicker">SEGUIMIENTO DE PARTICIPACIÓN</span>
                <h2>{circuitoSeleccionado ? 'Consultar por circuito' : 'Participación total'}</h2>
                <label className="e27-public-filter">Ver participación
                  <select value={circuitoSeleccionado} onChange={(e) => seleccionarCircuito(e.target.value)}>
                    <option value="">Participación total</option>
                    {CIRCUITOS_ELECTORALES.map((codigo) => <option key={codigo} value={codigo}>Circuito {codigo}</option>)}
                  </select>
                </label>
                {circuitoSeleccionado ? (
                  <>
                    <div className="e27-selected-school"><strong>Circuito {circuitoSeleccionado}</strong><span>{colegiosDelCircuito.length} establecimientos activos</span></div>
                    <div className="e27-big-turnout"><strong>{habilitadosCircuito ? `${porcentajeCircuitoSeleccionado.toFixed(1)}%` : '—'}</strong><span>de participación del circuito</span></div>
                    <div className="e27-progress-track"><span style={{ width: `${porcentajeCircuitoSeleccionado}%` }} /></div>
                    <div className="e27-public-mini-stats">
                      <article><small>MESAS TOTALES</small><strong>{numeroAR(mesasDelCircuito.length)}</strong></article>
                      <article><small>MESAS CON PARTICIPACIÓN</small><strong>{numeroAR(mesasCircuitoConParticipacion)}</strong></article>
                      <article><small>VOTANTES REGISTRADOS</small><strong>{numeroAR(votantesCircuito)}</strong></article>
                      <article><small>ELECTORES HABILITADOS</small><strong>{numeroAR(habilitadosCircuito)}</strong></article>
                    </div>
                    <div className="e27-circuit-schools-list">
                      <div className="e27-party-results-heading"><div><span className="e27-kicker">DESGLOSE DEL CIRCUITO</span><h3>Mesas por establecimiento</h3></div></div>
                      {colegiosDelCircuito.map((colegio) => {
                        const mesasColegio = mesasDelCircuito.filter((mesa) => mesa.colegio_id === colegio.id);
                        const cargadas = mesasColegio.filter((mesa) => participacionPublicaPorMesa.has(mesa.id)).length;
                        return <article key={colegio.id}><strong>{colegio.nombre}</strong><span>{cargadas} de {mesasColegio.length} mesas con participación publicada</span></article>;
                      })}
                      {!colegiosDelCircuito.length && <div className="e27-empty-state"><strong>No hay establecimientos configurados para este circuito</strong><span>Se mostrarán aquí cuando existan colegios y mesas activos en Supabase.</span></div>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="e27-selected-school"><strong>La Matanza · Total municipal</strong><span>{numeroAR(circuitosActivosMunicipio)} circuitos con establecimientos activos</span></div>
                    <div className="e27-big-turnout"><strong>{habilitadosMunicipio ? `${porcentajeMunicipio.toFixed(1)}%` : '—'}</strong><span>de participación sobre el padrón habilitado</span></div>
                    <div className="e27-progress-track"><span style={{ width: `${porcentajeMunicipio}%` }} /></div>
                    <div className="e27-public-mini-stats">
                      <article><small>ESTABLECIMIENTOS ACTIVOS</small><strong>{numeroAR(colegiosPublicos.length)}</strong></article>
                      <article><small>MESAS ACTIVAS</small><strong>{numeroAR(mesasActivasMunicipio.length)}</strong></article>
                      <article><small>MESAS CON PARTICIPACIÓN</small><strong>{numeroAR(mesasMunicipioConParticipacion)}</strong></article>
                      <article><small>ELECTORES HABILITADOS</small><strong>{numeroAR(habilitadosMunicipio)}</strong></article>
                    </div>
                    <div className="e27-map-caption">{numeroAR(votantesMunicipio)} votantes registrados en el total de mesas con participación publicada.</div>
                  </>
                )}
                {errorDatosPublicos && <div className="e27-public-data-warning">{errorDatosPublicos}</div>}
                {cargandoDatos && <div className="e27-map-caption">Actualizando datos publicados…</div>}
              </aside>
            </div>
          ) : (
            <div className="e27-public-split e27-circuit-results-layout">
              <section className="e27-panel e27-public-map-panel e27-circuit-results-map-panel">
               
<div className="e27-panel-heading e27-circuit-map-heading">
  <div>
    <span className="e27-kicker">MAPA DE RESULTADOS · 25 CIRCUITOS</span>
    <h2>Resultados territoriales</h2>
    <p>Vista general de todos los circuitos. Elegí uno para consultar su detalle y resaltar su ubicación en el mapa.</p>
  </div>

  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
    flexShrink: 0
  }}>
    <span className="e27-map-label">
      BORDE DORADO = SELECCIÓN
    </span>

    <div style={{
      background: '#ffffff',
      border: '1px solid #b8ddeb',
      borderRadius: '14px',
      padding: '12px 16px',
      minWidth: '145px',
      boxShadow: '0 3px 10px rgba(20,70,100,0.08)',
      textAlign: 'center'
    }}>
      <span style={{
        display: 'block',
        fontSize: '10px',
        fontWeight: 800,
        color: '#087f9f',
        letterSpacing: '1px'
      }}>
        MESAS CERRADAS
      </span>

      <strong style={{
        display: 'block',
        fontSize: '30px',
        lineHeight: 1.2,
        color: '#087f9f'
      }}>
        {porcentajeMesasCerradasMunicipio.toFixed(1)}%
      </strong>

      <small style={{
        color: '#526b7e',
        fontSize: '11px'
      }}>
        {numeroAR(mesasMunicipioConEscrutinio)} de {numeroAR(mesasActivasMunicipio.length)} mesas
      </small>
    </div>
  </div>
</div>

                <div className="e27-map-wrap e27-map-wrap-circuit-results">
                  <MapaCircuitos
                    data={circuitosGeo}
                    valores={resultadosCircuitos}
                    modo="resultados"
                    selectedCircuit={circuitoResultadoSeleccionado}
                    onSeleccionarCircuito={seleccionarCircuito}
                  />
                </div>
                <div className="e27-party-legend">
                  {partidos.map((partido) => <span key={partido.id}><i style={{ background: partido.color }} />{partido.nombre}</span>)}
                </div>
                {!Object.keys(resultadosCircuitos).length && <div className="e27-map-caption">Todavía no hay escrutinios publicados. Al aprobarse las cargas, los circuitos se colorearán según los votos de cada partido.</div>}
                {errorDatosPublicos && <div className="e27-public-data-warning">{errorDatosPublicos}</div>}
              </section>

              <aside className={`e27-panel e27-public-summary-panel e27-circuit-results-summary ${circuitoResultadoSeleccionado ? 'has-selected-circuit' : 'has-all-circuits'}`}>
                <span className="e27-kicker">CONSULTA DE RESULTADOS TERRITORIALES</span>
                <h2>{circuitoResultadoSeleccionado ? `Información del circuito ${circuitoResultadoSeleccionado}` : 'Resumen municipal · Todos los circuitos'}</h2>
                <label className="e27-public-filter">Seleccionar circuito electoral
                  <select
                    value={circuitoResultadoSeleccionado}
                    onChange={(e) => seleccionarCircuito(e.target.value)}
                  >
                    <option value="">Todos los circuitos · Total municipal</option>
                    {CIRCUITOS_ELECTORALES.map((codigo) => <option key={codigo} value={codigo}>Circuito {codigo}</option>)}
                  </select>
                </label>

                {circuitoResultadoSeleccionado ? (
                  <>
                    <div className="e27-selected-school">
                      <strong>Circuito {circuitoResultadoSeleccionado}</strong>
                      <span>{numeroAR(colegiosCircuitoResultados.length)} establecimientos activos</span>
                    </div>

                    <div className="e27-circuit-vote-total">
                      <span>SUMA TOTAL DE VOTOS ESCRUTADOS</span>
                      <strong>{numeroAR(totalVotosEscrutadosCircuito)}</strong>
                      <small>Partidos + votos en blanco + votos nulos</small>
                    </div>

                    <div className="e27-party-results-heading e27-circuit-party-heading">
                      <div><span className="e27-kicker">ESCRUTINIO PUBLICADO</span><h3>Distribución de votos escrutados</h3></div>
                      <small>{numeroAR(totalVotosEscrutadosCircuito)} votos escrutados</small>
                    </div>
                    {resultadosVotosCircuito.length ? (
                      <div className="e27-party-results-list">
                        {resultadosVotosCircuito.map((item) => {
                          const porcentaje = totalVotosEscrutadosCircuito > 0
                            ? item.votos / totalVotosEscrutadosCircuito * 100
                            : 0;
                          return (
                            <article className="e27-party-result" key={item.key}>
                              <div className="e27-party-result-line">
                                <span><i style={{ background: item.color }} />{item.nombre}</span>
                                <strong>{porcentaje.toFixed(1)}%</strong>
                              </div>
                              <div className="e27-party-result-track"><span style={{ width: `${Math.min(100, porcentaje)}%`, background: item.color }} /></div>
                              <small>{numeroAR(item.votos)} votos</small>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="e27-empty-state e27-circuit-empty-results">
                        <strong>No hay escrutinios publicados en este circuito</strong>
                        <span>Los resultados aparecerán cuando se aprueben los escrutinios de sus mesas.</span>
                      </div>
                    )}

                    <div className="e27-circuit-turnout-block">
                      <div className="e27-circuit-turnout-number">
                        <strong>{habilitadosCircuitoResultado > 0 ? `${Math.round(porcentajeParticipacionCircuitoResultado)}%` : '—'}</strong>
                        <span>participación sobre electores habilitados</span>
                      </div>
                      <div className="e27-progress-track"><span style={{ width: `${porcentajeParticipacionCircuitoResultado}%` }} /></div>
                      <div className="e27-circuit-turnout-caption">
                        <b>{numeroAR(votantesCircuitoResultado)} personas votaron</b>
                        <span>de {numeroAR(habilitadosCircuitoResultado)} electores habilitados</span>
                      </div>
                    </div>

                    <div className="e27-public-mini-stats e27-circuit-result-stats">
                      <article><small>MESAS CONFIGURADAS</small><strong>{numeroAR(mesasCircuitoResultados.length)}</strong></article>
                      <article><small>MESAS CON ESCRUTINIO</small><strong>{numeroAR(mesasCircuitoConEscrutinio)}</strong></article>
                      <article><small>MESAS CON PARTICIPACIÓN</small><strong>{numeroAR(mesasCircuitoConParticipacionResultado)}</strong></article>
                      <article><small>ESTABLECIMIENTOS</small><strong>{numeroAR(colegiosCircuitoResultados.length)}</strong></article>
                    </div>

                    <div className="e27-selected-circuit-closure">
                      <div className="e27-closure-heading">
                        <div><span className="e27-kicker">CIERRE DE MESAS</span><h3>Avance del escrutinio</h3></div>
                        <strong>{mesasCircuitoResultados.length ? `${(mesasCircuitoConEscrutinio / mesasCircuitoResultados.length * 100).toFixed(1)}%` : '—'}</strong>
                      </div>
                      <div className="e27-progress-track e27-closure-total-track">
                        <span style={{ width: `${mesasCircuitoResultados.length ? (mesasCircuitoConEscrutinio / mesasCircuitoResultados.length * 100) : 0}%` }} />
                      </div>
                      <p>{numeroAR(mesasCircuitoConEscrutinio)} de {numeroAR(mesasCircuitoResultados.length)} mesas con escrutinio publicado.</p>
                    </div>


                  </>
                ) : (
                  <div className="e27-all-circuits-dashboard">
                    <div className="e27-selected-school">
                      <strong>La Matanza · Total municipal</strong>
                      <span>{numeroAR(circuitosActivosMunicipio)} circuitos con establecimientos activos · Vista consolidada</span>
                    </div>

                    <section className="e27-all-circuit-parties">
                      <div className="e27-party-results-heading e27-circuit-party-heading">
                        <div>
                          <span className="e27-kicker">ESCRUTINIO PUBLICADO</span>
                          <h3>Distribución de votos escrutados</h3>
                        </div>
                        <small>{numeroAR(totalVotosEscrutadosMunicipio)} votos escrutados</small>
                      </div>
                      {resultadosVotosMunicipio.length ? (
                        <div className="e27-party-results-list">
                          {resultadosVotosMunicipio.map((item) => {
                            const porcentaje = totalVotosEscrutadosMunicipio > 0
                              ? (item.votos / totalVotosEscrutadosMunicipio) * 100
                              : 0;
                            return (
                              <article className="e27-party-result" key={item.key}>
                                <div className="e27-party-result-line">
                                  <span><i style={{ background: item.color }} />{item.nombre}</span>
                                  <strong>{porcentaje.toFixed(1)}%</strong>
                                </div>
                                <div className="e27-party-result-track">
                                  <span style={{ width: `${Math.min(100, porcentaje)}%`, background: item.color }} />
                                </div>
                                <small>{numeroAR(item.votos)} votos</small>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="e27-empty-state e27-circuit-empty-results">
                          <strong>No hay escrutinios publicados en el municipio</strong>
                          <span>Los resultados aparecerán cuando se aprueben los escrutinios de las mesas.</span>
                        </div>
                      )}
                    </section>

                    <section className="e27-all-circuit-turnout">
                      <span className="e27-kicker">PARTICIPACIÓN GENERAL</span>
                      <div className="e27-big-turnout">
                        <strong>{habilitadosMunicipio > 0 ? `${porcentajeMunicipio.toFixed(1)}%` : '—'}</strong>
                        <span>del padrón habilitado votó</span>
                      </div>
                      <div className="e27-progress-track">
                        <span style={{ width: `${porcentajeMunicipio}%` }} />
                      </div>
                      <div className="e27-all-circuit-turnout-caption">
                        <b>{numeroAR(votantesMunicipio)} votantes registrados</b>
                        <span>sobre {numeroAR(habilitadosMunicipio)} electores habilitados</span>
                      </div>
                    </section>

                    <div className="e27-public-mini-stats e27-all-circuit-stats">
                      <article><small>MESAS ACTIVAS</small><strong>{numeroAR(mesasActivasMunicipio.length)}</strong></article>
                      <article><small>MESAS CON PARTICIPACIÓN</small><strong>{numeroAR(mesasMunicipioConParticipacion)} / {numeroAR(mesasActivasMunicipio.length)}</strong></article>
                      <article><small>MESAS CERRADAS</small><strong>{numeroAR(mesasMunicipioConEscrutinio)} / {numeroAR(mesasActivasMunicipio.length)}</strong></article>
                      <article><small>ESTABLECIMIENTOS</small><strong>{numeroAR(colegiosPublicos.length)}</strong></article>
                    </div>

                    <section className="e27-closure-section">
                      <div className="e27-closure-heading">
                        <div>
                          <span className="e27-kicker">AVANCE DEL ESCRUTINIO</span>
                          <h3>Porcentaje de mesas cerradas</h3>
                        </div>
                        <strong>{porcentajeMesasCerradasMunicipio.toFixed(1)}%</strong>
                      </div>
                      <div className="e27-progress-track e27-closure-total-track">
                        <span style={{ width: `${porcentajeMesasCerradasMunicipio}%` }} />
                      </div>
                      <p>{numeroAR(mesasMunicipioConEscrutinio)} de {numeroAR(mesasActivasMunicipio.length)} mesas tienen escrutinio publicado y aprobado.</p>

                      <div className="e27-circuit-closure-grid">
                        {avanceCierrePorCircuito.map((item) => (
                          <article className="e27-circuit-closure-card" key={item.codigo}>
                            <div className="e27-circuit-closure-top">
                              <strong>Circuito {item.codigo}</strong>
                              <b>{item.porcentaje.toFixed(0)}%</b>
                            </div>
                            <div className="e27-circuit-closure-track" role="progressbar" aria-label={`Avance del circuito ${item.codigo}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.porcentaje)}>
                              <span style={{ width: `${Math.max(0, Math.min(100, item.porcentaje))}%` }} />
                            </div>
                            <div className="e27-circuit-closure-scale"><span>0</span><span>100</span></div>
                            <small>
                              {item.total
                                ? `${item.cerradas} de ${item.total} mesas cerradas`
                                : '0 de 0 mesas · Sin mesas configuradas'}
                            </small>
                          </article>
                        ))}
                      </div>
                    </section>


                  </div>
                )}
                {errorDatosPublicos && <div className="e27-public-data-warning">{errorDatosPublicos}</div>}
                {cargandoDatos && <div className="e27-map-caption">Actualizando información electoral publicada…</div>}
              </aside>
            </div>
          )}
        </>
      ) : (
        <div className="e27-private">
          <div className="e27-private-heading">
            <div><span className="e27-kicker">PANEL DE GESTIÓN</span><h2>Hola, {perfil.nombre || 'Responsable de Escuela'}</h2></div>
            <span className="e27-role-chip">{perfil.rol === 'administrador_general' ? 'ADMINISTRADOR GENERAL' : 'RESPONSABLE DE ESCUELA'}</span>
          </div>

          {perfil.rol === 'administrador_general' ? (
            <div className="e27-admin-area">
              {seccionAdmin === 'inicio' ? (
                <>
                  <div className="e27-panel-heading"><div><span className="e27-kicker">ADMINISTRACIÓN CENTRAL</span><h2>Panel de gestión</h2><p>Elegí qué tarea querés realizar.</p></div></div>
                  <div className="e27-database-metrics" aria-label="Resumen de datos guardados en Supabase">
                    <article><small>COLEGIOS ACTIVOS</small><strong>{numeroAR(cantidadColegiosActivos)}</strong></article>
                    <article><small>COLEGIOS CON POLÍGONO KML</small><strong>{numeroAR(cantidadColegiosCartografiados)}</strong></article>
                    <article><small>MESAS ACTIVAS</small><strong>{numeroAR(cantidadMesasActivas)}</strong></article>
                  </div>
                  <nav className="e27-tabs e27-admin-nav" aria-label="Opciones de administración">
                    <button className="e27-tab" onClick={() => setSeccionAdmin('responsables')}><span>♙</span><div><strong>Alta de responsables de escuela</strong><small>Registrar responsables y asignar establecimientos</small></div></button>
                    <button className="e27-tab" onClick={() => setSeccionAdmin('usuarios')}><span>♧</span><div><strong>Administrar usuarios</strong><small>Consultar cuentas, cambiar contraseñas y ajustar mesas</small></div></button>
                    <button className="e27-tab" onClick={() => setSeccionAdmin('colegios')}><span>⌂</span><div><strong>Administrar colegios</strong><small>{numeroAR(cantidadColegiosActivos)} establecimientos activos · editar nombres</small></div></button>
                    <button className="e27-tab" onClick={() => setSeccionAdmin('partidos')}><span>◈</span><div><strong>Alta de partidos políticos</strong><small>Configurar nombre, sigla y color identificatorio</small></div></button>
                    <button className="e27-tab" onClick={() => { setSeccionAdmin('escrutinio'); setPestanaEscrutinio('carga'); }}><span>▤</span><div><strong>Registro de escrutinio</strong><small>Cargar, revisar, aprobar y consultar el avance</small></div></button>
                  </nav>
                </>
              ) : (
                <>
                  <div className="e27-panel-heading"><div><span className="e27-kicker">ADMINISTRACIÓN CENTRAL</span><h2>{seccionAdmin === 'responsables' ? 'Alta de responsables de escuela' : seccionAdmin === 'usuarios' ? 'Administrar usuarios' : seccionAdmin === 'colegios' ? 'Administrar colegios' : seccionAdmin === 'partidos' ? 'Alta de partidos políticos' : 'Registro de escrutinio'}</h2><p>{seccionAdmin === 'responsables' ? 'Creá cuentas, definí una contraseña inicial y asigná establecimientos.' : seccionAdmin === 'usuarios' ? 'Consultá las cuentas creadas, modificá sus contraseñas y ajustá las mesas de cada establecimiento asignado.' : seccionAdmin === 'colegios' ? 'Revisá los establecimientos registrados y corregí su nombre visible sin alterar su circuito ni sus mesas.' : seccionAdmin === 'partidos' ? 'Configuración de los partidos que participarán en el escrutinio.' : 'Gestión de la carga, revisión y publicación de resultados.'}</p></div><button type="button" className="e27-white-button e27-white-button-outline" onClick={() => setSeccionAdmin('inicio')}>← Volver al menú</button></div>
                  {mensaje && <div className="e27-feedback">{mensaje}</div>}
                  {seccionAdmin === 'colegios' && (
                    <section className="e27-panel e27-college-admin-panel">
                      <div className="e27-college-admin-intro">
                        <div>
                          <span className="e27-kicker">DIRECTORIO DE ESTABLECIMIENTOS</span>
                          <h3>Colegios registrados</h3>
                          <p>Administrá el nombre, la numeración oficial de mesas y la asignación de responsables. El circuito y el identificador cartográfico se conservan.</p>
                        </div>
                        <div className="e27-college-admin-count"><strong>{cantidadColegiosActivos || colegios.length}</strong><span>establecimientos activos en Supabase</span></div>
                      </div>
                      {colegios.length === 0 ? (
                        <div className="e27-empty-state"><strong>No hay colegios activos para administrar</strong><span>Revisá que los establecimientos estén cargados y activos en Supabase.</span></div>
                      ) : (
                        <div className="e27-college-admin-list">
                          {colegios.map((colegio) => (
                            <article className="e27-college-admin-row" key={colegio.id}>
                              <div className="e27-college-admin-meta">
                                <span className="e27-college-admin-icon">⌂</span>
                                <div>
                                  <small>ESTABLECIMIENTO</small>
                                  <strong>{colegio.nombre}</strong>
                                  <span>Circuito {colegio.circuito || '—'}</span>
                                  <span>{mesas.filter((mesa) => mesa.colegio_id === colegio.id).length} mesas activas · {mesas.filter((mesa) => mesa.colegio_id === colegio.id).map((mesa) => mesa.numero).sort((a, b) => a - b).join(', ') || 'Sin mesas cargadas'}</span>
                                </div>
                              </div>
                              {colegioEditandoId === colegio.id ? (
                                <form className="e27-college-edit-form" onSubmit={guardarNombreColegio}>
                                  <label>Nuevo nombre del colegio
                                    <input
                                      autoFocus
                                      value={colegioNombreEditado}
                                      onChange={(e) => setColegioNombreEditado(e.target.value)}
                                      maxLength={180}
                                      placeholder="Ingresá el nombre correcto"
                                      required
                                    />
                                  </label>
                                  <div className="e27-college-edit-actions">
                                    <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => { setColegioEditandoId(null); setColegioNombreEditado(''); setMensaje(''); }} disabled={guardandoColegio === colegio.id}>Cancelar</button>
                                    <button type="submit" className="e27-white-button" disabled={guardandoColegio === colegio.id || !colegioNombreEditado.trim()}>{guardandoColegio === colegio.id ? 'Guardando…' : 'Guardar nombre'}</button>
                                  </div>
                                </form>
                              ) : (
                                <button type="button" className="e27-white-button e27-college-edit-button" onClick={() => { setColegioEditandoId(colegio.id); setColegioNombreEditado(colegio.nombre); setMensaje(''); }}>
                                  ✎ Editar nombre
                                </button>
                              )}
                              <div className="e27-college-edit-actions">
                                <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => iniciarEdicionMesasColegio(colegio.id)}>
                                  {colegioMesasEditandoId === colegio.id ? 'Actualizar mesas' : 'Editar mesas'}
                                </button>
                              </div>
                              {colegioMesasEditandoId === colegio.id && (
                                <div className="e27-mesas-config">
                                  <strong>Numeración de mesas</strong>
                                  {(configuracionMesasColegio[colegio.id] ?? []).map((mesa, indice) => (
                                    <div className="e27-mesa-config-card" key={mesa.id ?? indice}>
                                      <label>Mesa {indice + 1}
                                        <input type="number" min="1" max="100000" value={mesa.numero}
                                          onChange={(e) => setConfiguracionMesasColegio((old) => ({
                                            ...old,
                                            [colegio.id]: (old[colegio.id] ?? []).map((item, i) => i === indice ? { ...item, numero: e.target.value } : item),
                                          }))} />
                                      </label>
                                      <button type="button" className="e27-white-button e27-white-button-outline"
                                        onClick={() => setConfiguracionMesasColegio((old) => ({ ...old, [colegio.id]: (old[colegio.id] ?? []).filter((_, i) => i !== indice) }))}>Quitar</button>
                                    </div>
                                  ))}
                                  <div className="e27-college-edit-actions">
                                    <button type="button" className="e27-white-button e27-white-button-outline"
                                      onClick={() => setConfiguracionMesasColegio((old) => ({ ...old, [colegio.id]: [...(old[colegio.id] ?? []), { id: null, numero: String(Math.max(0, ...(old[colegio.id] ?? []).map((m) => Number(m.numero) || 0)) + 1), reportes_total: 0 }] }))}>+ Agregar mesa</button>
                                    <button type="button" className="e27-white-button"
                                      disabled={guardandoConfiguracionColegio === colegio.id}
                                      onClick={() => guardarConfiguracionColegioAdmin(colegio)}>
                                      {guardandoConfiguracionColegio === colegio.id ? 'Guardando…' : 'Guardar mesas'}
                                    </button>
                                    <button type="button" className="e27-white-button e27-white-button-outline"
                                      onClick={() => setColegioMesasEditandoId(null)}>Cancelar</button>
                                  </div>
                                </div>
                              )}
                              <div className="e27-college-edit-actions">
                                <select value={responsableAsignarPorColegio[colegio.id] ?? ''}
                                  onChange={(e) => setResponsableAsignarPorColegio((old) => ({ ...old, [colegio.id]: e.target.value }))}>
                                  <option value="">Asignar a responsable…</option>
                                  {usuariosAdmin.filter((u) => u.activo).map((u) => <option key={u.user_id} value={u.user_id}>{u.nombre} · {u.email}</option>)}
                                </select>
                                <button type="button" className="e27-white-button"
                                  disabled={guardandoConfiguracionColegio === colegio.id || !responsableAsignarPorColegio[colegio.id]}
                                  onClick={() => asignarColegioDesdeAdmin(colegio.id)}>Asignar colegio</button>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                      <p className="e27-college-admin-note">El identificador_kml que vincula el establecimiento con su polígono cartográfico se conserva aunque cambies el nombre visible. Cambiar el nombre visible no modifica responsables, circuito, mesas, electores ni reportes.</p>
                    </section>
                  )}
                  {seccionAdmin === 'responsables' && (
                    <section className="e27-panel e27-responsable-admin-panel">
                      <span className="e27-kicker">NUEVO RESPONSABLE</span>
                      <form className="e27-capture-form e27-responsable-admin-form" onSubmit={crearResponsableEnSupabase}>
                        <div className="e27-responsable-admin-fields">
                          <label>Nombre y apellido<input value={responsableNombre} onChange={(e) => { setResponsableNombre(e.target.value); }} placeholder="Nombre completo" autoComplete="name" required /></label>
                          <label>Correo electrónico<input type="email" value={responsableEmail} onChange={(e) => { setResponsableEmail(e.target.value); }} placeholder="responsable@correo.com" autoComplete="email" required /></label>
                          <label>Contraseña inicial<input type="password" value={responsablePassword} onChange={(e) => setResponsablePassword(e.target.value)} placeholder="Mínimo 12 caracteres" autoComplete="new-password" minLength={12} required /><small className="e27-admin-field-help">La definís vos y se entrega al responsable por un canal privado.</small></label>
                          <label>Confirmar contraseña<input type="password" value={confirmarResponsablePassword} onChange={(e) => setConfirmarResponsablePassword(e.target.value)} placeholder="Repetir contraseña" autoComplete="new-password" minLength={12} required /></label>
                          <label className="e27-responsable-admin-school">Establecimiento
                            <select value={responsableColegio} onChange={(e) => { setResponsableColegio(e.target.value); }} required>
                              <option value="">Seleccionar colegio</option>
                              {colegios.map((c) => <option key={c.id} value={c.id}>{c.nombre} · Circuito {c.circuito || '—'}</option>)}
                            </select>
                          </label>
                        </div>

                        <section className="e27-mesas-config" aria-label="Configuración de mesas del establecimiento">
                          <div className="e27-mesas-config-heading">
                            <div>
                              <span className="e27-kicker">CONFIGURACIÓN DEL ESTABLECIMIENTO</span>
                              <h3>Mesas electorales</h3>
                              <p>Indicá cuántas mesas tiene el colegio y completá el número real de cada una. El responsable cargará luego los electores habilitados de su mesa.</p>
                            </div>
                            <label className="e27-mesas-count">Cantidad de mesas
                              <input type="number" min="1" max="100" step="1" value={responsableCantidadMesas} onChange={(e) => cambiarCantidadMesasResponsable(e.target.value)} required />
                            </label>
                          </div>

                          {responsableMesasConfig.length > 0 ? (
                            <div className="e27-mesas-config-grid">
                              {responsableMesasConfig.map((mesa, indice) => (
                                <div className="e27-mesa-config-card" key={indice}>
                                  <span className="e27-mesa-config-index">MESA {indice + 1}</span>
                                  <label>Número de mesa
                                    <input type="number" min="1" step="1" value={mesa.numero} onChange={(e) => actualizarMesaResponsable(indice, 'numero', e.target.value)} required />
                                  </label>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="e27-mesas-config-empty">Ingresá una cantidad de mesas entre 1 y 100 para generar los campos de configuración.</div>
                          )}
                        </section>

                        <p className="e27-responsable-admin-note">El responsable verá solamente las mesas de este establecimiento. Desde su cuenta podrá informar y guardar los electores habilitados reales de cada mesa; esa cantidad puede variar entre mesas. La cuenta, el perfil, la asignación y las mesas se guardarán desde una función segura de Supabase.</p>
                        <button className="e27-white-button e27-responsable-preview-button" type="submit" disabled={guardandoAltaResponsable}>{guardandoAltaResponsable ? 'Creando cuenta y mesas…' : 'Crear cuenta y guardar asignación'}</button>
                      </form>

                      {cuentaCreadaEmail && (
                        <div className="e27-user-success" role="status">
                          <strong>Cuenta creada correctamente</strong>
                          <span>{cuentaCreadaEmail}</span>
                          <small>La contraseña inicial quedó configurada. Por seguridad, no se vuelve a mostrar en pantalla.</small>
                        </div>
                      )}
                      <div className="e27-empty-state"><strong>Alta conectada con Supabase</strong><span>Al crear cada responsable se registra su cuenta, perfil, establecimiento y números de mesa. Los electores habilitados los completa el responsable desde su acceso.</span></div>
                    </section>
                  )}
                  {seccionAdmin === 'usuarios' && (
                    <section className="e27-panel e27-users-admin-panel">
                      <div className="e27-users-panel-heading">
                        <div><span className="e27-kicker">CUENTAS REGISTRADAS</span><h3>Responsables de escuela</h3><p>Desde acá podés restablecer contraseñas y modificar la cantidad de mesas activas del colegio asignado. Los cambios de mesas afectan a todos los responsables vinculados a ese establecimiento.</p></div>
                        <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => void cargarUsuariosAdmin()} disabled={cargandoUsuariosAdmin}>{cargandoUsuariosAdmin ? 'Actualizando…' : '↻ Actualizar listado'}</button>
                      </div>
                      {cargandoUsuariosAdmin ? (
                        <div className="e27-empty-state"><strong>Cargando usuarios…</strong><span>Consultando las cuentas y asignaciones registradas en Supabase.</span></div>
                      ) : usuariosAdmin.length === 0 ? (
                        <div className="e27-empty-state"><strong>No hay responsables registrados</strong><span>Cuando crees una cuenta desde “Alta de responsables de escuela”, aparecerá en este listado.</span></div>
                      ) : (
                        <div className="e27-users-list">
                          {usuariosAdmin.map((usuario) => (
                            <article className="e27-user-card" key={usuario.user_id}>
                              <div className="e27-user-card-top">
                                <div className="e27-user-avatar" aria-hidden="true">{(usuario.nombre || usuario.email || 'U').trim().slice(0, 1).toUpperCase()}</div>
                                <div className="e27-user-identity">
                                  <strong>{usuario.nombre || 'Sin nombre'}</strong>
                                  <span className="e27-user-email">{usuario.email}</span>
                                  <small>{usuario.creado_en ? `${usuario.activo ? 'Activo desde' : 'Alta'}: ${new Date(usuario.creado_en).toLocaleDateString('es-AR')}` : 'Fecha de alta no disponible'}</small>
                                </div>
                                <span className={`e27-user-status ${usuario.activo ? 'is-active' : 'is-inactive'}`}>{usuario.activo ? 'Activo' : 'Inactivo'}</span>
                              </div>
                              <div className="e27-user-actions-row">
                                <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => { setUsuarioPasswordEditando(usuarioPasswordEditando === usuario.user_id ? null : usuario.user_id); setNuevaPasswordUsuario(''); setConfirmarNuevaPasswordUsuario(''); setMensaje(''); }}>♧ Cambiar contraseña</button>
                                <button
                                  type="button"
                                  className="e27-white-button e27-danger-button"
                                  onClick={() => {
                                    setUsuarioEliminarConfirmando(usuarioEliminarConfirmando === usuario.user_id ? null : usuario.user_id);
                                    setConfirmacionEliminarUsuario('');
                                    setMensaje('');
                                  }}
                                >Eliminar responsable</button>
                              </div>
                              {usuarioEliminarConfirmando === usuario.user_id && (
                                <div className="e27-delete-confirm-panel">
                                  <strong>Eliminar definitivamente a {usuario.nombre || usuario.email}</strong>
                                  <p>Se borrará su cuenta de acceso y sus reportes de participación y escrutinio. Los colegios y las mesas no se eliminan. Los reportes cargados por otras personas se conservan.</p>
                                  <p>Esta acción no se puede deshacer. Para confirmar, escribí <b>ELIMINAR CUENTA</b>.</p>
                                  <label>Confirmación
                                    <input
                                      value={confirmacionEliminarUsuario}
                                      onChange={(e) => setConfirmacionEliminarUsuario(e.target.value)}
                                      autoComplete="off"
                                      placeholder="ELIMINAR CUENTA"
                                    />
                                  </label>
                                  <div className="e27-delete-confirm-actions">
                                    <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => { setUsuarioEliminarConfirmando(null); setConfirmacionEliminarUsuario(''); }}>Cancelar</button>
                                    <button type="button" className="e27-white-button e27-danger-button" disabled={confirmacionEliminarUsuario !== 'ELIMINAR CUENTA' || eliminandoElemento === usuario.user_id} onClick={() => void eliminarResponsable(usuario.user_id)}>{eliminandoElemento === usuario.user_id ? 'Eliminando…' : 'Confirmar eliminación'}</button>
                                  </div>
                                </div>
                              )}
                              {usuarioPasswordEditando === usuario.user_id && (
                                <form className="e27-user-edit-form" onSubmit={(e) => { e.preventDefault(); void guardarPasswordUsuario(usuario.user_id); }}>
                                  <div className="e27-user-edit-grid">
                                    <label>Nueva contraseña<input type="password" value={nuevaPasswordUsuario} onChange={(e) => setNuevaPasswordUsuario(e.target.value)} minLength={12} autoComplete="new-password" placeholder="Mínimo 12 caracteres" required /></label>
                                    <label>Confirmar contraseña<input type="password" value={confirmarNuevaPasswordUsuario} onChange={(e) => setConfirmarNuevaPasswordUsuario(e.target.value)} minLength={12} autoComplete="new-password" placeholder="Repetir contraseña" required /></label>
                                  </div>
                                  <div className="e27-user-edit-buttons"><button type="button" className="e27-white-button e27-white-button-outline" onClick={() => { setUsuarioPasswordEditando(null); setNuevaPasswordUsuario(''); setConfirmarNuevaPasswordUsuario(''); }}>Cancelar</button><button type="submit" className="e27-white-button" disabled={guardandoPasswordUsuario === usuario.user_id}>{guardandoPasswordUsuario === usuario.user_id ? 'Actualizando…' : 'Guardar nueva contraseña'}</button></div>
                                </form>
                              )}
                              <div className="e27-user-schools">
                                {usuario.colegios.map((colegio) => {
                                  const key = `${usuario.user_id}:${colegio.colegio_id}`;
                                  return (
                                    <div className="e27-user-school-row" key={colegio.colegio_id}>
                                      <div className="e27-user-school-copy">
                                        <small>Colegio asignado</small>
                                        <strong>{colegio.nombre}</strong>
                                        <span className={`e27-user-school-status ${colegio.activo ? 'is-active' : 'is-inactive'}`}>{colegio.activo ? 'Colegio activo' : 'Colegio inactivo'}</span>
                                        <span className="e27-user-circuit">Circuito {colegio.circuito || '—'}</span>
                                        <span className="e27-user-mesas-summary">{colegio.cantidad_mesas} {colegio.cantidad_mesas === 1 ? 'mesa activa' : 'mesas activas'}{colegio.numeros_mesas.length ? ` · N.º ${colegio.numeros_mesas.join(', ')}` : ''}</span>
                                      </div>
                                      <div className="e27-assignment-actions">
                                        <button
                                          type="button"
                                          className="e27-white-button e27-danger-button e27-white-button-outline"
                                          onClick={() => setAsignacionEliminarConfirmando(asignacionEliminarConfirmando === key ? null : key)}
                                        >Quitar colegio de esta cuenta</button>
                                      </div>
                                      {asignacionEliminarConfirmando === key && (
                                        <div className="e27-delete-confirm-panel e27-assignment-confirm-panel">
                                          <strong>Quitar asignación de {colegio.nombre}</strong>
                                          <p>La persona dejará de tener este colegio asignado. El colegio, sus mesas y todos sus reportes permanecen en el Observatorio. Esta acción no elimina datos electorales.</p>
                                          <div className="e27-delete-confirm-actions">
                                            <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => setAsignacionEliminarConfirmando(null)}>Cancelar</button>
                                            <button type="button" className="e27-white-button e27-danger-button" disabled={eliminandoElemento === key} onClick={() => void quitarAsignacionColegio(usuario.user_id, colegio.colegio_id)}>{eliminandoElemento === key ? 'Quitando…' : 'Confirmar y quitar'}</button>
                                          </div>
                                        </div>
                                      )}
                                      {usuarioMesasEditando === key ? (
                                        <form className="e27-user-mesas-form e27-user-mesas-config-form" onSubmit={(e) => { e.preventDefault(); void guardarConfiguracionMesasDeUsuario(usuario.user_id, colegio.colegio_id); }}>
                                          <div className="e27-user-mesas-form-heading">
                                            <strong>Configuración de mesas</strong>
                                            <span>Podés cambiar el número, agregar o quitar mesas. Las que tengan reportes asociados no se pueden quitar, pero sí renumerar.</span>
                                          </div>
                                          <div className="e27-user-mesas-editor-list">
                                            {(configuracionMesasUsuario[key] ?? []).map((mesa, index) => (
                                              <div className="e27-user-mesa-editor" key={mesa.id || `nueva-${index}`}>
                                                <label>
                                                  Número de mesa
                                                  <input
                                                    type="number"
                                                    min="1"
                                                    max="100000"
                                                    step="1"
                                                    inputMode="numeric"
                                                    value={mesa.numero}
                                                    onChange={(e) => setConfiguracionMesasUsuario((old) => ({
                                                      ...old,
                                                      [key]: (old[key] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, numero: e.target.value } : item),
                                                    }))}
                                                    required
                                                  />
                                                </label>
                                                <span>
                                                  {mesa.reportes_total > 0
                                                    ? `Con historial: ${mesa.reportes_total} reporte(s). Se puede renumerar, no quitar.`
                                                    : mesa.id ? 'Existente · sin reportes' : 'Mesa nueva'}
                                                </span>
                                                {mesa.id ? (
                                                  <button
                                                    type="button"
                                                    className="e27-white-button e27-danger-button e27-remove-mesa-button"
                                                    onClick={() => {
                                                      setMesaEliminarConfirmando(mesaEliminarConfirmando === mesa.id ? null : mesa.id);
                                                      setConfirmacionEliminarMesa('');
                                                    }}
                                                  >Eliminar</button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="e27-white-button e27-white-button-outline e27-remove-mesa-button"
                                                    onClick={() => setConfiguracionMesasUsuario((old) => ({
                                                      ...old,
                                                      [key]: (old[key] ?? []).filter((_, itemIndex) => itemIndex !== index),
                                                    }))}
                                                    aria-label={`Quitar mesa nueva ${mesa.numero}`}
                                                  >Quitar</button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                          {mesaEliminarConfirmando && (configuracionMesasUsuario[key] ?? []).some((item) => item.id === mesaEliminarConfirmando) && (
                                            <div className="e27-delete-confirm-panel e27-mesa-delete-confirm">
                                              <strong>Eliminar definitivamente la Mesa {(configuracionMesasUsuario[key] ?? []).find((item) => item.id === mesaEliminarConfirmando)?.numero}</strong>
                                              <p>Se eliminarán la mesa y sus reportes de participación y escrutinio, incluidos los votos y las franjas horarias asociados. Esto afecta a todas las personas asignadas al colegio. El historial general de auditoría se conserva.</p>
                                              <p>Escribí <b>ELIMINAR MESA Y SUS REPORTES</b> para confirmar.</p>
                                              <label>Confirmación
                                                <input value={confirmacionEliminarMesa} onChange={(e) => setConfirmacionEliminarMesa(e.target.value)} placeholder="ELIMINAR MESA Y SUS REPORTES" autoComplete="off" />
                                              </label>
                                              <div className="e27-delete-confirm-actions">
                                                <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => { setMesaEliminarConfirmando(null); setConfirmacionEliminarMesa(''); }}>Cancelar</button>
                                                <button type="button" className="e27-white-button e27-danger-button" disabled={confirmacionEliminarMesa !== 'ELIMINAR MESA Y SUS REPORTES' || eliminandoElemento === mesaEliminarConfirmando} onClick={() => void eliminarMesaDePrueba(mesaEliminarConfirmando)}>{eliminandoElemento === mesaEliminarConfirmando ? 'Eliminando…' : 'Confirmar eliminación'}</button>
                                              </div>
                                            </div>
                                          )}
                                          <button
                                            type="button"
                                            className="e27-white-button e27-white-button-outline e27-add-mesa-button"
                                            disabled={(configuracionMesasUsuario[key] ?? []).length >= 100}
                                            onClick={() => setConfiguracionMesasUsuario((old) => {
                                              const actual = old[key] ?? [];
                                              const maximo = actual.reduce((max, item) => Math.max(max, Number(item.numero) || 0), 0);
                                              return { ...old, [key]: [...actual, { id: null, numero: String(maximo + 1), reportes_total: 0 }] };
                                            })}
                                          >+ Agregar mesa</button>
                                          <div className="e27-user-mesas-form-actions">
                                            <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => setUsuarioMesasEditando(null)}>Cancelar</button>
                                            <button type="submit" className="e27-white-button" disabled={guardandoMesasUsuario === key || !(configuracionMesasUsuario[key] ?? []).length}>{guardandoMesasUsuario === key ? 'Guardando…' : 'Guardar configuración'}</button>
                                          </div>
                                        </form>
                                      ) : (
                                        <button
                                          type="button"
                                          className="e27-white-button e27-white-button-outline"
                                          onClick={() => {
                                            setUsuarioMesasEditando(key);
                                            setConfiguracionMesasUsuario((old) => ({
                                              ...old,
                                              [key]: colegio.mesas.map((mesa) => ({ id: mesa.id, numero: String(mesa.numero), reportes_total: mesa.reportes_total })),
                                            }));
                                          }}
                                        >✎ Editar mesas y numeración</button>
                                      )}
                                    </div>
                                  );
                                })}
                                {!usuario.colegios.length && <div className="e27-empty-state"><strong>Sin colegio asignado</strong><span>Revisá la asignación de este usuario antes de habilitar su carga.</span></div>}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {seccionAdmin === 'partidos' && (
                    <section className="e27-panel"><span className="e27-kicker">NUEVO PARTIDO POLÍTICO</span>
                      <form className="e27-capture-form" onSubmit={guardarPartidoEnSupabase}>
                        <label>Nombre del partido<input value={partidoNombre} onChange={(e) => setPartidoNombre(e.target.value)} placeholder="Nombre completo" required /></label>
                        <label>Sigla<input value={partidoSigla} onChange={(e) => setPartidoSigla(e.target.value.toUpperCase())} placeholder="SIGLA" maxLength={12} required /></label>
                        <label>Color identificatorio<input type="color" value={partidoColor} onChange={(e) => setPartidoColor(e.target.value)} /></label>
                        <div className="e27-winner-line"><i style={{ background: partidoColor }} /><strong>{partidoNombre || 'Vista previa del partido'} {partidoSigla ? `· ${partidoSigla}` : ''}</strong></div>
                        <button className="e27-white-button" type="submit" disabled={guardandoPartido}>{guardandoPartido ? 'Guardando…' : 'Guardar partido en Supabase'}</button>
                      </form>
                      <div className="e27-party-list admin-party-list">{partidos.map((partido) => <div className="e27-party-row" key={partido.id}><i style={{ background: partido.color }} /><span>{partido.nombre}</span><small>{partido.sigla}</small></div>)}{!partidos.length && <div className="e27-empty-state"><strong>No hay partidos registrados</strong><span>Cuando agregues un partido, quedará guardado en Supabase y aparecerá en la carga de escrutinio.</span></div>}</div>
                    </section>
                  )}
                  {seccionAdmin === 'escrutinio' && (
                    <>
                      <nav className="e27-tabs" aria-label="Secciones del registro de escrutinio">
                        <button className={`e27-tab ${pestanaEscrutinio === 'carga' ? 'selected' : ''}`} onClick={() => setPestanaEscrutinio('carga')}><span>＋</span><div><strong>Carga de escrutinio</strong><small>Registro de resultados por mesa</small></div></button>
                        <button className={`e27-tab ${pestanaEscrutinio === 'pendientes' ? 'selected' : ''}`} onClick={() => { setPestanaEscrutinio('pendientes'); void cargarReportesAdmin(); }}><span>◷</span><div><strong>Reportes pendientes de aprobación</strong><small>Revisión de los reportes recibidos</small></div></button>
                        <button className={`e27-tab ${pestanaEscrutinio === 'publicados' ? 'selected' : ''}`} onClick={() => setPestanaEscrutinio('publicados')}><span>▥</span><div><strong>Resultados publicados</strong><small>Avance por escuela, circuito y municipio</small></div></button>
                      </nav>
                      {pestanaEscrutinio === 'carga' && <section className="e27-panel"><span className="e27-kicker">REGISTRO DE ESCRUTINIO</span><h3>Carga de escrutinio</h3><div className="e27-empty-state"><strong>Seleccioná una mesa para registrar sus resultados</strong><span>La carga administrativa se vinculará con los colegios y mesas ya configurados.</span></div><p>Los reportes enviados por responsables se revisan en la pestaña “Reportes pendientes de aprobación”. Solo los aprobados se consideran resultados publicados.</p></section>}
                      {pestanaEscrutinio === 'pendientes' && (
                        <section className="e27-panel">
                          <div className="e27-panel-heading"><div><span className="e27-kicker">CONTROL CENTRAL</span><h3>Reportes pendientes de aprobación</h3><p>Solo la administración central puede publicar información en el observatorio público.</p></div><button className="e27-white-button" onClick={() => void cargarReportesAdmin()}>Actualizar</button></div>
                          {reportes.length === 0 ? <div className="e27-empty-state"><strong>No hay reportes pendientes</strong><span>Cuando un responsable envíe información, aparecerá en esta bandeja.</span></div> : <div className="e27-review-list">{reportes.map((r) => <article key={`${r.tipo}-${r.id}`} className="e27-review-card"><div><span className="e27-kicker">{r.tipo === 'participacion' ? 'PARTICIPACIÓN' : 'ESCRUTINIO'}</span><strong>{r.colegio || 'Colegio'} · Mesa {r.mesa ?? '—'}</strong><small>{new Date(r.creado_en).toLocaleString('es-AR')}</small></div><button className="e27-white-button" onClick={() => aprobarReporte(r)}>Aprobar y publicar</button></article>)}</div>}
                        </section>
                      )}
                      {pestanaEscrutinio === 'publicados' && (
                        <section className="e27-panel">
                          <div className="e27-panel-heading"><div><span className="e27-kicker">SEGUIMIENTO DEL ESCRUTINIO</span><h3>Avance de resultados publicados</h3><p>Solo se contarán escrutinios aprobados y publicados sobre el total de mesas activas.</p></div></div>
                          <label className="e27-dashboard-filter">Circuito electoral<select value={circuitoDashboard} onChange={(e) => setCircuitoDashboard(e.target.value)}><option value="">Seleccionar circuito</option>{CIRCUITOS_ELECTORALES.map((circuito) => <option key={circuito} value={circuito}>{circuito}</option>)}</select></label>
                          <div className="e27-dashboard-stats"><article><small>LA MATANZA</small><strong>—%</strong><span>Mesas publicadas / mesas totales</span></article><article><small>CIRCUITO {circuitoDashboard || '—'}</small><strong>—%</strong><span>Mesas publicadas / mesas del circuito</span></article></div>
                          <div className="e27-empty-state"><strong>{circuitoDashboard ? `Escuelas del circuito ${circuitoDashboard}` : 'Seleccioná un circuito para consultar sus escuelas'}</strong><span>Al conectar esta vista con Supabase se listarán los colegios y sus mesas. Cada colegio podrá desplegarse para ver el avance de publicación, distinguiendo reportes recibidos de reportes aprobados.</span></div>
                          <div className="e27-dashboard-legend"><span><i className="e27-dot e27-dot-received" /> Reportes recibidos</span><span><i className="e27-dot e27-dot-published" /> Resultados publicados</span></div>
                        </section>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              <section className="e27-assignment-banner">
                <div className="e27-responsable-section-heading">
                  <div>
                    <span className="e27-kicker">TUS ESTABLECIMIENTOS ASIGNADOS</span>
                    <h2>Tu lugar de trabajo</h2>
                    <p>Estos son los establecimientos vinculados a tu cuenta.</p>
                  </div>
                  <span className="e27-assignment-status">Asignación activa</span>
                </div>
                <div className="e27-assignment-cards">
                  {colegios.map((c) => (
                    <article className="e27-assignment-card" key={c.id}>
                      <span className="e27-assignment-icon" aria-hidden="true">⌂</span>
                      <div className="e27-assignment-card-copy">
                        <small>ESTABLECIMIENTO ASIGNADO</small>
                        <strong>{c.nombre}</strong>
                        <span className="e27-circuit-chip">Circuito {c.circuito || 'A confirmar'}</span>
                      </div>
                    </article>
                  ))}
                </div>
                <p className="e27-assignment-note">El sistema ya reconoce tus asignaciones. No necesitás elegir colegio ni circuito al realizar una carga.</p>
              </section>
              {mensaje && <div className="e27-feedback">{mensaje}</div>}
              <section className="e27-panel e27-responsable-mesas-panel">
                <div className="e27-responsable-section-heading e27-mesas-heading">
                  <div>
                    <span className="e27-kicker">MESAS ASIGNADAS</span>
                    <h2>Elegí qué información necesitás cargar</h2>
                    <p>Seleccioná una de las acciones disponibles para cada mesa.</p>
                  </div>
                  <span className="e27-mesas-count">{mesas.length} {mesas.length === 1 ? 'mesa asignada' : 'mesas asignadas'}</span>
                </div>
                <div className="e27-mesa-grid">
                  {mesas.map((mesa) => {
                    const colegio = colegioPorId[mesa.colegio_id];
                    return (
                      <article className="e27-mesa-card" key={mesa.id}>
                        <div className="e27-mesa-card-topline">
                          <span className="e27-mesa-card-label">MESA ELECTORAL</span>
                          <span className="e27-mesa-number">{mesa.numero}</span>
                        </div>
                        <div className="e27-mesa-card-details">
                          <strong>{colegio?.nombre || 'Colegio asignado'}</strong>
                          <span>{mesa.electores_habilitados > 0 ? `${mesa.electores_habilitados.toLocaleString('es-AR')} electores habilitados` : 'Pendiente: informar electores habilitados'}</span>
                        </div>
                        {mesa.electores_habilitados > 0 && mesaEditandoElectores !== mesa.id ? (
                          <div className="e27-electors-saved">
                            <div>
                              <span>Electores habilitados guardados</span>
                              <strong>{mesa.electores_habilitados.toLocaleString('es-AR')}</strong>
                            </div>
                            <span className="e27-saved-tag">Guardado</span>
                            <button
                              type="button"
                              className="e27-edit-saved-button"
                              onClick={() => {
                                setElectoresPorMesa((actuales) => ({ ...actuales, [mesa.id]: String(mesa.electores_habilitados) }));
                                setMesaEditandoElectores(mesa.id);
                              }}
                            >Editar</button>
                          </div>
                        ) : (
                          <div className="e27-responsable-electors-editor is-editing">
                            <label>Electores habilitados reales de esta mesa
                              <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                value={electoresPorMesa[mesa.id] ?? ''}
                                onChange={(e) => setElectoresPorMesa((actuales) => ({ ...actuales, [mesa.id]: e.target.value }))}
                                placeholder="Ingresá la cantidad real"
                              />
                            </label>
                            <div className="e27-electors-editor-actions">
                              <button
                                type="button"
                                className="e27-save-electors-button"
                                onClick={() => { void guardarElectoresMesa(mesa); }}
                                disabled={guardandoElectoresMesa === mesa.id}
                              >
                                {guardandoElectoresMesa === mesa.id ? 'Guardando…' : mesa.electores_habilitados > 0 ? 'Guardar cambios' : 'Guardar electores'}
                              </button>
                              {mesa.electores_habilitados > 0 && (
                                <button
                                  type="button"
                                  className="e27-edit-saved-button"
                                  onClick={() => {
                                    setMesaEditandoElectores(null);
                                    setElectoresPorMesa((actuales) => ({ ...actuales, [mesa.id]: String(mesa.electores_habilitados) }));
                                  }}
                                >Cancelar</button>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="e27-mesa-actions">
                          <button type="button" className="e27-action-button e27-action-participacion" disabled={mesa.electores_habilitados < 1} onClick={() => { void abrirCarga(mesa, 'participacion'); }}>
                            <span className="e27-action-icon" aria-hidden="true">◷</span>
                            <span className="e27-action-copy"><strong>Cargar participación</strong><small>{mesa.electores_habilitados > 0 ? 'Registrar cantidad de votantes' : 'Primero informá y guardá los electores'}</small></span>
                            <span className="e27-action-arrow" aria-hidden="true">→</span>
                          </button>
                          <button type="button" className="e27-action-button e27-action-escrutinio" onClick={() => { void abrirCarga(mesa, 'escrutinio'); }}>
                            <span className="e27-action-icon" aria-hidden="true">▤</span>
                            <span className="e27-action-copy"><strong>Cargar escrutinio</strong><small>Registrar votos por partido</small></span>
                            <span className="e27-action-arrow" aria-hidden="true">→</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {mesas.length === 0 && <div className="e27-empty-state"><strong>No tenés mesas asignadas</strong><span>Pedile al Administrador General que revise tu asignación de colegio y mesas.</span></div>}
              </section>
            </>
          )}

          {tipoCarga && mesaActiva && (
            <div
              className="e27-capture-overlay"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !cargando) {
                  setTipoCarga(null);
                  setMesaActiva(null);
                  setMensaje('');
                }
              }}
            >
              <section className="e27-panel e27-capture-panel e27-responsable-capture-panel" role="dialog" aria-modal="true" aria-labelledby="e27-capture-title">
              <div className="e27-capture-heading">
                <div>
                  <span className="e27-kicker">CARGA ASOCIADA AUTOMÁTICAMENTE</span>
                  <h2 id="e27-capture-title">{tipoCarga === 'participacion' ? 'Registrar participación' : 'Cargar escrutinio final'} · Mesa {mesaActiva.numero}</h2>
                  <p>{colegioPorId[mesaActiva.colegio_id]?.nombre} · Circuito {colegioPorId[mesaActiva.colegio_id]?.circuito || '—'}</p>
                </div>
                <button type="button" className="e27-white-button e27-white-button-outline" onClick={() => { setTipoCarga(null); setMesaActiva(null); setMensaje(''); }}>Cerrar carga</button>
              </div>

              {tipoCarga === 'participacion' ? (
                <form className="e27-participation-form" onSubmit={enviarParticipacion}>
                  <div className="e27-participation-layout">
                    <div className="e27-participation-main">
                      <div className="e27-electors-card">
                        <span className="e27-electors-icon" aria-hidden="true">♙</span>
                        <div>
                          <small>ELECTORES HABILITADOS EN ESTA MESA</small>
                          <strong>{electoresMesaActiva.toLocaleString('es-AR')}</strong>
                          <span>Este total corresponde a la mesa asignada.</span>
                        </div>
                      </div>

                      {franjasGuardadas[franjaHora] !== undefined && !franjaEditando ? (
                        <div className="e27-participation-saved-card">
                          <div className="e27-participation-saved-copy">
                            <span>Registro guardado · {franjaHora}</span>
                            <strong>{Number(franjasGuardadas[franjaHora]).toLocaleString('es-AR')} personas votaron</strong>
                            {horaPreviaSeleccionada && franjasGuardadas[horaPreviaSeleccionada] !== undefined && (
                              <small>Registro anterior ({horaPreviaSeleccionada}): {Number(franjasGuardadas[horaPreviaSeleccionada]).toLocaleString('es-AR')} personas</small>
                            )}
                          </div>
                          <button
                            type="button"
                            className="e27-edit-saved-button"
                            onClick={() => {
                              setFranjaEditando(true);
                              setVotantes(franjasGuardadas[franjaHora]);
                              setMensaje('');
                            }}
                          >Editar</button>
                        </div>
                      ) : (
                        <>
                          <label className="e27-voters-field">
                            <span>¿Cuántas personas votaron hasta este horario?</span>
                            <input
                              type="number"
                              min="0"
                              max={electoresMesaActiva}
                              step="1"
                              inputMode="numeric"
                              value={votantes}
                              onChange={(e) => setVotantes(e.target.value)}
                              placeholder="Ejemplo: 175"
                              required
                            />
                            <small>
                              {franjaEditando
                                ? 'Estás corrigiendo un registro guardado. Se validará contra los acumulados anterior y siguiente.'
                                : 'Ingresá el total acumulado de votantes hasta este horario.'}
                            </small>
                          </label>
                          <button className="e27-save-participation" type="submit" disabled={cargando || cargandoFranjas || !votantes.trim()}>
                            {cargando
                              ? 'Guardando registro…'
                              : franjaEditando
                                ? `Guardar corrección de las ${franjaHora}`
                                : `Guardar acumulado de las ${franjaHora}`}
                          </button>
                        </>
                      )}
                    </div>

                    <aside className="e27-participation-meter" aria-live="polite">
                      <span>PARTICIPACIÓN DE LA MESA</span>
                      <strong>{porcentajeParticipacionRedondeado}%</strong>
                      <div className="e27-progress-track">
                        <div className="e27-progress-fill" style={{ width: `${porcentajeParticipacionActual}%` }} />
                      </div>
                      <b>{(Number.isFinite(votantesActuales) ? votantesActuales : 0).toLocaleString('es-AR')} de {electoresMesaActiva.toLocaleString('es-AR')}</b>
                      <small>{hayValorEnEdicion ? `Porcentaje calculado para las ${franjaHora}` : ultimoHorarioGuardado ? `Último registro guardado: ${ultimoHorarioGuardado}` : 'Ingresá los votantes para calcular el porcentaje'}</small>
                    </aside>
                  </div>

                  <div className="e27-hours-section">
                    <div className="e27-hours-heading">
                      <div>
                        <span className="e27-kicker">CONTROL HORARIO</span>
                        <h3>Seleccioná el horario del reporte</h3>
                        <p>Jornada electoral: de 08:00 a 18:00. Podés guardar un acumulado por cada horario.</p>
                      </div>
                      {cargandoFranjas && <span className="e27-loading-hours">Consultando registros guardados…</span>}
                    </div>
                    <div className="e27-hours-grid e27-hours-sequential-grid">
                      {HORARIOS_PARTICIPACION.map((hora, index) => {
                        const guardado = franjasGuardadas[hora] !== undefined;
                        const seleccionado = franjaHora === hora;
                        const primeraPendiente = indiceSiguienteFranja >= 0 ? HORARIOS_PARTICIPACION[indiceSiguienteFranja] : '';
                        const habilitado = guardado || hora === primeraPendiente;
                        const horaAnteriorConDato = HORARIOS_PARTICIPACION.slice(0, index).reverse().find((item) => franjasGuardadas[item] !== undefined);
                        return (
                          <article
                            key={hora}
                            className={`e27-hour-card ${guardado ? 'is-saved' : ''} ${seleccionado ? 'is-selected' : ''} ${!habilitado ? 'is-locked' : ''}`}
                          >
                            <div className="e27-hour-card-top">
                              <strong>{hora}</strong>
                              {guardado ? <span className="e27-saved-tag">Guardado</span> : !habilitado ? <span className="e27-locked-tag">Bloqueado</span> : <span className="e27-next-tag">Siguiente</span>}
                            </div>
                            {guardado ? (
                              <div className="e27-hour-saved-values">
                                <b>{Number(franjasGuardadas[hora]).toLocaleString('es-AR')} votantes</b>
                                {horaAnteriorConDato && (
                                  <small>Anterior ({horaAnteriorConDato}): {Number(franjasGuardadas[horaAnteriorConDato]).toLocaleString('es-AR')}</small>
                                )}
                              </div>
                            ) : (
                              <small>{habilitado ? 'Listo para cargar' : 'Completá los horarios anteriores'}</small>
                            )}
                            <button
                              type="button"
                              className={`e27-hour-edit-button ${guardado ? 'is-edit' : ''}`}
                              disabled={!habilitado}
                              aria-pressed={seleccionado}
                              onClick={() => seleccionarFranja(hora)}
                            >
                              {guardado ? seleccionado ? 'Registro seleccionado' : 'Ver registro' : habilitado ? 'Cargar horario' : 'No disponible'}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </form>
              ) : (
                <div className="e27-scrutiny-workflow">
                  {votantesUltimoRegistro === null ? (
                    <div className="e27-scrutiny-blocked">
                      <strong>Primero cargá la participación de esta mesa</strong>
                      <span>Para habilitar el escrutinio necesitamos el último acumulado de votantes guardado en la mesa.</span>
                    </div>
                  ) : (
                    <>
                      <div className="e27-scrutiny-turnout-card">
                        <div>
                          <small>PARTICIPACIÓN REGISTRADA · {horaUltimoRegistro || 'ÚLTIMO HORARIO'}</small>
                          <strong>{votantesUltimoRegistro.toLocaleString('es-AR')} <span>personas votaron</span></strong>
                          <span>Sobre {electoresMesaActiva.toLocaleString('es-AR')} electores habilitados</span>
                        </div>
                        <div className="e27-turnout-ratio">
                          <strong>{electoresMesaActiva ? Math.round(votantesUltimoRegistro / electoresMesaActiva * 100) : 0}%</strong>
                          <small>de participación</small>
                        </div>
                      </div>

                      {escrutinioGuardado && !escrutinioEditando ? (
                        <div className="e27-scrutiny-saved-card">
                          <div className="e27-scrutiny-saved-heading">
                            <div>
                              <span className="e27-saved-tag">Escrutinio guardado</span>
                              <strong>Resultados registrados</strong>
                              <small>{escrutinioGuardado.estado === 'publicado' ? 'Publicado' : 'En revisión de la administración'}</small>
                            </div>
                            <div className="e27-scrutiny-total">
                              <small>Total escrutado</small>
                              <strong>{(Object.values(escrutinioGuardado.votos_partidos).reduce((a, b) => a + b, 0) + escrutinioGuardado.votos_blancos + escrutinioGuardado.votos_nulos).toLocaleString('es-AR')}</strong>
                            </div>
                          </div>
                          <div className="e27-scrutiny-saved-parties">
                            {partidos.map((partido) => (
                              <div key={partido.id}>
                                <span><i style={{ background: partido.color }} />{partido.nombre}</span>
                                <strong>{Number(escrutinioGuardado.votos_partidos[partido.id] ?? 0).toLocaleString('es-AR')}</strong>
                              </div>
                            ))}
                            <div><span>Votos en blanco</span><strong>{escrutinioGuardado.votos_blancos.toLocaleString('es-AR')}</strong></div>
                            <div><span>Votos nulos</span><strong>{escrutinioGuardado.votos_nulos.toLocaleString('es-AR')}</strong></div>
                          </div>
                          {escrutinioDeOtraCuenta ? (
                            <p>Este reporte pertenece a otra cuenta. Para editarlo, solicitá al Administrador General que revise la asignación.</p>
                          ) : (
                            <button type="button" className="e27-edit-saved-button" onClick={() => setEscrutinioEditando(true)}>Editar escrutinio</button>
                          )}
                        </div>
                      ) : (
                        <form className="e27-capture-form e27-scrutiny-form" onSubmit={enviarEscrutinio}>
                          <div className="e27-scrutiny-intro">
                            <strong>{escrutinioGuardado ? 'Editar escrutinio guardado' : 'Cargar resultados de la mesa'}</strong>
                            <span>Ingresá los votos obtenidos por cada partido. La suma de votos partidarios, blancos y nulos no puede superar las personas que votaron.</span>
                          </div>
                          <div className="e27-scrutiny-live-total">
                            <span>Votantes registrados: <strong>{votantesUltimoRegistro.toLocaleString('es-AR')}</strong></span>
                            <span>Votos cargados: <strong>{totalEscrutinioActual.toLocaleString('es-AR')}</strong></span>
                            <span>Disponibles: <strong>{Math.max(0, votantesUltimoRegistro - totalEscrutinioActual).toLocaleString('es-AR')}</strong></span>
                          </div>
                          <div className="e27-vote-grid">{partidos.map((p) => <label key={p.id}><span><i style={{ background: p.color }} />{p.nombre}</span><input type="number" min="0" max={votantesUltimoRegistro} step="1" value={votos[p.id] ?? ''} onChange={(e) => setVotos((old) => ({ ...old, [p.id]: e.target.value }))} placeholder="Cantidad de votos" required /></label>)}</div>
                          <div className="e27-scrutiny-extras">
                            <label>Votos en blanco<input type="number" min="0" max={votantesUltimoRegistro} step="1" value={blancos} onChange={(e) => setBlancos(e.target.value)} /></label>
                            <label>Votos nulos<input type="number" min="0" max={votantesUltimoRegistro} step="1" value={nulos} onChange={(e) => setNulos(e.target.value)} /></label>
                          </div>
                          {escrutinioSuperaParticipacion && (
                            <div className="e27-scrutiny-warning" role="alert">
                              <strong>No se puede guardar el escrutinio</strong>
                              <span>La suma de los votos supera las {votantesUltimoRegistro.toLocaleString('es-AR')} personas que votaron en esta mesa.</span>
                            </div>
                          )}
                          {escrutinioGuardado && (
                            <button type="button" className="e27-edit-saved-button" onClick={() => {
                              setEscrutinioEditando(false);
                              setVotos(Object.fromEntries(Object.entries(escrutinioGuardado.votos_partidos).map(([id, cantidad]) => [id, String(cantidad)])));
                              setBlancos(String(escrutinioGuardado.votos_blancos));
                              setNulos(String(escrutinioGuardado.votos_nulos));
                              setMensaje('');
                            }}>Cancelar edición</button>
                          )}
                          <button className="e27-save-participation" type="submit" disabled={cargando || escrutinioDeOtraCuenta || escrutinioSuperaParticipacion}>
                            {cargando ? 'Guardando escrutinio…' : escrutinioGuardado ? 'Guardar correcciones y reenviar a revisión' : 'Enviar escrutinio a revisión'}
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}
              {mensaje && <div className="e27-feedback e27-capture-feedback" role="status">{mensaje}</div>}
              </section>
            </div>
          )}
        </div>
      )}

      {mostrarLogin && (
        <div className="e27-login-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarLogin(false); }}>
          <form className="e27-login-modal" onSubmit={iniciarSesion}>
            <button type="button" className="e27-login-close" onClick={() => setMostrarLogin(false)}>×</button>
            <span className="e27-kicker">ACCESO RESTRINGIDO</span>
            <h2>Acceso a Elecciones 2027</h2>
            <p>Primero elegí el tipo de acceso. El sistema verificará que tu cuenta tenga ese rol asignado.</p>
            <div className="e27-login-roles">
              <button type="button" className={rolElegido === 'administrador_general' ? 'selected' : ''} onClick={() => { setRolElegido('administrador_general'); setError(''); }}>
                <strong>Administración General</strong><small>Validación y control central</small>
              </button>
              <button type="button" className={rolElegido === 'responsable_escuela' ? 'selected' : ''} onClick={() => { setRolElegido('responsable_escuela'); setError(''); }}>
                <strong>Responsable de Escuela</strong><small>Carga de participación y escrutinio</small>
              </button>
            </div>
            <label>Correo electrónico<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
            <label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
            {error && <div className="e27-login-error">{error}</div>}
            <button className="e27-white-button" type="submit" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
            <button type="button" className="e27-forgot" onClick={async () => {
              if (!email.trim()) { setError('Ingresá tu correo para recibir el enlace de recuperación.'); return; }
              const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() });
              setError(resetError ? resetError.message : 'Si el correo está registrado, recibirás un enlace para recuperar la contraseña.');
            }}>Olvidé mi contraseña</button>
          </form>
        </div>
      )}
    </section>
  );
}