import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Subject {
    id: string;
    name: string;
    semester: number;
    year: number;
    createdAt: number;
}

export interface Document {
    id: string;
    fileName: string;
    fileType: string;
    filePath: string;
    indexedAt: number;
    metadata?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    sources?: any[];
    model?: string;
    duration?: number;
}

export interface AIHealth {
    ollama: boolean;
    chroma: boolean;
    timestamp: number;
    }

export interface AppStats {
    database: {
    documents: number;
    subjects: number;
    chatMessages: number;
    recentDocuments: any[];
    };
    vectorStore: {
    totalChunks: number;
    subjects: Record<string, number>;
    documentTypes: Record<string, number>;
    };
    ai: {
    available: boolean;
    model: string;
    };
    timestamp: number;
}

interface AppState {
  // Estado de la aplicación
    currentSubject: Subject | null;
    subjects: Subject[];
    documents: Document[];
    chatMessages: ChatMessage[];
    aiHealth: AIHealth;
    stats: AppStats | null;
    
  // Estado de UI
    isProcessing: boolean;
    isLoading: boolean;
    error: string | null;
    sidebarOpen: boolean;
    darkMode: boolean;
    
  // Acciones
    setCurrentSubject: (subject: Subject | null) => void;
    setSidebarOpen: (open: boolean) => void;
    setDarkMode: (darkMode: boolean) => void;
    
  // Acciones asíncronas
    loadSubjects: () => Promise<void>;
    createSubject: (name: string, semester?: number, year?: number) => Promise<string>;
    updateSubject: (id: string, updates: Partial<Subject>) => Promise<boolean>;
    deleteSubject: (id: string) => Promise<boolean>;
    
    loadDocuments: (subjectId: string) => Promise<void>;
    processDocument: (filePath: string, subjectId: string) => Promise<boolean>;
    deleteDocument: (id: string) => Promise<boolean>;
    
    sendMessage: (content: string, useContext?: boolean) => Promise<void>;
    loadChatHistory: (subjectId: string) => Promise<void>;
    clearChatHistory: (subjectId: string) => Promise<void>;
    
    checkAIHealth: () => Promise<AIHealth>;
    loadStats: () => Promise<void>;
    
    selectFiles: () => Promise<string[]>;
    validateFile: (filePath: string) => Promise<any>;
    
    setError: (error: string | null) => void;
    clearError: () => void;
}

export const useAppStore = create<AppState>()(
    persist(
    (set, get) => ({
      // Estado inicial
        currentSubject: null,
        subjects: [],
        documents: [],
        chatMessages: [],
        aiHealth: { ollama: false, chroma: false, timestamp: 0 },
        stats: null,
        
        isProcessing: false,
        isLoading: false,
        error: null,
        sidebarOpen: true,
        darkMode: false,
        
      // ========== SETTERS SIMPLES ==========
        setCurrentSubject: (subject) => {
        set({ currentSubject: subject });
        if (subject) {
            get().loadDocuments(subject.id);
            get().loadChatHistory(subject.id);
        }
        },
        
        setSidebarOpen: (open) => set({ sidebarOpen: open }),
        setDarkMode: (darkMode) => set({ darkMode }),
        
      // ========== ASIGNATURAS ==========
        loadSubjects: async () => {
        set({ isLoading: true, error: null });
        try {
            const subjects = await window.electronAPI.subjects.getSubjects();
            set({ subjects, isLoading: false });
        } catch (error) {
            set({ error: `Error loading subjects: ${error.message}`, isLoading: false });
        }
        },
        
        createSubject: async (name, semester = 1, year = 2024) => {
        set({ error: null });
        try {
            const id = await window.electronAPI.subjects.createSubject(name, semester, year);
            await get().loadSubjects();
            return id;
        } catch (error) {
            set({ error: `Error creating subject: ${error.message}` });
            throw error;
        }
        },
        
        updateSubject: async (id, updates) => {
        set({ error: null });
        try {
            const success = await window.electronAPI.subjects.updateSubject(id, updates);
            if (success) {
            await get().loadSubjects();
            
            // Actualizar currentSubject si es el mismo
            const { currentSubject } = get();
            if (currentSubject && currentSubject.id === id) {
                set({
                currentSubject: { ...currentSubject, ...updates }
                });
            }
            }
            return success;
        } catch (error) {
            set({ error: `Error updating subject: ${error.message}` });
            return false;
        }
        },
        
        deleteSubject: async (id) => {
        set({ error: null });
        try {
            const success = await window.electronAPI.subjects.deleteSubject(id);
            if (success) {
            await get().loadSubjects();
            
            // Si el subject actual fue eliminado, limpiarlo
            const { currentSubject } = get();
            if (currentSubject && currentSubject.id === id) {
                set({ currentSubject: null, documents: [], chatMessages: [] });
            }
            }
            return success;
        } catch (error) {
            set({ error: `Error deleting subject: ${error.message}` });
            return false;
        }
        },
        
      // ========== DOCUMENTOS ==========
        loadDocuments: async (subjectId) => {
        set({ isLoading: true });
        try {
            const documents = await window.electronAPI.documents.getDocuments(subjectId);
            set({ documents, isLoading: false });
        } catch (error) {
            set({ error: `Error loading documents: ${error.message}`, isLoading: false });
        }
        },
        
        processDocument: async (filePath, subjectId) => {
        set({ isProcessing: true, error: null });
        try {
            const result = await window.electronAPI.documents.processDocument(filePath, subjectId);
            
            if (result.success) {
            await get().loadDocuments(subjectId);
            set({ isProcessing: false });
            return true;
            } else {
            set({ error: `Processing failed: ${result.error}`, isProcessing: false });
            return false;
            }
        } catch (error) {
            set({ error: `Error processing document: ${error.message}`, isProcessing: false });
            return false;
        }
        },
        
        deleteDocument: async (id) => {
        set({ error: null });
        try {
            const success = await window.electronAPI.documents.deleteDocument(id);
            if (success) {
            const { currentSubject } = get();
            if (currentSubject) {
                await get().loadDocuments(currentSubject.id);
            }
            }
            return success;
        } catch (error) {
            set({ error: `Error deleting document: ${error.message}` });
            return false;
        }
        },
        
      // ========== CHAT Y IA ==========
        sendMessage: async (content, useContext = true) => {
        const { currentSubject } = get();
        if (!currentSubject) {
            set({ error: 'No subject selected' });
            return;
        }
        
        // Añadir mensaje del usuario al estado
        const userMessage: ChatMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now()
        };
        
        set(state => ({
            chatMessages: [...state.chatMessages, userMessage],
            error: null
        }));
        
        try {
          // Obtener respuesta de la IA
            const response = await window.electronAPI.ai.chat(content, currentSubject.id, useContext);
            
            if (response.success) {
            const aiMessage: ChatMessage = {
                id: `ai_${Date.now()}`,
                role: 'assistant',
                content: response.response,
                timestamp: Date.now(),
                sources: response.sources,
                model: response.model,
                duration: response.duration
            };
            
            set(state => ({
                chatMessages: [...state.chatMessages, aiMessage]
            }));
            } else {
            set({ error: `AI Error: ${response.error}` });
            }
        } catch (error) {
            set({ error: `Chat error: ${error.message}` });
        }
        },
        
        loadChatHistory: async (subjectId) => {
        try {
            const history = await window.electronAPI.chat.getHistory(subjectId);
            
            const chatMessages: ChatMessage[] = history.map((msg: any) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp * 1000,
            sources: msg.sources ? JSON.parse(msg.sources) : []
            }));
            
            set({ chatMessages });
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
        },
        
        clearChatHistory: async (subjectId) => {
        try {
            await window.electronAPI.chat.clearHistory(subjectId);
            set({ chatMessages: [] });
        } catch (error) {
            set({ error: `Error clearing chat: ${error.message}` });
        }
        },
        
      // ========== SALUD Y ESTADÍSTICAS ==========
        checkAIHealth: async () => {
        try {
            const health = await window.electronAPI.ai.checkHealth();
            set({ aiHealth: health });
            return health;
        } catch (error) {
            const health = { ollama: false, chroma: false, timestamp: Date.now() };
            set({ aiHealth: health });
            return health;
        }
        },
        
        loadStats: async () => {
        try {
            const stats = await window.electronAPI.stats.getStats();
            set({ stats });
        } catch (error) {
            console.error('Error loading stats:', error);
        }
        },
        
      // ========== ARCHIVOS ==========
        selectFiles: async () => {
        try {
            const result = await window.electronAPI.files.selectFiles();
            if (!result.canceled) {
            return result.filePaths;
            }
            return [];
        } catch (error) {
            set({ error: `Error selecting files: ${error.message}` });
            return [];
        }
        },
        
        validateFile: async (filePath) => {
        try {
            return await window.electronAPI.files.validateFile(filePath);
        } catch (error) {
            set({ error: `Error validating file: ${error.message}` });
            return { valid: false, errors: [error.message] };
        }
        },
        
      // ========== ERROR HANDLING ==========
        setError: (error) => set({ error }),
        clearError: () => set({ error: null })
    }),
    {
        name: 'aiseven-store',
        partialize: (state) => ({
        darkMode: state.darkMode,
        sidebarOpen: state.sidebarOpen
        })
    }
    )
);