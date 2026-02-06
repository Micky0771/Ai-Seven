import React, { useState, useEffect } from 'react';
const { ipcRenderer } = window.require('electron');

interface Ramo {
  name: string;
  semester: string;
  total_seconds: number;
  folder_path: string;
}

function App() {
  const [ramos, setRamos] = useState<Ramo[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [nuevoRamo, setNuevoRamo] = useState({ name: '', semester: '', folder_path: '' });

  const cargarRamos = async () => setRamos(await ipcRenderer.invoke('obtener-ramos'));
  useEffect(() => { cargarRamos(); }, []);

  const seleccionarCarpeta = async () => {
    const path = await ipcRenderer.invoke('seleccionar-carpeta');
    if (path) setNuevoRamo({ ...nuevoRamo, folder_path: path });
  };

  const agregarRamo = async () => {
    if (!nuevoRamo.name || !nuevoRamo.folder_path) return alert("Completa los datos.");
    const res = await ipcRenderer.invoke('agregar-ramo', nuevoRamo);
    if (res.success) { setShowModal(false); setNuevoRamo({ name: '', semester: '', folder_path: '' }); cargarRamos(); }
    else alert(res.error);
  };

  const eliminarRamo = async (name: string) => {
    if (confirm(`¿Eliminar ${name}?`)) { await ipcRenderer.invoke('eliminar-ramo', name); cargarRamos(); }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-8 font-sans">
      <header className="mb-12 flex justify-between items-center">
        <div>
          <h1 className="text-5xl font-black italic tracking-tighter text-white">AISEVEN</h1>
          <p className="text-slate-500 text-xs tracking-widest uppercase">Ecosistema de Aprendizaje Local</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-blue-900/20">
          + Agregar Asignatura
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {ramos.map((ramo) => (
          <RamoCard key={ramo.name} ramo={ramo} onEliminar={eliminarRamo} />
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">Nueva Asignatura</h2>
            <input placeholder="Nombre del Ramo" className="w-full bg-slate-800 p-4 rounded-2xl mb-4 outline-none" 
                   onChange={e => setNuevoRamo({...nuevoRamo, name: e.target.value})} />
            <input placeholder="Semestre (ej: 4to Semestre)" className="w-full bg-slate-800 p-4 rounded-2xl mb-4 outline-none" 
                   onChange={e => setNuevoRamo({...nuevoRamo, semester: e.target.value})} />
            <button onClick={seleccionarCarpeta} className="w-full border border-dashed border-slate-700 p-4 rounded-2xl mb-6 text-slate-400 hover:border-blue-500 transition-all">
              {nuevoRamo.folder_path ? '📂 ' + nuevoRamo.folder_path.split('\\').pop() : '📁 Vincular Carpeta de Apuntes'}
            </button>
            <div className="flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 text-slate-500 font-bold">Cancelar</button>
              <button onClick={agregarRamo} className="flex-1 bg-blue-600 p-4 rounded-2xl font-bold">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RamoCard({ ramo, onEliminar }: { ramo: Ramo, onEliminar: (n: string) => void }) {
  const [tiempo, setTiempo] = useState(0); // Pomodoro local
  const [corriendo, setCorriendo] = useState(false);
  const [pregunta, setPregunta] = useState("");
  const [respuestaIA, setRespuestaIA] = useState("");
  const [esperandoIA, setEsperandoIA] = useState(false);
  const [modoNube, setModoNube] = useState(false);
  const [contexto, setContexto] = useState("");
  const [progreso, setProgreso] = useState(0);

  // Lógica de Pomodoro
  useEffect(() => {
    let interval: any;
    if (corriendo) {
      interval = setInterval(() => setTiempo(t => t + 1), 1000);
    } else if (tiempo > 0) {
      ipcRenderer.send('actualizar-tiempo', { name: ramo.name, seconds: tiempo });
      setTiempo(0);
    }
    return () => clearInterval(interval);
  }, [corriendo]);

  const cargarArchivos = async () => {
    setProgreso(1);
    ipcRenderer.on('progreso-ingesta', (_:any, d:any) => setProgreso(d.porcentaje));
    const txt = await ipcRenderer.invoke('procesar-archivos-carpeta', ramo.folder_path);
    setContexto(txt);
  };

  const ejecutarIA = async (tipo: string) => {
    if (!contexto) return alert("Indexa los archivos primero ⚡");
    setEsperandoIA(true);
    let q = pregunta;
    if (tipo === 'resumen') q = "Genera un resumen clave y estructurado.";
    if (tipo === 'test') q = "Crea un test de 3 preguntas de alternativa.";

    let res = "";
    if (modoNube) {
      if (!confirm("⚠️ Los datos saldrán de tu PC. ¿Continuar?")) { setEsperandoIA(false); return; }
      const key = prompt("API Key de OpenAI:");
      res = await ipcRenderer.invoke('consultar-ia-nube', { pregunta: q, contexto, apiKey: key });
    } else {
      res = await ipcRenderer.invoke('consultar-ia-local', { pregunta: q, contexto });
    }
    setRespuestaIA(res);
    setEsperandoIA(false);
  };

  const formatTime = (s: number) => {
    const total = ramo.total_seconds + s;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-[2rem] p-7 backdrop-blur-xl hover:border-blue-500/30 transition-all group">
      <div className="flex justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold">{ramo.name}</h3>
          <p className="text-blue-500 text-[10px] font-black uppercase tracking-widest">{ramo.semester}</p>
        </div>
        <button onClick={cargarArchivos} className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-all ${progreso === 100 ? 'bg-green-500' : 'bg-blue-600 animate-pulse'}`}>
          {progreso > 0 && progreso < 100 ? `${progreso}%` : '⚡'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Tiempo Total</p>
          <p className="text-xl font-mono text-white">{formatTime(tiempo)}</p>
        </div>
        <button onClick={() => setCorriendo(!corriendo)} className={`p-4 rounded-2xl font-bold transition-all ${corriendo ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-green-500/20 text-green-500 border border-green-500/30'}`}>
          {corriendo ? '⏹ DETENER' : '▶ ESTUDIAR'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => ejecutarIA('resumen')} className="flex-1 bg-slate-800 py-2 rounded-xl text-[10px] font-bold">RESUMEN</button>
        <button onClick={() => ejecutarIA('test')} className="flex-1 bg-slate-800 py-2 rounded-xl text-[10px] font-bold">TEST</button>
        <button onClick={() => setModoNube(!modoNube)} className={`px-4 py-2 rounded-xl text-[10px] font-bold ${modoNube ? 'bg-red-600' : 'bg-slate-800 text-slate-500'}`}>NUBE</button>
      </div>

      <div className="bg-slate-950 rounded-2xl p-4 h-48 overflow-y-auto mb-4 border border-slate-800 text-sm">
        {esperandoIA ? <div className="animate-pulse text-blue-500 font-bold">AiSeven está analizando...</div> : (respuestaIA || "Consulta tus archivos aquí.")}
      </div>

      <div className="relative">
        <input value={pregunta} onChange={e => setPregunta(e.target.value)} placeholder="¿Qué dudas tienes?" className="w-full bg-slate-800 p-4 rounded-2xl outline-none text-sm pr-12" />
        <button onClick={() => ejecutarIA('chat')} className="absolute right-2 top-2 bottom-2 px-4 bg-blue-600 rounded-xl">🚀</button>
      </div>

      <div className="flex justify-between mt-6">
        <button onClick={() => onEliminar(ramo.name)} className="text-[9px] text-red-500/50 hover:text-red-500 uppercase font-bold tracking-widest transition-all">Eliminar Ramo</button>
        {respuestaIA && <button onClick={async () => alert(await ipcRenderer.invoke('guardar-archivo-respuesta', { folderPath: ramo.folder_path, contenido: respuestaIA, tipo: 'Notas' }))} className="text-[9px] text-slate-600 hover:text-green-500 uppercase font-bold tracking-widest transition-all">Exportar PDF</button>}
      </div>
    </div>
  );
}

export default App;
