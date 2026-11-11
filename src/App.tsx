import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { supabase } from './lib/supabase';

function AjustarMapa({ data }: { data: any }) {
  const map = useMap();

  useEffect(() => {
    if (!data) return;

    const bounds = L.geoJSON(data).getBounds();

    if (bounds.isValid()) {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [25, 25] });
    }
  }, [data, map]);

  return null;
}

const normalizarCodigoCircuito = (codigo: string) =>
  codigo.startsWith('0') ? codigo : `0${codigo}`;

const formatoNumero = (valor: number) =>
  new Intl.NumberFormat('es-AR').format(valor);

const secciones = [
  {
    nombre: 'Histórico electoral',
    numero: '01',
    icono: '▤',
    descripcion:
      'Elecciones, resultados históricos, mapas y circuitos electorales.',
    color: 'electoral',
    etiqueta: 'HISTORIA ELECTORAL',
    fondo: 'Elecciones',
    imagen:
      'https://cdn4.vivieloeste.com.ar/s4/2025/09/25/vivieloeste/images/07/65/76545_cab7b6b2e10f409f01d7809d87360caca9203c64df5966e80d44e00dadc195bd/lg.webp',
    imagenAlt: 'Fachada de un edificio escolar de La Matanza',
    fuenteImagen: 'Viví el Oeste',
    fuenteUrl:
      'https://www.vivieloeste.com.ar/noticias/2023/09/29/62774-gonzalez-catan-abrieron-nuevo-edificio-de-la-secundaria-68',
  },
  {
    nombre: 'Política',
    numero: '02',
    icono: '▦',
    descripcion:
      'Concejo Deliberante, concejales, bloques y representación política.',
    color: 'politica',
    etiqueta: 'INSTITUCIONES Y REPRESENTACIÓN',
    fondo: 'Política',
    imagen:
      'https://cloudfront-us-east-1.images.arcpublishing.com/infobae/4TVGRUTI35GFLCK66GWJ5D3YV4.png',
    imagenAlt: 'Edificio del Honorable Concejo Deliberante de La Matanza',
    fuenteImagen: 'Infobae',
    fuenteUrl:
      'https://www.infobae.com/politica/2025/09/12/fuerte-retroceso-de-la-izquierda-se-quedo-sin-concejales-en-el-conurbano-bonaerense/',
  },
  {
    nombre: 'Datos',
    numero: '03',
    icono: '▥',
    descripcion:
      'Territorio, población, salud, economía, educación y estadísticas.',
    color: 'datos',
    etiqueta: 'INFORMACIÓN DISTRITAL',
    fondo: 'La Matanza',
    imagen: 'https://lamatanza.gov.ar/resources/news/1059.JPG',
    imagenAlt: 'Vista aérea de una obra de infraestructura en La Matanza',
    fuenteImagen: 'Municipio de La Matanza',
    fuenteUrl: 'https://lamatanza.gov.ar/',
  },
  {
    nombre: 'Escrutinio 2027',
    numero: '04',
    icono: '✓',
    descripcion:
      'Participación electoral, establecimientos, mesas y resultados.',
    color: 'escrutinio',
    etiqueta: 'PRÓXIMA ELECCIÓN',
    fondo: '2027',
    imagen:
      'https://cloudfront-us-east-1.images.arcpublishing.com/infobae/24PDOKERHZDEFPQHUU5SOTOLLA.jpg',
    imagenAlt: 'Aula escolar vacía con pupitres, sin personas',
    fuenteImagen: 'Infobae',
    fuenteUrl:
      'https://www.infobae.com/educacion/2020/11/08/como-fue-que-llegamos-a-noviembre-sin-clases-presenciales-5-razones-que-explican-por-que-deben-volver-cuanto-antes/',
  },
];

function App() {
  const [subseccionHistorico, setSubseccionHistorico] = useState('Elecciones');
  const [mostrarRestablecerPassword, setMostrarRestablecerPassword] =
    useState(false);
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');
  const [errorRestablecer, setErrorRestablecer] = useState('');
  const [exitoRestablecer, setExitoRestablecer] = useState(false);
  const [cargandoRestablecer, setCargandoRestablecer] = useState(false);
  const [data, setData] = useState<any>(null);
  const [mostrarLogin, setMostrarLogin] = useState(false);
  const [emailLogin, setEmailLogin] = useState('');
  const [passwordLogin, setPasswordLogin] = useState('');
  const [errorLogin, setErrorLogin] = useState('');
  const [cargandoLogin, setCargandoLogin] = useState(false);
  const [circuitoSeleccionado, setCircuitoSeleccionado] = useState('');
  const [circuitoFicha, setCircuitoFicha] = useState<any>(null);
  const [busquedaCircuito, setBusquedaCircuito] = useState('');

  const [eleccion, setEleccion] = useState(
    '4019ba4e-d7cc-4fc5-92c8-da65eadae26f'
  );

  const [elecciones, setElecciones] = useState<any[]>([]);
  const [resultados, setResultados] = useState<any[]>([]);
  const [cargandoResultados, setCargandoResultados] = useState(false);
  const [errorResultados, setErrorResultados] = useState('');
  const [errorCarga, setErrorCarga] = useState('');
  const [seccion, setSeccion] = useState('Inicio');

  const [estadoSupabase, setEstadoSupabase] = useState<
    'comprobando' | 'conectado' | 'error'
  >('comprobando');
  const iniciarSesion = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setCargandoLogin(true);
    setErrorLogin('');

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailLogin.trim(),
      password: passwordLogin,
    });

    if (error || !data.user) {
      setErrorLogin('Correo o contraseña incorrectos.');
      setCargandoLogin(false);
      return;
    }

    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('id, nombre, rol, activo, debe_cambiar_password')
      .eq('id', data.user.id)
      .maybeSingle();

    if (errorPerfil || !perfil || !perfil.activo) {
      await supabase.auth.signOut();
      setErrorLogin('La cuenta no está habilitada para ingresar.');
      setCargandoLogin(false);
      return;
    }

    if (perfil.debe_cambiar_password) {
      await supabase.auth.signOut();
      setErrorLogin(
        'Esta cuenta debe cambiar su contraseña inicial. Estamos preparando ese paso.'
      );
      setCargandoLogin(false);
      return;
    }

    setMostrarLogin(false);
    setPasswordLogin('');
    setCargandoLogin(false);
  };
  const restablecerPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setErrorRestablecer('');
    setExitoRestablecer(false);

    if (nuevaPassword.length < 12) {
      setErrorRestablecer('La contraseña debe tener al menos 12 caracteres.');
      return;
    }

    if (nuevaPassword !== confirmarPassword) {
      setErrorRestablecer('Las contraseñas no coinciden.');
      return;
    }

    setCargandoRestablecer(true);

    const { error } = await supabase.auth.updateUser({
      password: nuevaPassword,
    });

    if (error) {
      setErrorRestablecer(error.message);
      setCargandoRestablecer(false);
      return;
    }

    await supabase.auth.signOut();

    setNuevaPassword('');
    setConfirmarPassword('');
    setCargandoRestablecer(false);
    setExitoRestablecer(true);
  };
  const solicitarRecuperacion = async () => {
    setErrorLogin('');
    setCargandoLogin(true);

    if (!emailLogin.trim()) {
      setErrorLogin('Ingresá tu correo electrónico.');
      setCargandoLogin(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(
      emailLogin.trim(),
      {
        redirectTo: 'https://vitejs-vite-zexamr7s.vercel.app/',
      }
    );

    if (error) {
      setErrorLogin('No se pudo enviar el correo. ' + error.message);
    } else {
      setErrorLogin(
        'Te enviamos un correo para recuperar tu contraseña. Revisá tu bandeja de entrada.'
      );
    }

    setCargandoLogin(false);
  };
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMostrarRestablecerPassword(true);
        setErrorRestablecer('');
        setExitoRestablecer(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);
  // CONEXIÓN CON SUPABASE
  useEffect(() => {
    const comprobarConexion = async () => {
      try {
        const { error } = await supabase
          .from('localidades')
          .select('id')
          .limit(1);

        setEstadoSupabase(error ? 'error' : 'conectado');
      } catch (error) {
        console.error('ERROR DE CONEXIÓN SUPABASE:', error);
        setEstadoSupabase('error');
      }
    };

    comprobarConexion();
  }, []);

  // CARGAR ELECCIONES
  useEffect(() => {
    const cargarElecciones = async () => {
      const { data, error } = await supabase
        .from('elections')
        .select('id, name, year, instance, election_date')
        .order('election_date', { ascending: false });

      if (error) {
        console.error('ERROR AL CARGAR ELECCIONES:', error);
        setErrorResultados(`Error al cargar elecciones: ${error.message}`);
        return;
      }

      setElecciones(data || []);

      if (data?.length && !data.some((item) => item.id === eleccion)) {
        setEleccion(data[0].id);
      }
    };

    cargarElecciones();
  }, []);

  // CARGAR RESULTADOS ELECTORALES
  useEffect(() => {
    if (!eleccion) return;

    let cancelado = false;

    const cargarResultados = async () => {
      setCargandoResultados(true);
      setErrorResultados('');

      const { data, error } = await supabase
        .from('historical_circuit_results')
        .select(
          `
          id,
          votes,
          percentage,
          pending_category,
          validation_status,
          source_file,
          circuits!inner ( id, code, election_id ),
          parties!inner ( name, color )
        `
        )
        .eq('circuits.election_id', eleccion);

      if (cancelado) return;

      if (error) {
        console.error('ERROR AL CARGAR RESULTADOS:', error);
        setErrorResultados(`Error al cargar resultados: ${error.message}`);
        setResultados([]);
      } else {
        setResultados(data || []);
      }

      setCargandoResultados(false);
    };

    cargarResultados();

    return () => {
      cancelado = true;
    };
  }, [eleccion]);

  // CARGAR GEOJSON
  useEffect(() => {
    fetch('/circuitos-la-matanza.geojson')
      .then((respuesta) => {
        if (!respuesta.ok) {
          throw new Error('No se encontró el archivo GeoJSON');
        }

        return respuesta.json();
      })
      .then((archivo) => {
        if (!archivo.features?.length) {
          throw new Error('El archivo no contiene circuitos');
        }

        setData(archivo);
      })
      .catch((error) => setErrorCarga(error.message));
  }, []);

  // LISTADO DE CIRCUITOS
  const circuitosDisponibles = useMemo(() => {
    if (!data?.features) return [];

    const circuitos = data.features
      .map((feature: any) => ({
        codigo: String(feature.properties?.circuito ?? ''),
        feature,
      }))
      .filter((item: any) => item.codigo !== '')
      .sort((a: any, b: any) =>
        a.codigo.localeCompare(b.codigo, 'es', { numeric: true })
      );

    return circuitos.filter(
      (item: any, index: number, lista: any[]) =>
        lista.findIndex((otro: any) => otro.codigo === item.codigo) === index
    );
  }, [data]);

  const circuitosFiltrados = circuitosDisponibles.filter((item: any) =>
    item.codigo.toLowerCase().includes(busquedaCircuito.toLowerCase())
  );

  // RESULTADOS AGRUPADOS POR CIRCUITO
  const resultadosPorCircuito = useMemo(() => {
    const grupos: Record<string, any[]> = {};

    resultados.forEach((item) => {
      const codigo = item.circuits?.code;

      if (!codigo) return;

      if (!grupos[codigo]) grupos[codigo] = [];

      grupos[codigo].push(item);
    });

    return grupos;
  }, [resultados]);

  // RESULTADOS GENERALES
  const resultadosGenerales = useMemo(() => {
    const grupos: Record<string, any> = {};

    resultados.forEach((item) => {
      const nombre = item.parties?.name || 'Sin agrupación';

      if (!grupos[nombre]) {
        grupos[nombre] = {
          name: nombre,
          color: item.parties?.color || '#64748b',
          votes: 0,
          percentage: 0,
        };
      }

      grupos[nombre].votes += Number(item.votes || 0);
    });

    const total = (Object.values(grupos) as any[]).reduce(
      (suma: number, item: any) => suma + item.votes,
      0
    );

    return (Object.values(grupos) as any[])
      .map((item: any) => ({
        ...item,
        percentage: total ? (item.votes / total) * 100 : 0,
      }))
      .sort((a: any, b: any) => b.votes - a.votes);
  }, [resultados]);

  const totalGeneral = resultadosGenerales.reduce(
    (suma: number, item: any) => suma + item.votes,
    0
  );

  const ganadorGeneral: any = resultadosGenerales[0];

  const resultadosDelCircuito = circuitoSeleccionado
    ? resultadosPorCircuito[normalizarCodigoCircuito(circuitoSeleccionado)] ||
      []
    : [];

  const resultadosCircuitoOrdenados = [...resultadosDelCircuito].sort(
    (a, b) => Number(b.votes || 0) - Number(a.votes || 0)
  );

  const ganadorCircuito = resultadosCircuitoOrdenados[0];

  const totalCircuito = resultadosCircuitoOrdenados.reduce(
    (suma, item) => suma + Number(item.votes || 0),
    0
  );

  // GANADOR POR CIRCUITO
  const ganadorPorCodigo: Record<string, any> = useMemo(() => {
    const mapa: Record<string, any> = {};

    (Object.entries(resultadosPorCircuito) as [string, any[]][]).forEach(
      ([codigo, items]) => {
        const ordenados = [...items].sort(
          (a, b) => Number(b.votes || 0) - Number(a.votes || 0)
        );

        const ganador = ordenados[0];

        if (ganador) {
          const total = items.reduce(
            (suma, item) => suma + Number(item.votes || 0),
            0
          );

          mapa[codigo] = {
            name: ganador.parties?.name || 'Sin agrupación',
            color: ganador.parties?.color || '#64748b',
            votes: Number(ganador.votes || 0),
            percentage: total
              ? (Number(ganador.votes || 0) / total) * 100
              : Number(ganador.percentage || 0),
          };
        }
      }
    );

    return mapa;
  }, [resultadosPorCircuito]);

  // NAVEGACIÓN
  const irASeccion = (nombre: string) => {
    setSeccion(nombre);
    if (nombre === 'Histórico electoral') {
      setSubseccionHistorico('');
    }
    setCircuitoSeleccionado('');
    setCircuitoFicha(null);
    setBusquedaCircuito('');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const seleccionarCircuitoFicha = (feature: any) => {
    setCircuitoFicha(feature);
    setCircuitoSeleccionado(String(feature.properties?.circuito ?? ''));

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // SELECTOR DE ELECCIÓN
  const selectorEleccion = (
    <select
      className="selector-eleccion"
      value={eleccion}
      onChange={(e) => {
        setEleccion(e.target.value);
        setCircuitoSeleccionado('');
      }}
    >
      {elecciones.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );

  // PANEL DE RESULTADOS
  const panelResultados = (
    <aside className="panel-electoral">
      <div className="panel-electoral-cabecera">
        <div>
          <span className="sobretitulo">RESULTADOS ELECTORALES</span>

          <h2>
            {circuitoSeleccionado
              ? `Circuito ${circuitoSeleccionado}`
              : 'La Matanza'}
          </h2>

          <p>
            {circuitoSeleccionado
              ? 'Resultados de este circuito'
              : 'Resultado general · todos los circuitos'}
          </p>
        </div>

        {circuitoSeleccionado && (
          <button
            className="boton-secundario"
            onClick={() => setCircuitoSeleccionado('')}
          >
            Ver general
          </button>
        )}
      </div>

      {cargandoResultados ? (
        <div className="panel-mensaje">Cargando resultados...</div>
      ) : errorResultados ? (
        <div className="panel-mensaje error-texto">{errorResultados}</div>
      ) : resultados.length === 0 ? (
        <div className="panel-mensaje">
          No hay resultados disponibles para esta elección.
        </div>
      ) : (
        <>
          {circuitoSeleccionado ? (
            <>
              {ganadorCircuito && (
                <div
                  className="ganador-card"
                  style={{
                    borderLeftColor:
                      ganadorCircuito.parties?.color || '#64748b',
                  }}
                >
                  <span className="ganador-etiqueta">AGRUPACIÓN GANADORA</span>

                  <strong>{ganadorCircuito.parties?.name}</strong>

                  <div className="ganador-dato">
                    <b>{formatoNumero(Number(ganadorCircuito.votes || 0))}</b>

                    <span>
                      {totalCircuito
                        ? (
                            (Number(ganadorCircuito.votes || 0) /
                              totalCircuito) *
                            100
                          ).toFixed(2)
                        : '0.00'}
                      %
                    </span>
                  </div>
                </div>
              )}

              <div className="lista-partidos">
                {resultadosCircuitoOrdenados.map((item, index) => {
                  const porcentaje = totalCircuito
                    ? (Number(item.votes || 0) / totalCircuito) * 100
                    : Number(item.percentage || 0);

                  return (
                    <div className="partido-resultado" key={item.id}>
                      <div className="partido-linea">
                        <span className="partido-nombre">
                          <i
                            style={{
                              background: item.parties?.color || '#64748b',
                            }}
                          />
                          {index + 1}. {item.parties?.name || 'Sin agrupación'}
                        </span>

                        <strong>{porcentaje.toFixed(2)}%</strong>
                      </div>

                      <div className="barra-fondo">
                        <div
                          className="barra-valor"
                          style={{
                            width: `${Math.min(100, porcentaje)}%`,
                            background: item.parties?.color || '#64748b',
                          }}
                        />
                      </div>

                      <span className="partido-votos">
                        {formatoNumero(Number(item.votes || 0))} votos
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="total-votos">
                <span>Total de votos registrados</span>
                <strong>{formatoNumero(totalCircuito)}</strong>
              </div>
            </>
          ) : (
            <>
              {ganadorGeneral && (
                <div
                  className="ganador-card"
                  style={{ borderLeftColor: ganadorGeneral.color }}
                >
                  <span className="ganador-etiqueta">
                    PRIMERA FUERZA DISTRITAL
                  </span>

                  <strong>{ganadorGeneral.name}</strong>

                  <div className="ganador-dato">
                    <b>{formatoNumero(ganadorGeneral.votes)}</b>
                    <span>{ganadorGeneral.percentage.toFixed(2)}%</span>
                  </div>
                </div>
              )}

              <div className="lista-partidos">
                {resultadosGenerales.map((item: any, index: number) => (
                  <div className="partido-resultado" key={item.name}>
                    <div className="partido-linea">
                      <span className="partido-nombre">
                        <i style={{ background: item.color }} />
                        {index + 1}. {item.name}
                      </span>

                      <strong>{item.percentage.toFixed(2)}%</strong>
                    </div>

                    <div className="barra-fondo">
                      <div
                        className="barra-valor"
                        style={{
                          width: `${Math.min(100, item.percentage)}%`,
                          background: item.color,
                        }}
                      />
                    </div>

                    <span className="partido-votos">
                      {formatoNumero(item.votes)} votos
                    </span>
                  </div>
                ))}
              </div>

              <div className="total-votos">
                <span>Total de votos registrados</span>
                <strong>{formatoNumero(totalGeneral)}</strong>
              </div>

              <p className="ayuda-circuito">
                Seleccioná un circuito en el mapa para ver su resultado
                individual.
              </p>
            </>
          )}
        </>
      )}

      <div className="aviso-datos">
        <strong>Información en revisión</strong>
        <span>
          Los registros históricos cargados todavía deben ser contrastados y
          validados con sus fuentes.
        </span>
      </div>
    </aside>
  );

  // MÓDULO HISTÓRICO ELECTORAL
  const bloqueMapaHistorico = (
    <section className="seccion-contenido seccion-electoral">
      <div className="seccion-cabecera electoral-cabecera">
        <div>
          <span className="sobretitulo">HISTORIA POLÍTICA</span>
          <h2>Histórico electoral</h2>
          <p>Resultados históricos por elección y circuito.</p>
        </div>

        {selectorEleccion}
      </div>

      <div className="electoral-layout">
        <div className="mapa-contenedor mapa-oscuro">
          <div className="mapa-barra mapa-barra-oscura">
            <div>
              <span className="mapa-punto" />
              <strong>La Matanza</strong>
              <span className="mapa-separador">/</span>
              <span>Buenos Aires, Argentina</span>
            </div>

            <span className="mapa-cantidad">
              {circuitosDisponibles.length} circuitos
            </span>
          </div>

          {data ? (
            <MapContainer
              center={[-34.75, -58.62]}
              zoom={10}
              scrollWheelZoom={true}
              className="mapa mapa-ampliado"
            >
              <AjustarMapa data={data} />

              {/* MAPA BASE: ESTILO OSCURO */}
              <TileLayer
                attribution="Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, OpenStreetMap contributors"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                maxZoom={16}
              />
              {/* POLÍGONOS DE LOS CIRCUITOS ELECTORALES */}
              <GeoJSON
                key={`${eleccion}-${resultados.length}`}
                data={data}
                style={(feature: any) => {
                  const codigo = normalizarCodigoCircuito(
                    String(feature?.properties?.circuito ?? '')
                  );

                  const ganador = ganadorPorCodigo[codigo];

                  return {
                    color: ganador?.color || '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillColor: ganador?.color || '#3498db',
                    fillOpacity: ganador ? 0.45 : 0.2,
                  };
                }}
                onEachFeature={(feature: any, layer: any) => {
                  const codigo = normalizarCodigoCircuito(
                    String(feature?.properties?.circuito ?? '')
                  );

                  layer.bindTooltip(`Circuito ${codigo}`, { sticky: true });

                  layer.on({
                    click: () => {
                      setCircuitoSeleccionado(codigo);
                    },
                  });
                }}
              />
            </MapContainer>
          ) : (
            <div className="cargando">
              {errorCarga || 'Cargando cartografía electoral...'}
            </div>
          )}

          <div className="mapa-pie-oscuro">
            <span>Color: agrupación ganadora</span>
            <span>Intensidad: porcentaje obtenido</span>
          </div>
        </div>

        {panelResultados}
      </div>

      <div className="leyenda-partidos">
        <strong>Referencias de agrupaciones</strong>

        {resultadosGenerales.map((item: any) => (
          <span key={item.name}>
            <i style={{ background: item.color }} />
            {item.name}
          </span>
        ))}

        {resultadosGenerales.length === 0 && (
          <span>Los colores aparecerán al cargar los resultados.</span>
        )}
      </div>
    </section>
  );

  // MÓDULO CIRCUITOS ELECTORALES
  // MÓDULO CIRCUITOS ELECTORALES
  const bloqueCircuitos = (
    <section className="circuitos-dashboard">
      {!circuitoFicha ? (
        <>
          <div className="circuitos-hero">
            <div>
              <span className="sobretitulo">ORGANIZACIÓN TERRITORIAL</span>

              <h1>Circuitos electorales</h1>

              <p>
                Explorá los circuitos electorales de La Matanza. Seleccioná uno
                para consultar su información territorial.
              </p>
            </div>

            <div className="circuitos-total">
              <strong>{circuitosDisponibles.length}</strong>
              <span>Circuitos identificados</span>
            </div>
          </div>

          <div className="circuitos-buscador">
            <span>⌕</span>

            <input
              type="text"
              placeholder="Buscar por número de circuito..."
              value={busquedaCircuito}
              onChange={(e) => setBusquedaCircuito(e.target.value)}
            />

            {busquedaCircuito && (
              <button onClick={() => setBusquedaCircuito('')}>Limpiar</button>
            )}
          </div>

          <div className="circuitos-mapa-card">
            <div className="circuitos-mapa-titulo">
              <div>
                <span className="sobretitulo">VISTA TERRITORIAL</span>
                <h2>Mapa de circuitos</h2>
                <p>Hacé clic sobre un circuito para abrir su ficha.</p>
              </div>

              <span className="circuitos-mapa-contador">
                {circuitosDisponibles.length} circuitos
              </span>
            </div>

            {data ? (
              <MapContainer
                center={[-34.75, -58.62]}
                zoom={10}
                scrollWheelZoom
                className="mapa mapa-circuitos-general"
              >
                <AjustarMapa data={data} />

                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  maxZoom={19}
                />

                <GeoJSON
                  key="mapa-general-circuitos"
                  data={data}
                  style={() => ({
                    color: '#ffffff',
                    weight: 1.5,
                    fillColor: '#2686d8',
                    fillOpacity: 0.55,
                  })}
                  onEachFeature={(feature: any, layer: any) => {
                    const codigo = String(
                      feature.properties?.circuito ?? 'Sin código'
                    );

                    layer.bindTooltip(`Circuito ${codigo}`);

                    layer.on({
                      click: () => seleccionarCircuitoFicha(feature),

                      mouseover: (evento: any) => {
                        evento.target.setStyle({
                          fillColor: '#13b8a6',
                          fillOpacity: 0.9,
                          weight: 3,
                        });
                      },

                      mouseout: (evento: any) => {
                        evento.target.setStyle({
                          color: '#ffffff',
                          weight: 1.5,
                          fillColor: '#2686d8',
                          fillOpacity: 0.55,
                        });
                      },
                    });
                  }}
                />
              </MapContainer>
            ) : (
              <div className="cargando">
                {errorCarga || 'Cargando mapa de circuitos...'}
              </div>
            )}
          </div>

          <div className="circuitos-listado-titulo">
            <div>
              <span className="sobretitulo">DIRECTORIO TERRITORIAL</span>

              <h2>Todos los circuitos</h2>
            </div>

            <span>{circuitosFiltrados.length} resultados</span>
          </div>

          <div className="circuitos-grid">
            {circuitosFiltrados.map((item: any) => (
              <button
                key={item.codigo}
                className="circuito-card"
                onClick={() => seleccionarCircuitoFicha(item.feature)}
              >
                <span className="circuito-card-icono">⌖</span>

                <span className="circuito-card-etiqueta">
                  CIRCUITO ELECTORAL
                </span>

                <strong>{item.codigo}</strong>

                <span className="circuito-card-link">
                  Consultar información <b>↗</b>
                </span>
              </button>
            ))}
          </div>

          {circuitosFiltrados.length === 0 && (
            <div className="circuitos-vacio">
              No encontramos circuitos con ese código.
            </div>
          )}
        </>
      ) : (
        <div className="ficha-circuito">
          <button
            className="ficha-volver"
            onClick={() => {
              setCircuitoFicha(null);
              setCircuitoSeleccionado('');
            }}
          >
            ← Volver a todos los circuitos
          </button>

          <div className="ficha-hero">
            <span className="sobretitulo">FICHA TERRITORIAL</span>

            <h1>Circuito {String(circuitoFicha.properties?.circuito ?? '')}</h1>

            <p>
              Información territorial y electoral del circuito seleccionado.
            </p>
          </div>

          <div className="ficha-mapa-contenedor">
            <div className="ficha-seccion-titulo">
              <h2>Ubicación geográfica</h2>
              <span>Mapa del circuito seleccionado</span>
            </div>

            <MapContainer
              key={`ficha-${circuitoFicha.properties?.circuito}`}
              bounds={L.geoJSON(circuitoFicha).getBounds()}
              scrollWheelZoom
              className="mapa mapa-ficha"
            >
              <AjustarMapa data={circuitoFicha} />

              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />

              <GeoJSON
                data={circuitoFicha}
                style={{
                  color: '#ffffff',
                  weight: 2,
                  fillColor: '#168bca',
                  fillOpacity: 0.65,
                }}
              />
            </MapContainer>
          </div>

          <div className="ficha-seccion-titulo">
            <span className="sobretitulo">INFORMACIÓN DEL CIRCUITO</span>
            <h2>Datos generales</h2>
          </div>

          <div className="ficha-datos-grid">
            {[
              ['Localidades', 'Pendiente de carga'],
              ['Barrios', 'Pendiente de carga'],
              ['Electores', 'Pendiente de carga'],
              ['Establecimientos', 'Pendiente de carga'],
              ['Mesas electorales', 'Pendiente de carga'],
              ['Información territorial', 'Pendiente de carga'],
            ].map(([titulo, valor]) => (
              <div className="ficha-dato-card" key={titulo}>
                <span>{titulo}</span>
                <strong>{valor}</strong>
              </div>
            ))}
          </div>

          <div className="ficha-seccion-titulo">
            <span className="sobretitulo">HISTORIA POLÍTICA</span>
            <h2>Resultados electorales</h2>
          </div>

          <div className="ficha-historico">
            <p>
              Los resultados históricos de este circuito se encuentran en el
              módulo Histórico electoral. Próximamente incorporaremos aquí su
              consulta directa por año y categoría.
            </p>

            <button
              onClick={() => {
                setCircuitoFicha(null);
                irASeccion('Histórico electoral');
                setCircuitoSeleccionado(
                  String(circuitoFicha.properties?.circuito ?? '')
                );
              }}
            >
              Consultar histórico electoral →
            </button>
          </div>
        </div>
      )}
    </section>
  );

  // NAVEGACIÓN INTERNA DE HISTÓRICO ELECTORAL
  const bloqueHistorico = (
    <section className="historico-principal">
      {!subseccionHistorico ? (
        <>
          <div className="historico-portada">
            <span className="sobretitulo">OBSERVATORIO LA MATANZA</span>

            <h1>Histórico electoral</h1>

            <p>
              Consultá la historia electoral del distrito, sus resultados y su
              organización territorial.
            </p>
          </div>

          <div className="historico-opciones">
            <button
              className="historico-opcion"
              onClick={() => setSubseccionHistorico('Elecciones')}
            >
              <span className="historico-opcion-icono">▤</span>

              <span className="historico-opcion-texto">
                <strong>Elecciones</strong>
                <small>
                  Resultados electorales, candidatos, mapas históricos y
                  comparaciones.
                </small>
              </span>

              <span className="historico-opcion-flecha">→</span>
            </button>

            <button
              className="historico-opcion"
              onClick={() => setSubseccionHistorico('Circuitos electorales')}
            >
              <span className="historico-opcion-icono">⌖</span>

              <span className="historico-opcion-texto">
                <strong>Circuitos electorales</strong>
                <small>Mapas, límites, escuelas y fichas territoriales.</small>
              </span>

              <span className="historico-opcion-flecha">→</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            className="historico-volver"
            onClick={() => setSubseccionHistorico('')}
          >
            ← Volver a Histórico electoral
          </button>

          {subseccionHistorico === 'Elecciones'
            ? bloqueMapaHistorico
            : bloqueCircuitos}
        </>
      )}
    </section>
  );

  const seccionActual = secciones.find((item) => item.nombre === seccion);

  return (
    <div className="app">
      <main className="contenido">
        <header className="encabezado">
          <button
            className="marca marca-boton"
            onClick={() => irASeccion('Inicio')}
          >
            <span className="logo">OLM</span>

            <span className="marca-texto">
              <strong>OBSERVATORIO</strong>
              <span>LA MATANZA</span>
            </span>
          </button>

          <div className="encabezado-derecha">
            <button
              className="boton-login-header"
              onClick={() => {
                setErrorLogin('');
                setMostrarLogin(true);
              }}
            >
              <span aria-hidden="true">↪</span>
              Iniciar sesión
            </button>
            <span className="estado-header">
              <i className={`estado-punto ${estadoSupabase}`} />

              {estadoSupabase === 'conectado'
                ? 'Datos conectados'
                : estadoSupabase === 'comprobando'
                ? 'Conectando...'
                : 'Conexión pendiente'}
            </span>

            {seccion !== 'Inicio' && (
              <button
                className="boton-volver-header"
                onClick={() => irASeccion('Inicio')}
              >
                ← Inicio
              </button>
            )}
          </div>
        </header>

        {seccion === 'Inicio' ? (
          <>
            {/* PRESENTACIÓN INSTITUCIONAL */}
            <section className="portada-hero">
              <div className="hero-contenido">
                <span className="hero-etiqueta">
                  OBSERVATORIO · LA MATANZA · PROVINCIA DE BUENOS AIRES
                </span>

                <h1>
                  La Matanza, <span>en datos.</span>
                </h1>

                <p>
                  Un espacio de consulta pública para conocer la historia
                  electoral, la vida política y la realidad social y territorial
                  del distrito.
                </p>

                <div className="hero-pie">
                  <span className="hero-punto" />
                  INFORMACIÓN PÚBLICA · TERRITORIO · ANÁLISIS
                </div>
              </div>

              <img
                className="hero-sol-mayo"
                src="/sol-de-mayo-transparente.png"
                alt="Sol de Mayo argentino"
              />
            </section>

            {/* CUERPO DE LA PORTADA: NAVEGACIÓN A LA IZQUIERDA */}
            <section className="portada-principal">
              <aside className="menu-secciones">
                <div className="menu-secciones-encabezado">
                  <span className="sobretitulo">CONSULTA POR ÁREA</span>
                  <h2>Explorá el Observatorio</h2>
                  <p>
                    Elegí una sección para acceder a sus mapas, datos y
                    herramientas de consulta.
                  </p>
                </div>

                <nav aria-label="Secciones principales del Observatorio">
                  {secciones.map((item) => (
                    <button
                      key={item.numero}
                      className={`menu-seccion menu-seccion-${item.color}`}
                      onClick={() => irASeccion(item.nombre)}
                    >
                      <span className="menu-seccion-imagen-marco">
                        <img
                          className="menu-seccion-imagen"
                          src={item.imagen}
                          alt={item.imagenAlt}
                          loading="lazy"
                        />
                      </span>

                      <span className="menu-seccion-texto">
                        <small>{item.etiqueta}</small>
                        <strong>{item.nombre}</strong>
                        <span className="menu-seccion-descripcion">
                          {item.descripcion}
                        </span>
                      </span>

                      <span className="menu-seccion-derecha">
                        <span className="menu-seccion-numero">
                          {item.numero}
                        </span>
                        <span className="menu-seccion-flecha">→</span>
                      </span>
                    </button>
                  ))}
                </nav>

                <div className="menu-creditos">
                  <span>Fotografías de referencia:</span>
                  {secciones.map((item) => (
                    <a
                      key={item.numero}
                      href={item.fuenteUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`Fuente de imagen: ${item.fuenteImagen}`}
                    >
                      {item.fuenteImagen}
                    </a>
                  ))}
                </div>
              </aside>

              {/* PRESENTACIÓN DEL OBSERVATORIO */}
              <div className="portada-institucional">
                <section className="portada-intro">
                  <span className="sobretitulo">
                    UN OBSERVATORIO PARA EL DISTRITO
                  </span>

                  <h2>Un distrito. Múltiples dimensiones.</h2>

                  <p>
                    La Matanza es un territorio extenso y diverso, con una
                    historia política, electoral, social y productiva propia.
                    Este observatorio reúne información para facilitar su
                    consulta, comparación y análisis.
                  </p>

                  <div className="conexion-resumen">
                    <i className={`estado-punto ${estadoSupabase}`} />
                    {estadoSupabase === 'conectado'
                      ? 'Conexión de datos activa'
                      : estadoSupabase === 'comprobando'
                      ? 'Verificando conexión'
                      : 'Conexión no disponible'}
                  </div>
                </section>

                <div className="portada-institucional-info">
                  <span className="institucional-linea" />

                  <span className="sobretitulo">INFORMACIÓN PÚBLICA</span>

                  <h3>
                    Conocer el territorio también es una forma de comprender sus
                    desafíos y transformaciones.
                  </h3>

                  <p>
                    El Observatorio La Matanza propone un espacio organizado
                    para consultar antecedentes electorales, representación
                    política, indicadores distritales y herramientas de
                    seguimiento de los próximos procesos electorales.
                  </p>

                  <div className="institucional-datos">
                    <div>
                      <strong>18</strong>
                      <span>Circuitos electorales</span>
                    </div>

                    <div>
                      <strong>1</strong>
                      <span>Partido bonaerense</span>
                    </div>

                    <div>
                      <strong>2027</strong>
                      <span>Próximo ciclo electoral</span>
                    </div>
                  </div>
                </div>

                <div className="portada-nota">
                  <span className="portada-nota-marca">OLM</span>
                  <p>
                    Una herramienta en construcción. Los datos y registros se
                    irán incorporando y validando con sus fuentes
                    correspondientes.
                  </p>
                </div>
              </div>
            </section>

            {/* CIERRE INSTITUCIONAL */}
            <section className="portada-pie">
              <div>
                <span className="sobretitulo">OBSERVATORIO LA MATANZA</span>
                <h2>Conocer para comprender.</h2>
              </div>
              <div className="portada-pie-sigla">OLM</div>
            </section>
          </>
        ) : seccion === 'Histórico electoral' ? (
          bloqueHistorico
        ) : seccion === 'Circuitos electorales' ? (
          bloqueCircuitos
        ) : (
          <section
            className={`pagina-modulo modulo-${seccionActual?.color || ''}`}
          >
            <div className="modulo-banner">
              <span className="modulo-numero">{seccionActual?.numero}</span>

              <span className="modulo-icono">{seccionActual?.icono}</span>

              <span className="modulo-etiqueta">{seccionActual?.etiqueta}</span>

              <h1>{seccion}</h1>

              <p>{seccionActual?.descripcion}</p>
            </div>

            <div className="modulo-contenido">
              <div className="modulo-en-construccion">
                <span className="construccion-icono">✦</span>

                <span className="sobretitulo">ÁREA EN DESARROLLO</span>

                <h2>Estamos preparando esta sección.</h2>

                <p>
                  Próximamente vas a encontrar aquí información, herramientas de
                  consulta y recursos del Observatorio La Matanza.
                </p>

                <button
                  className="volver-inicio"
                  onClick={() => irASeccion('Inicio')}
                >
                  Volver al panel principal
                </button>
              </div>
            </div>
          </section>
        )}
        {mostrarLogin && (
          <div className="login-overlay" onClick={() => setMostrarLogin(false)}>
            <section
              className="login-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="login-cerrar"
                onClick={() => setMostrarLogin(false)}
              >
                ×
              </button>

              <span className="login-logo">OLM</span>

              <h2>Iniciar sesión</h2>
              <p>Ingresá con tu cuenta del Observatorio.</p>

              <form onSubmit={iniciarSesion}>
                <label htmlFor="email-login">Correo electrónico</label>
                <input
                  id="email-login"
                  type="email"
                  value={emailLogin}
                  onChange={(e) => setEmailLogin(e.target.value)}
                  placeholder="nombre@correo.com"
                  required
                />

                <label htmlFor="password-login">Contraseña</label>
                <input
                  id="password-login"
                  type="password"
                  value={passwordLogin}
                  onChange={(e) => setPasswordLogin(e.target.value)}
                  placeholder="Ingresá tu contraseña"
                  required
                />
                <button
                  type="button"
                  onClick={solicitarRecuperacion}
                  disabled={cargandoLogin}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#087fbd',
                    cursor: 'pointer',
                    textAlign: 'right',
                    padding: '5px 0',
                    fontSize: '13px',
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>

                {errorLogin && <p className="login-error">{errorLogin}</p>}

                <button
                  type="submit"
                  className="login-submit"
                  disabled={cargandoLogin}
                >
                  {cargandoLogin ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>
            </section>
          </div>
        )}

        {mostrarRestablecerPassword && (
          <div className="login-overlay">
            <section className="login-modal">
              <span className="login-logo">OLM</span>

              {exitoRestablecer ? (
                <>
                  <h2>¡Contraseña actualizada!</h2>
                  <p>
                    Ya podés ingresar al Observatorio con tu nueva contraseña.
                  </p>

                  <button
                    type="button"
                    className="login-submit"
                    onClick={() => {
                      setMostrarRestablecerPassword(false);
                      setExitoRestablecer(false);
                      setMostrarLogin(true);
                    }}
                  >
                    Ir a iniciar sesión
                  </button>
                </>
              ) : (
                <>
                  <h2>Crear nueva contraseña</h2>
                  <p>Elegí una contraseña nueva para tu cuenta.</p>

                  <form onSubmit={restablecerPassword}>
                    <label htmlFor="nueva-password">Nueva contraseña</label>

                    <input
                      id="nueva-password"
                      type="password"
                      value={nuevaPassword}
                      onChange={(e) => setNuevaPassword(e.target.value)}
                      placeholder="Mínimo 12 caracteres"
                      minLength={12}
                      required
                    />

                    <label htmlFor="confirmar-password">
                      Confirmar contraseña
                    </label>

                    <input
                      id="confirmar-password"
                      type="password"
                      value={confirmarPassword}
                      onChange={(e) => setConfirmarPassword(e.target.value)}
                      placeholder="Repetí tu contraseña"
                      minLength={12}
                      required
                    />

                    {errorRestablecer && (
                      <p className="login-error">{errorRestablecer}</p>
                    )}

                    <button
                      type="submit"
                      className="login-submit"
                      disabled={cargandoRestablecer}
                    >
                      {cargandoRestablecer
                        ? 'Guardando...'
                        : 'Guardar nueva contraseña'}
                    </button>
                  </form>
                </>
              )}
            </section>
          </div>
        )}

        <footer className="footer">
          <span>© 2026 Observatorio La Matanza</span>
          <span>Datos · Territorio · Información</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
