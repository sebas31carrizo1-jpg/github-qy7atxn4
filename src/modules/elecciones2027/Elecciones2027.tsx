import { useCallback, useEffect, useMemo, useState } from 'react';
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
};

type Mesa = {
  id: string;
  numero: number;
  electores_habilitados: number;
  colegio_id: string;
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

const municipioUrl = '/la-matanza-municipio.geojson';

function AjustarMapa({ data }: { data: FeatureCollection | null }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const bounds = L.geoJSON(data as never).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [25, 25] });
  }, [data, map]);
  return null;
}


function convertirKml(kml: string): FeatureCollection {
  const xml = new DOMParser().parseFromString(kml, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('El archivo KML no tiene un formato válido.');
  const placemarks = Array.from(xml.getElementsByTagNameNS('*', 'Placemark'));
  const features: any[] = [];
  const leerTexto = (node: Element, tag: string) =>
    Array.from(node.getElementsByTagNameNS('*', tag))[0]?.textContent?.trim() || '';
  for (const [index, placemark] of placemarks.entries()) {
    const nombre = leerTexto(placemark, 'name') || `Polígono ${index + 1}`;
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
      properties: { nombre },
    });
  }
  return { type: 'FeatureCollection', features };
}

function MapaColegios({ data }: { data: FeatureCollection | null }) {
  if (!data) return <div className="e27-map-loading">Cargando los polígonos de colegios…</div>;
  return (
    <MapContainer center={[-34.75, -58.62]} zoom={10} scrollWheelZoom className="e27-map">
      <AjustarMapa data={data} />
      <GeoJSON data={data as never} style={() => ({
        color: '#2563eb', weight: 1.6, fillColor: '#60a5fa', fillOpacity: 0.28,
      })} onEachFeature={(feature, layer) => {
        const name = String((feature.properties as any)?.nombre || 'Colegio');
        layer.bindTooltip(name, { sticky: true });
      }} />
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
}: {
  data: FeatureCollection | null;
  valores: Record<string, DatoCircuito>;
  modo: 'participacion' | 'resultados';
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
      <AjustarMapa data={data} />
      <GeoJSON
        key={`${modo}-${Object.keys(valores).length}`}
        data={data as never}
        style={(feature) => {
          const props = feature?.properties as Record<string, unknown> | undefined;
          const codigo = String(props?.circuito ?? props?.CIRCUITO ?? '').trim();
          const dato = valores[codigo];
          const fill = modo === 'participacion'
            ? colorVerde(dato?.porcentaje ?? 0)
            : (dato?.color || '#e5e7eb');
          const intensidad = modo === 'participacion'
            ? 0.85
            : dato ? 0.28 + Math.min(1, dato.porcentaje / 100) * 0.65 : 0.18;
          return {
            color: '#334155',
            weight: 1.5,
            opacity: 1,
            fillColor: fill,
            fillOpacity: intensidad,
          };
        }}
        onEachFeature={(feature, layer) => {
          const props = feature.properties as Record<string, unknown> | undefined;
          const codigo = String(props?.circuito ?? props?.CIRCUITO ?? 'Circuito');
          const dato = valores[codigo];
          const detalle = modo === 'participacion'
            ? dato
              ? `${dato.porcentaje.toFixed(1)}% de participación · ${numeroAR(dato.votantes || 0)} votantes`
              : 'Sin reporte publicado'
            : dato
              ? `${dato.partido} · ${dato.porcentaje.toFixed(1)}% · ${numeroAR(dato.votos || 0)} votos`
              : 'Sin escrutinio publicado';
          layer.bindTooltip(`<strong>${codigo}</strong><br/>${detalle}`, {
            sticky: true,
            className: 'e27-map-tooltip',
          });
        }}
      />
    </MapContainer>
  );
}

function numeroAR(valor: number) {
  return new Intl.NumberFormat('es-AR').format(valor);
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
  const [colegioActivo, setColegioActivo] = useState<string | null>(null);
  const [partidos, setPartidos] = useState<Partido[]>([]);
  const [reportes, setReportes] = useState<ReportePendiente[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [municipio, setMunicipio] = useState<FeatureCollection | null>(null);
  const [circuitosGeo, setCircuitosGeo] = useState<FeatureCollection | null>(null);
  const [participacionCircuitos, setParticipacionCircuitos] = useState<Record<string, DatoCircuito>>({});
  const [resultadosCircuitos, setResultadosCircuitos] = useState<Record<string, DatoCircuito>>({});
  const [rolElegido, setRolElegido] = useState<'administrador_general' | 'responsable_escuela'>('administrador_general');
  const [errorMunicipio, setErrorMunicipio] = useState('');
  const [colegiosKml, setColegiosKml] = useState<FeatureCollection | null>(null);
  const [colorGanador, setColorGanador] = useState('#E5E7EB');
  const [nombreGanador, setNombreGanador] = useState('Resultados aún no publicados');
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);
  const [tipoCarga, setTipoCarga] = useState<'participacion' | 'escrutinio' | null>(null);
  const [votantes, setVotantes] = useState('');
  const [franjaHora, setFranjaHora] = useState('12:00');
  const [votos, setVotos] = useState<Record<string, string>>({});
  const [blancos, setBlancos] = useState('0');
  const [nulos, setNulos] = useState('0');
  const [estadoConexion, setEstadoConexion] = useState<'comprobando' | 'conectado' | 'error'>('comprobando');

  const cargarPublico = useCallback(async () => {
    setCargandoDatos(true);
    const [mapaResponse, circuitosResponse, partidosResponse, reportesResponse, participacionResponse] = await Promise.all([
      fetch(municipioUrl).then(async (r) => {
        if (!r.ok) throw new Error(`No se encontró ${municipioUrl}. Colocá el archivo en public/la-matanza-municipio.geojson.`);
        return r.json();
      }).catch((e) => { setErrorMunicipio(e instanceof Error ? e.message : 'No se pudo cargar el polígono municipal.'); return null; }),
      fetch('/circuitos-la-matanza.geojson').then(async (r) => {
        if (!r.ok) throw new Error('No se encontró public/circuitos-la-matanza.geojson');
        return r.json();
      }).catch((e) => { setMensaje(e instanceof Error ? e.message : 'No se pudo cargar la cartografía de circuitos.'); return null; }),
      supabase.from('elecciones_partidos').select('id,nombre,sigla,color').eq('activo', true),

      supabase.from('elecciones_reportes_escrutinio')
        .select('id,elecciones_escrutinio_partidos(votos,partido_id,elecciones_partidos(nombre,color)),elecciones_mesas(elecciones_colegios(circuito))')
        .eq('estado', 'publicado'),
      supabase.from('elecciones_reportes_participacion')
        .select('id,elecciones_participacion_franjas(votantes,hora),elecciones_mesas(electores_habilitados,elecciones_colegios(circuito))')
        .eq('estado', 'publicado'),
    ]);
    if (mapaResponse?.features) setMunicipio(mapaResponse);
    if (circuitosResponse?.features) setCircuitosGeo(circuitosResponse);
    fetch('/COLEGIOS%20OCTUBRE%202025.kml').then((r) => r.ok ? r.text() : Promise.reject(new Error('No se encontró el KML'))).then((raw) => setColegiosKml(convertirKml(raw))).catch((e) => setMensaje(e.message || 'No se pudo cargar el KML.'));
    if (!partidosResponse.error && partidosResponse.data) setPartidos(partidosResponse.data as Partido[]);
    if (!reportesResponse.error && reportesResponse.data?.length) {
      const totales: Record<string, { nombre: string; color: string; votos: number }> = {};
      const porCircuito: Record<string, Record<string, { nombre: string; color: string; votos: number }>> = {};
      for (const reporte of reportesResponse.data as any[]) {
        const mesaRel = Array.isArray(reporte.elecciones_mesas) ? reporte.elecciones_mesas[0] : reporte.elecciones_mesas;
        const colegioRel = Array.isArray(mesaRel?.elecciones_colegios) ? mesaRel.elecciones_colegios[0] : mesaRel?.elecciones_colegios;
        const circuito = String(colegioRel?.circuito ?? '').trim();
        if (!circuito) continue;
        for (const fila of reporte.elecciones_escrutinio_partidos ?? []) {
          const partido = Array.isArray(fila.elecciones_partidos) ? fila.elecciones_partidos[0] : fila.elecciones_partidos;
          if (!partido) continue;
          const key = String(fila.partido_id);
          const cantidad = Number(fila.votos || 0);
          if (!totales[key]) totales[key] = { nombre: partido.nombre, color: partido.color || '#64748b', votos: 0 };
          totales[key].votos += cantidad;
          if (!porCircuito[circuito]) porCircuito[circuito] = {};
          if (!porCircuito[circuito][key]) porCircuito[circuito][key] = { nombre: partido.nombre, color: partido.color || '#64748b', votos: 0 };
          porCircuito[circuito][key].votos += cantidad;
        }
      }
      const ganador = Object.values(totales).sort((a, b) => b.votos - a.votos)[0];
      if (ganador) {
        setColorGanador(ganador.color);
        setNombreGanador(`${ganador.nombre} · ${ganador.votos.toLocaleString('es-AR')} votos`);
      }
      const porCircuitoMap: Record<string, DatoCircuito> = {};
      for (const [codigo, partidosCircuito] of Object.entries(porCircuito)) {
        const lista = Object.values(partidosCircuito).sort((a, b) => b.votos - a.votos);
        const total = lista.reduce((sum, item) => sum + item.votos, 0);
        const winner = lista[0];
        if (winner && total > 0) porCircuitoMap[codigo] = {
          circuito: codigo, partido: winner.nombre, color: winner.color,
          votos: winner.votos, porcentaje: winner.votos / total * 100,
        };
      }
      setResultadosCircuitos(porCircuitoMap);
    }
    if (!participacionResponse.error && participacionResponse.data?.length) {
      const acumulados: Record<string, { votantes: number; habilitados: number }> = {};
      for (const reporte of participacionResponse.data as any[]) {
        const mesaRel = Array.isArray(reporte.elecciones_mesas) ? reporte.elecciones_mesas[0] : reporte.elecciones_mesas;
        const colegioRel = Array.isArray(mesaRel?.elecciones_colegios) ? mesaRel.elecciones_colegios[0] : mesaRel?.elecciones_colegios;
        const circuito = String(colegioRel?.circuito ?? '').trim();
        if (!circuito || !mesaRel) continue;
        const franjas = [...(reporte.elecciones_participacion_franjas ?? [])].sort((a: any, b: any) => String(b.hora).localeCompare(String(a.hora)));
        const ultima = franjas[0];
        if (!ultima) continue;
        if (!acumulados[circuito]) acumulados[circuito] = { votantes: 0, habilitados: 0 };
        acumulados[circuito].votantes += Number(ultima.votantes || 0);
        acumulados[circuito].habilitados += Number(mesaRel.electores_habilitados || 0);
      }
      const datos: Record<string, DatoCircuito> = {};
      for (const [codigo, dato] of Object.entries(acumulados)) {
        datos[codigo] = {
          circuito: codigo, votantes: dato.votantes, habilitados: dato.habilitados,
          porcentaje: dato.habilitados ? dato.votantes / dato.habilitados * 100 : 0,
        };
      }
      setParticipacionCircuitos(datos);
    }
    setCargandoDatos(false);
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
    setPerfil(p as Perfil);
    if (p.rol === 'responsable_escuela') {
      const { data: asignaciones, error: asignacionError } = await supabase
        .from('elecciones_usuario_colegios')
        .select('colegio_id,elecciones_colegios(id,nombre,circuito)')
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
        setMesas((mesasData ?? []) as Mesa[]);
      } else {
        setMesas([]);
      }
    } else {
      setColegios([]);
      setMesas([]);
    }
  }, []);

  const cargarReportesAdmin = async () => {
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
  };

  useEffect(() => {
    if (perfil?.rol === 'administrador_general') void cargarReportesAdmin();
  }, [perfil]);

  useEffect(() => {
    let vigente = true;
    supabase.auth.getSession().then(({ data }) => {
      if (vigente && data.session?.user) cargarPerfil(data.session.user.id).catch(() => undefined);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setPerfil(null); setColegios([]); setMesas([]); setReportes([]);
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
    setPerfil(null); setColegios([]); setMesas([]); setReportes([]);
    setMensaje('Sesión cerrada.');
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

  const abrirCarga = (mesa: Mesa, tipo: 'participacion' | 'escrutinio') => {
    setMesaActiva(mesa); setTipoCarga(tipo); setMensaje('');
    setVotantes(''); setFranjaHora('12:00'); setVotos({}); setBlancos('0'); setNulos('0');
  };

  const enviarParticipacion = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mesaActiva || !perfil) return;
    const cantidad = Number(votantes);
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > mesaActiva.electores_habilitados) {
      setMensaje('La cantidad debe ser un entero entre 0 y los electores habilitados de la mesa.'); return;
    }
    setCargando(true); setMensaje('');
    try {
      const { data: reporte, error: repError } = await supabase
        .from('elecciones_reportes_participacion')
        .upsert({ mesa_id: mesaActiva.id, user_id: perfil.user_id }, { onConflict: 'mesa_id' })
        .select('id').single();
      if (repError) throw repError;
      const { error: franjaError } = await supabase
        .from('elecciones_participacion_franjas')
        .upsert({ reporte_id: reporte.id, hora: franjaHora, votantes: cantidad }, { onConflict: 'reporte_id,hora' });
      if (franjaError) throw franjaError;
      setMensaje('Participación enviada para revisión de la administración central.');
      setMesaActiva(null); setTipoCarga(null);
    } catch (err) { setMensaje(err instanceof Error ? err.message : 'No se pudo enviar el reporte.'); }
    finally { setCargando(false); }
  };

  const enviarEscrutinio = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mesaActiva || !perfil) return;
    setCargando(true); setMensaje('');
    try {
      const { data: reporte, error: repError } = await supabase
        .from('elecciones_reportes_escrutinio')
        .upsert({
          mesa_id: mesaActiva.id,
          user_id: perfil.user_id,
          votos_blancos: Number(blancos || 0),
          votos_nulos: Number(nulos || 0),
        }, { onConflict: 'mesa_id' })
        .select('id').single();
      if (repError) throw repError;
      const filas = partidos.map((p) => ({
        reporte_id: reporte.id,
        partido_id: p.id,
        votos: Math.max(0, Number(votos[p.id] || 0)),
      }));
      if (filas.length) {
        const { error: votosError } = await supabase
          .from('elecciones_escrutinio_partidos')
          .upsert(filas, { onConflict: 'reporte_id,partido_id' });
        if (votosError) throw votosError;
      }
      setMensaje('Escrutinio enviado para revisión de la administración central.');
      setMesaActiva(null); setTipoCarga(null);
    } catch (err) { setMensaje(err instanceof Error ? err.message : 'No se pudo enviar el escrutinio.'); }
    finally { setCargando(false); }
  };

  const colegioPorId = useMemo(() => Object.fromEntries(colegios.map((c) => [c.id, c])), [colegios]);

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
          {!perfil ? (
            <button className="e27-white-button" onClick={() => { setError(''); setMostrarLogin(true); }}>Administración</button>
          ) : (
            <div className="e27-session">
              <span>{perfil.nombre}<small>{perfil.rol === 'administrador_general' ? 'Administrador General' : 'Responsable de Escuela'}</small></span>
              <button className="e27-white-button e27-white-button-small" onClick={cerrarSesion}>Cerrar sesión</button>
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
            <div className="e27-municipio-layout">
              <section className="e27-panel">
                <div className="e27-panel-heading">
                  <div><span className="e27-kicker">MAPA MUNICIPAL · UNA SOLA UNIDAD</span><h2>Ganador en La Matanza</h2><p>El municipio se representa como un único polígono, sin divisiones internas.</p></div>
                  <span className="e27-map-label">LA MATANZA</span>
                </div>
                <div className="e27-map-wrap e27-map-wrap-municipio"><MapaMunicipal data={municipio} color={colorGanador} /></div>
                {errorMunicipio && <div className="e27-feedback e27-map-error">{errorMunicipio}</div>}
                <div className="e27-winner-line"><i style={{ background: colorGanador }} /><strong>{nombreGanador}</strong></div>
              </section>
            </div>
          ) : vista === 'colegios' ? (
            <section className="e27-panel">
              <div className="e27-panel-heading"><div><span className="e27-kicker">CARTOGRAFÍA DE ESTABLECIMIENTOS</span><h2>Polígonos individuales de colegios</h2><p>Esta cartografía se mantiene separada del mapa municipal de ganador.</p></div><span className="e27-map-label">KML · OCTUBRE 2025</span></div>
              <div className="e27-map-wrap"><MapaColegios data={colegiosKml} /></div>
              <div className="e27-map-foot">{colegiosKml?.features.length ?? '—'} polígonos detectados</div>
            </section>
          ) : vista === 'participacion' ? (
            <section className="e27-panel">
              <div className="e27-panel-heading">
                <div><span className="e27-kicker">PARTICIPACIÓN ELECTORAL POR CIRCUITO</span><h2>Participación en La Matanza</h2><p>La intensidad del verde aumenta a medida que crece el porcentaje de participación publicado y aprobado.</p></div>
                <span className="e27-map-label">VERDE = MAYOR PARTICIPACIÓN</span>
              </div>
              <div className="e27-map-wrap"><MapaCircuitos data={circuitosGeo} valores={participacionCircuitos} modo="participacion" /></div>
              <div className="e27-legend"><span>0%</span><div className="e27-gradient green-gradient" /><span>100%</span></div>
              {!Object.keys(participacionCircuitos).length && <div className="e27-map-caption">Todavía no hay reportes de participación aprobados. Los circuitos aparecerán en verde a medida que se publiquen los datos.</div>}
            </section>
          ) : (
            <section className="e27-panel">
              <div className="e27-panel-heading">
                <div><span className="e27-kicker">RESULTADOS ELECTORALES POR CIRCUITO</span><h2>Ganador por circuito</h2><p>Cada circuito toma el color configurado para el partido ganador. La intensidad aumenta según su porcentaje de votos.</p></div>
                <span className="e27-map-label">COLOR = PARTIDO GANADOR</span>
              </div>
              <div className="e27-map-wrap"><MapaCircuitos data={circuitosGeo} valores={resultadosCircuitos} modo="resultados" /></div>
              <div className="e27-party-legend">{partidos.map((partido) => <span key={partido.id}><i style={{ background: partido.color }} />{partido.nombre}</span>)}</div>
              {!Object.keys(resultadosCircuitos).length && <div className="e27-map-caption">Todavía no hay escrutinios aprobados. Los circuitos se colorearán según el partido ganador y su porcentaje.</div>}
            </section>
          )}
        </>
      ) : (
        <div className="e27-private">
          <div className="e27-private-heading">
            <div><span className="e27-kicker">PANEL DE GESTIÓN</span><h2>Hola, {perfil.nombre}</h2></div>
            <span className="e27-role-chip">{perfil.rol === 'administrador_general' ? 'ADMINISTRADOR GENERAL' : 'RESPONSABLE DE ESCUELA'}</span>
          </div>

          {perfil.rol === 'administrador_general' ? (
            <section className="e27-panel">
              <div className="e27-panel-heading"><div><span className="e27-kicker">CONTROL CENTRAL</span><h2>Reportes pendientes de aprobación</h2><p>Solo la administración central puede publicar información en el observatorio público.</p></div><button className="e27-white-button" onClick={() => cargarReportesAdmin()}>Actualizar</button></div>
              {mensaje && <div className="e27-feedback">{mensaje}</div>}
              {reportes.length === 0 ? <div className="e27-empty-state"><strong>No hay reportes pendientes</strong><span>Cuando un responsable envíe información, aparecerá en esta bandeja.</span></div> : (
                <div className="e27-review-list">
                  {reportes.map((r) => (
                    <article key={`${r.tipo}-${r.id}`} className="e27-review-card">
                      <div><span className="e27-kicker">{r.tipo === 'participacion' ? 'PARTICIPACIÓN' : 'ESCRUTINIO'}</span><strong>{r.colegio || 'Colegio'} · Mesa {r.mesa ?? '—'}</strong><small>{new Date(r.creado_en).toLocaleString('es-AR')}</small></div>
                      <button className="e27-white-button" onClick={() => aprobarReporte(r)}>Aprobar y publicar</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="e27-assignment-banner">
                <span className="e27-kicker">TUS ESTABLECIMIENTOS ASIGNADOS</span>
                <div className="e27-assignment-cards">
                  {colegios.map((c) => <article key={c.id}><small>COLEGIO</small><strong>{c.nombre}</strong><span>Circuito {c.circuito || 'A confirmar'}</span></article>)}
                </div>
                <p>El sistema ya conoce tus asignaciones. No tenés que seleccionar colegio, circuito ni escribirlos en cada carga.</p>
              </section>
              {mensaje && <div className="e27-feedback">{mensaje}</div>}
              <section className="e27-panel">
                <span className="e27-kicker">MESAS ASIGNADAS</span><h2>Seleccioná la acción de la mesa</h2>
                <div className="e27-mesa-grid">
                  {mesas.map((mesa) => {
                    const colegio = colegioPorId[mesa.colegio_id];
                    return <article className="e27-mesa-card" key={mesa.id}>
                      <small>{colegio?.nombre || 'Colegio asignado'}</small>
                      <strong>Mesa {mesa.numero}</strong>
                      <span>{mesa.electores_habilitados.toLocaleString('es-AR')} electores habilitados</span>
                      <button className="e27-white-button" onClick={() => abrirCarga(mesa, 'participacion')}>Cargar participación</button>
                      <button className="e27-white-button e27-white-button-outline" onClick={() => abrirCarga(mesa, 'escrutinio')}>Cargar escrutinio</button>
                    </article>;
                  })}
                </div>
                {mesas.length === 0 && <div className="e27-empty-state"><strong>No tenés mesas asignadas</strong><span>Pedile al Administrador General que revise tu asignación de colegio y mesas.</span></div>}
              </section>
            </>
          )}

          {tipoCarga && mesaActiva && (
            <section className="e27-panel e27-capture-panel">
              <div className="e27-panel-heading"><div><span className="e27-kicker">CARGA ASOCIADA AUTOMÁTICAMENTE</span><h2>{tipoCarga === 'participacion' ? 'Participación' : 'Escrutinio'} · Mesa {mesaActiva.numero}</h2><p>{colegioPorId[mesaActiva.colegio_id]?.nombre} · Circuito {colegioPorId[mesaActiva.colegio_id]?.circuito || '—'}</p></div><button className="e27-white-button e27-white-button-outline" onClick={() => { setTipoCarga(null); setMesaActiva(null); }}>Cancelar</button></div>
              {tipoCarga === 'participacion' ? (
                <form className="e27-capture-form" onSubmit={enviarParticipacion}>
                  <label>Horario del reporte<input type="time" value={franjaHora} onChange={(e) => setFranjaHora(e.target.value)} required /></label>
                  <label>Votantes acumulados<input type="number" min="0" max={mesaActiva.electores_habilitados} value={votantes} onChange={(e) => setVotantes(e.target.value)} required /></label>
                  <p>Electores habilitados: <strong>{mesaActiva.electores_habilitados.toLocaleString('es-AR')}</strong></p>
                  <button className="e27-white-button" disabled={cargando}>{cargando ? 'Enviando…' : 'Enviar a revisión'}</button>
                </form>
              ) : (
                <form className="e27-capture-form" onSubmit={enviarEscrutinio}>
                  <div className="e27-vote-grid">{partidos.map((p) => <label key={p.id}><span><i style={{ background: p.color }} />{p.nombre}</span><input type="number" min="0" value={votos[p.id] || ''} onChange={(e) => setVotos((old) => ({ ...old, [p.id]: e.target.value }))} placeholder="Votos" required /></label>)}</div>
                  <label>Votos en blanco<input type="number" min="0" value={blancos} onChange={(e) => setBlancos(e.target.value)} /></label>
                  <label>Votos nulos<input type="number" min="0" value={nulos} onChange={(e) => setNulos(e.target.value)} /></label>
                  <button className="e27-white-button" disabled={cargando}>{cargando ? 'Enviando…' : 'Enviar escrutinio a revisión'}</button>
                </form>
              )}
            </section>
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
              const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
              setError(resetError ? resetError.message : 'Si el correo está registrado, recibirás un enlace para recuperar la contraseña.');
            }}>Olvidé mi contraseña</button>
          </form>
        </div>
      )}
    </section>
  );
}
