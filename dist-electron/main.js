"use strict";
const electron = require("electron");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const axios = require("axios");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const xlsx = require("xlsx");
const dbPath = path__namespace.join(electron.app.getPath("userData"), "aiseven.db");
const db = new Database(dbPath);
db.prepare(`
  CREATE TABLE IF NOT EXISTS subjects (
    name TEXT PRIMARY KEY,
    semester TEXT,
    status TEXT DEFAULT 'activo',
    total_seconds INTEGER DEFAULT 0,
    folder_path TEXT
  )
`).run();
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1300,
    height: 950,
    backgroundColor: "#020617",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadURL("http://localhost:5173");
}
electron.app.whenReady().then(createWindow);
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.ipcMain.handle("obtener-ramos", () => db.prepare("SELECT * FROM subjects").all());
electron.ipcMain.handle("agregar-ramo", (_, { name, semester, folder_path }) => {
  try {
    const stmt = db.prepare("INSERT INTO subjects (name, semester, folder_path) VALUES (?, ?, ?)");
    stmt.run(name, semester, folder_path);
    return { success: true };
  } catch (e) {
    return { success: false, error: "El nombre ya existe." };
  }
});
electron.ipcMain.handle("eliminar-ramo", (_, name) => {
  db.prepare("DELETE FROM subjects WHERE name = ?").run(name);
  return true;
});
electron.ipcMain.on("actualizar-tiempo", (_, { name, seconds }) => {
  db.prepare("UPDATE subjects SET total_seconds = total_seconds + ? WHERE name = ?").run(seconds, name);
});
electron.ipcMain.handle("seleccionar-carpeta", async () => {
  const result = await electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.handle("procesar-archivos-carpeta", async (event, folderPath) => {
  try {
    if (!folderPath || !fs__namespace.existsSync(folderPath)) return "";
    const archivos = fs__namespace.readdirSync(folderPath).filter(
      (f) => [".pdf", ".docx", ".xlsx", ".xls"].includes(path__namespace.extname(f).toLowerCase()) && !f.startsWith("~$")
    );
    let completados = 0;
    const promesas = archivos.map(async (archivo) => {
      const ruta = path__namespace.join(folderPath, archivo);
      const ext = path__namespace.extname(archivo).toLowerCase();
      let texto = "";
      try {
        if (ext === ".pdf") {
          const parsePdf = typeof pdf === "function" ? pdf : pdf.default || pdf;
          const data = await parsePdf(fs__namespace.readFileSync(ruta));
          texto = `
[FILE: ${archivo}]
${data.text}
`;
        } else if (ext === ".docx") {
          const result = await mammoth.extractRawText({ path: ruta });
          texto = `
[FILE: ${archivo}]
${result.value}
`;
        } else if (ext === ".xlsx" || ext === ".xls") {
          const wb = xlsx.readFile(ruta);
          texto = `
[FILE: ${archivo}]
${xlsx.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])}
`;
        }
      } catch (e) {
      }
      completados++;
      event.sender.send("progreso-ingesta", { porcentaje: Math.round(completados / archivos.length * 100) });
      return texto;
    });
    const resultados = await Promise.all(promesas);
    return resultados.join("");
  } catch (e) {
    return "";
  }
});
electron.ipcMain.handle("consultar-ia-local", async (_, { pregunta, contexto }) => {
  try {
    const res = await axios.post("http://127.0.0.1:11434/api/generate", {
      model: "llama3.2:3b",
      prompt: `CONTEXTO:
${contexto.substring(0, 15e3)}

PREGUNTA:
${pregunta}`,
      stream: false
    });
    return res.data.response;
  } catch (e) {
    return "Error: Ollama no está respondiendo.";
  }
});
electron.ipcMain.handle("consultar-ia-nube", async (_, { pregunta, contexto, apiKey }) => {
  try {
    const res = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: `Contexto: ${contexto.substring(0, 5e3)}
Pregunta: ${pregunta}` }]
    }, { headers: { "Authorization": `Bearer ${apiKey}` } });
    return res.data.choices[0].message.content;
  } catch (e) {
    return "Error en conexión a la nube.";
  }
});
electron.ipcMain.handle("guardar-archivo-respuesta", async (_, { folderPath, contenido, tipo }) => {
  try {
    const filename = `${tipo}_${Date.now()}.txt`;
    fs__namespace.writeFileSync(path__namespace.join(folderPath, filename), contenido);
    return `Guardado en carpeta: ${filename}`;
  } catch (e) {
    return "Error al guardar.";
  }
});
