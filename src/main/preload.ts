import { contextBridge, ipcRenderer } from 'electron';

// ========== API PARA ASIGNATURAS ==========
const subjectsAPI = {
  getSubjects: () => ipcRenderer.invoke('subjects:get'),
  createSubject: (name: string, semester: number, year: number) => 
    ipcRenderer.invoke('subjects:create', name, semester, year),
  updateSubject: (id: string, updates: any) => 
    ipcRenderer.invoke('subjects:update', id, updates),
  deleteSubject: (id: string) => ipcRenderer.invoke('subjects:delete', id)
};

// ========== API PARA DOCUMENTOS ==========
const documentsAPI = {
  processDocument: (filePath: string, subjectId: string) => 
    ipcRenderer.invoke('documents:process', filePath, subjectId),
  getDocuments: (subjectId: string) => 
    ipcRenderer.invoke('documents:getBySubject', subjectId),
  deleteDocument: (id: string) => ipcRenderer.invoke('documents:delete', id),
  openDocument: (filePath: string) => ipcRenderer.invoke('documents:open', filePath)
};

// ========== API PARA IA Y CHAT ==========
const aiAPI = {
  chat: (prompt: string, subjectId: string, useContext: boolean = true) => 
    ipcRenderer.invoke('ai:chat', { prompt, subjectId, useContext }),
  checkHealth: () => ipcRenderer.invoke('ai:check-health'),
  getModels: () => ipcRenderer.invoke('ai:get-models'),
  setModel: (modelName: string) => ipcRenderer.invoke('ai:set-model', modelName)
};

// ========== API PARA CHAT HISTORY ==========
const chatAPI = {
  getHistory: (subjectId: string) => ipcRenderer.invoke('chat:get-history', subjectId),
  clearHistory: (subjectId: string) => ipcRenderer.invoke('chat:clear-history', subjectId)
};

// ========== API PARA ARCHIVOS ==========
const filesAPI = {
  selectFiles: () => ipcRenderer.invoke('files:select'),
  validateFile: (filePath: string) => ipcRenderer.invoke('files:validate', filePath)
};

// ========== API PARA ESTADÍSTICAS ==========
const statsAPI = {
  getStats: () => ipcRenderer.invoke('stats:get')
};

// ========== API PARA SISTEMA ==========
const systemAPI = {
  openFolder: (folderPath?: string) => ipcRenderer.invoke('system:open-folder', folderPath),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info')
};

// ========== EVENTOS ==========
const eventsAPI = {
  onAIHealthUpdate: (callback: (health: any) => void) => {
    ipcRenderer.on('ai-health-update', (_, health) => callback(health));
    return () => ipcRenderer.removeAllListeners('ai-health-update');
  },
  onGlobalError: (callback: (error: any) => void) => {
    ipcRenderer.on('global-error', (_, error) => callback(error));
    return () => ipcRenderer.removeAllListeners('global-error');
  }
};

// ========== EXPOSICIÓN AL RENDERER ==========
contextBridge.exposeInMainWorld('electronAPI', {
  subjects: subjectsAPI,
  documents: documentsAPI,
  ai: aiAPI,
  chat: chatAPI,
  files: filesAPI,
  stats: statsAPI,
  system: systemAPI,
  events: eventsAPI
});

// Tipos TypeScript
declare global {
  interface Window {
    electronAPI: {
      subjects: typeof subjectsAPI;
      documents: typeof documentsAPI;
      ai: typeof aiAPI;
      chat: typeof chatAPI;
      files: typeof filesAPI;
      stats: typeof statsAPI;
      system: typeof systemAPI;
      events: typeof eventsAPI;
    };
  }
}