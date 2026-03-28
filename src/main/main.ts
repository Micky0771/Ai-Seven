import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import DatabaseManager from './database/DatabaseManager';
import OllamaManager from './ai/OllamaManager';
import ChromaManager from './ai/ChromaManager';
import DocumentProcessor from './ai/DocumentProcessor';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    show: false,
    autoHideMenuBar: true,
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      
      // Check AI services on startup
      setTimeout(() => {
        checkAIServices();
      }, 2000);
    }
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

// ========== HANDLERS IPC ==========

// 1. HANDLERS PARA ASIGNATURAS
ipcMain.handle('subjects:get', async () => {
  return DatabaseManager.getSubjects();
});

ipcMain.handle('subjects:create', async (_, name: string, semester: number, year: number) => {
  return DatabaseManager.addSubject(name, semester, year);
});

ipcMain.handle('subjects:update', async (_, id: string, updates: { name?: string; semester?: number; year?: number }) => {
  return DatabaseManager.updateSubject(id, updates);
});

ipcMain.handle('subjects:delete', async (_, id: string) => {
  return DatabaseManager.deleteSubject(id);
});

// 2. HANDLERS PARA DOCUMENTOS
ipcMain.handle('documents:process', async (_, filePath: string, subjectId: string) => {
  return DocumentProcessor.processDocument(filePath, subjectId);
});

ipcMain.handle('documents:getBySubject', async (_, subjectId: string) => {
  return DatabaseManager.getDocumentsBySubject(subjectId);
});

ipcMain.handle('documents:delete', async (_, id: string) => {
  return DatabaseManager.deleteDocument(id);
});

ipcMain.handle('documents:open', async (_, filePath: string) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 3. HANDLERS PARA CHAT Y IA
ipcMain.handle('ai:chat', async (_, { prompt, subjectId, useContext = true }) => {
  try {
    let context: string[] = [];
    
    if (useContext && subjectId) {
      // Buscar contexto relevante en ChromaDB
      const searchResults = await ChromaManager.search(prompt, { subjectId });
      context = searchResults.map(result => result.content);
    }
    
    // Generar respuesta con Ollama
    const response = await OllamaManager.generateResponse(prompt, context);
    
    // Guardar en historial
    if (subjectId) {
      // Guardar mensaje del usuario
      DatabaseManager.addChatMessage(subjectId, 'user', prompt);
      
      // Guardar respuesta del asistente
      const sources = context.length > 0 ? 
        Array.from(new Set(context.map(c => c.substring(0, 100)))) : 
        undefined;
      
      DatabaseManager.addChatMessage(
        subjectId, 
        'assistant', 
        response.content,
        sources
      );
    }
    
    return {
      success: true,
      response: response.content,
      model: response.model,
      duration: response.totalDuration,
      sources: context.length > 0 ? context.map((c, i) => ({
        id: i,
        preview: c.substring(0, 200) + '...'
      })) : []
    };
    
  } catch (error) {
    console.error('Chat error:', error);
    return {
      success: false,
      error: error.message,
      response: 'Error al procesar tu pregunta.'
    };
  }
});

ipcMain.handle('ai:check-health', async () => {
  const [ollamaAvailable, chromaAvailable] = await Promise.all([
    OllamaManager.checkAvailability(),
    ChromaManager.checkConnection()
  ]);
  
  return {
    ollama: ollamaAvailable,
    chroma: chromaAvailable,
    timestamp: Date.now()
  };
});

ipcMain.handle('ai:get-models', async () => {
  try {
    const models = await OllamaManager.listModels();
    return { success: true, models };
  } catch (error) {
    return { success: false, error: error.message, models: [] };
  }
});

ipcMain.handle('ai:set-model', async (_, modelName: string) => {
  try {
    OllamaManager.setModel(modelName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 4. HANDLERS PARA HISTORIAL DE CHAT
ipcMain.handle('chat:get-history', async (_, subjectId: string) => {
  return DatabaseManager.getChatHistory(subjectId);
});

ipcMain.handle('chat:clear-history', async (_, subjectId: string) => {
  return DatabaseManager.clearChatHistory(subjectId);
});

// 5. HANDLERS PARA ARCHIVOS
ipcMain.handle('files:select', async () => {
  if (!mainWindow) return { canceled: true };
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documentos', extensions: ['pdf', 'txt', 'md', 'docx', 'doc'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  });
  
  return {
    canceled: result.canceled,
    filePaths: result.filePaths
  };
});

ipcMain.handle('files:validate', async (_, filePath: string) => {
  return DocumentProcessor.validateDocument(filePath);
});

// 6. HANDLERS PARA ESTADÍSTICAS
ipcMain.handle('stats:get', async () => {
  const dbStats = DatabaseManager.getStats();
  const chromaStats = await ChromaManager.getStats();
  const aiHealth = await OllamaManager.checkAvailability();
  
  return {
    database: dbStats,
    vectorStore: chromaStats,
    ai: {
      available: aiHealth,
      model: OllamaManager.getModel()
    },
    timestamp: Date.now()
  };
});

// 7. HANDLERS PARA SISTEMA
ipcMain.handle('system:open-folder', async (_, folderPath?: string) => {
  try {
    const pathToOpen = folderPath || app.getPath('userData');
    await shell.openPath(pathToOpen);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('system:get-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    temp: app.getPath('temp')
  };
});

// ========== FUNCIONES DE INICIO ==========

async function checkAIServices() {
  if (!mainWindow) return;
  
  try {
    const health = await OllamaManager.checkAvailability(true);
    
    mainWindow.webContents.send('ai-health-update', {
      ollama: health,
      timestamp: Date.now()
    });
    
    if (!health) {
      console.warn('Ollama is not available. Make sure it is running on http://localhost:11434');
    }
    
  } catch (error) {
    console.error('Health check failed:', error);
  }
}

// ========== EVENTOS DE LA APLICACIÓN ==========

app.on('ready', () => {
  createWindow();
  
  // Inicializar servicios
  setTimeout(() => {
    ChromaManager.checkConnection().catch(console.error);
  }, 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  // Limpiar recursos
  try {
    // DatabaseManager.close();
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
});

// ========== HANDLERS DE ERRORES ==========

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  if (mainWindow) {
    mainWindow.webContents.send('global-error', {
      message: error.message,
      stack: error.stack
    });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});