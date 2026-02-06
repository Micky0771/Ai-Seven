import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// --- LIBRERÍAS DE PROCESAMIENTO ---
const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');

// --- CONFIGURACIÓN DE BASE DE DATOS ---
const dbPath = path.join(app.getPath('userData'), 'aiseven.db');
const db = new Database(dbPath);

// Inicialización de la tabla según el anteproyecto
db.prepare(`
  CREATE TABLE IF NOT EXISTS subjects (
    name TEXT PRIMARY KEY,
    semester TEXT,
    status TEXT DEFAULT 'activo',
    total_seconds INTEGER DEFAULT 0,
    folder_path TEXT
  )
`).run();

// --- GESTIÓN DE VENTANA ---
function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 950,
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadURL('http://localhost:5173');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- COMUNICACIÓN IPC ---

// 1. Gestión de Ramos (CRUD)
ipcMain.handle('obtener-ramos', () => db.prepare("SELECT * FROM subjects").all());

ipcMain.handle('agregar-ramo', (_, { name, semester, folder_path }) => {
  try {
    const stmt = db.prepare("INSERT INTO subjects (name, semester, folder_path) VALUES (?, ?, ?)");
    stmt.run(name, semester, folder_path);
    return { success: true };
  } catch (e) { return { success: false, error: "El nombre ya existe." }; }
});

ipcMain.handle('eliminar-ramo', (_, name) => {
  db.prepare("DELETE FROM subjects WHERE name = ?").run(name);
  return true;
});

ipcMain.on('actualizar-tiempo', (_, { name, seconds }) => {
  db.prepare("UPDATE subjects SET total_seconds = total_seconds + ? WHERE name = ?").run(seconds, name);
});

// 2. Sistema de Archivos y RAG Paralelo
ipcMain.handle('seleccionar-carpeta', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('procesar-archivos-carpeta', async (event, folderPath: string) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) return "";
    const archivos = fs.readdirSync(folderPath).filter(f => 
      ['.pdf', '.docx', '.xlsx', '.xls'].includes(path.extname(f).toLowerCase()) && !f.startsWith('~$')
    );
    
    let completados = 0;
    const promesas = archivos.map(async (archivo) => {
      const ruta = path.join(folderPath, archivo);
      const ext = path.extname(archivo).toLowerCase();
      let texto = "";
      try {
        if (ext === '.pdf') {
          const parsePdf = (typeof pdf === 'function') ? pdf : (pdf.default || pdf);
          const data = await parsePdf(fs.readFileSync(ruta));
          texto = `\n[FILE: ${archivo}]\n${data.text}\n`;
        } else if (ext === '.docx') {
          const result = await mammoth.extractRawText({ path: ruta });
          texto = `\n[FILE: ${archivo}]\n${result.value}\n`;
        } else if (ext === '.xlsx' || ext === '.xls') {
          const wb = xlsx.readFile(ruta);
          texto = `\n[FILE: ${archivo}]\n${xlsx.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])}\n`;
        }
      } catch (e) {}
      completados++;
      event.sender.send('progreso-ingesta', { porcentaje: Math.round((completados/archivos.length)*100) });
      return texto;
    });
    const resultados = await Promise.all(promesas);
    return resultados.join("");
  } catch (e) { return ""; }
});

// 3. Motores de IA (Local y Nube)
ipcMain.handle('consultar-ia-local', async (_, { pregunta, contexto }) => {
  try {
    const res = await axios.post('http://127.0.0.1:11434/api/generate', {
      model: 'llama3.2:3b',
      prompt: `CONTEXTO:\n${contexto.substring(0, 15000)}\n\nPREGUNTA:\n${pregunta}`,
      stream: false
    });
    return res.data.response;
  } catch (e) { return "Error: Ollama no está respondiendo."; }
});

ipcMain.handle('consultar-ia-nube', async (_, { pregunta, contexto, apiKey }) => {
  try {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Contexto: ${contexto.substring(0, 5000)}\nPregunta: ${pregunta}` }]
    }, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    return res.data.choices[0].message.content;
  } catch (e) { return "Error en conexión a la nube."; }
});

ipcMain.handle('guardar-archivo-respuesta', async (_, { folderPath, contenido, tipo }) => {
  try {
    const filename = `${tipo}_${Date.now()}.txt`;
    fs.writeFileSync(path.join(folderPath, filename), contenido);
    return `Guardado en carpeta: ${filename}`;
  } catch (e) { return "Error al guardar."; }
});


