import { Chroma } from '@langchain/community/vectorstores/chroma';
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { v4 as uuidv4 } from 'uuid';

export interface SearchResult {
    content: string;
    metadata: {
    documentId: string;
    fileName: string;
    fileType: string;
    subjectId: string;
    page?: number;
    timestamp: number;
    [key: string]: any;
    };
    score: number;
}

export interface DocumentChunk {
    id: string;
    content: string;
    metadata: Record<string, any>;
    embedding?: number[];
}

class ChromaManager {
    private vectorStore: Chroma | null = null;
    private embeddings: HuggingFaceTransformersEmbeddings | null = null;
    private collectionName = 'aiseven_documents_v1';
    private isInitialized = false;
    
  // ========== INICIALIZACIÓN ==========
    
    async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
        console.log('Initializing ChromaDB manager...');
        
      // Inicializar embeddings (modelo liviano para CPU)
        
        model: 'Xenova/all-MiniLM-L6-v2',
        maxTokens: 512
        });
        
        console.log('Embeddings model loaded');
        
      // Intentar conectar a ChromaDB
        this.vectorStore = await Chroma.fromExistingCollection(
        this.embeddings,
        {
            collectionName: this.collectionName,
            url: 'http://localhost:8000'
        }
        );
        
        console.log('Connected to ChromaDB collection:', this.collectionName);
        this.isInitialized = true;
        
    } catch (error) {
        console.error('Failed to initialize ChromaDB:', error);
        
      // Si falla, crear nueva colección
        try {
        console.log('Creating new ChromaDB collection...');
        
        this.vectorStore = await Chroma.fromTexts(
            ['Initial document'],
            [{ id: 'init', timestamp: Date.now() }],
            this.embeddings!,
            {
            collectionName: this.collectionName,
            url: 'http://localhost:8000'
            }
        );
        
        this.isInitialized = true;
        console.log('New ChromaDB collection created');
        } catch (createError) {
        console.error('Failed to create ChromaDB collection:', createError);
        throw new Error('ChromaDB initialization failed. Make sure ChromaDB is running on http://localhost:8000');
        }
    }
    }
    
  // ========== VERIFICACIÓN DE CONEXIÓN ==========
    
    async checkConnection(): Promise<boolean> {
        try {
        await this.initialize();
        return true;
    } catch (error) {
        console.warn('ChromaDB connection check failed:', error.message);
        return false;
    }
    
    
  // ========== PROCESAMIENTO DE DOCUMENTOS ==========
  
  async addDocument(
    text: string, 
    metadata: {
      documentId: string;
      fileName: string;
      fileType: string;
      subjectId: string;
      [key: string]: any;
    }
  ): Promise<number> {
    await this.initialize();
    
    // Dividir texto en chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ': ', ', ', ' ']
    });
    
    const chunks = await splitter.createDocuments(
      [text],
      [{
        ...metadata,
        chunkId: uuidv4(),
        processedAt: Date.now()
      }],
      {
        chunkHeader: `Documento: ${metadata.fileName}\n\n`
      }
    );
    
    console.log(`Split document into ${chunks.length} chunks`);
    
    // Añadir chunks a ChromaDB
    await this.vectorStore!.addDocuments(chunks);
    
    return chunks.length;
  }
  
  // ========== BÚSQUEDA SEMÁNTICA ==========
  
  async search(
    query: string, 
    filters?: { subjectId?: string; fileType?: string },
    k: number = 4
  ): Promise<SearchResult[]> {
    await this.initialize();
    
    let filter: any = {};
    if (filters?.subjectId) {
      filter.subjectId = filters.subjectId;
    }
    if (filters?.fileType) {
      filter.fileType = filters.fileType;
    }
    
    try {
      const results = await this.vectorStore!.similaritySearchWithScore(
        query,
        k,
        Object.keys(filter).length > 0 ? filter : undefined
      );
      
      return results.map(([doc, score]) => ({
        content: doc.pageContent,
        metadata: doc.metadata as SearchResult['metadata'],
        score: score
      }));
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }
  
  // ========== BÚSQUEDA POR DOCUMENTO ==========
  
  async searchByDocument(
    documentId: string, 
    query?: string, 
    k: number = 10
  ): Promise<SearchResult[]> {
    await this.initialize();
    
    try {
      const results = await this.vectorStore!.similaritySearchWithScore(
        query || '',
        k,
        { documentId }
      );
      
      return results.map(([doc, score]) => ({
        content: doc.pageContent,
        metadata: doc.metadata as SearchResult['metadata'],
        score: score
      }));
    } catch (error) {
      console.error('Document search error:', error);
      return [];
    }
  }
  
  // ========== GESTIÓN DE DOCUMENTOS ==========
  
  async deleteDocument(documentId: string): Promise<number> {
    await this.initialize();
    
    try {
      // ChromaDB no tiene API directa para eliminar por filtro en esta versión
      // Esta es una implementación alternativa
      
      // Primero, buscar todos los chunks del documento
      const chunks = await this.searchByDocument(documentId, '', 1000);
      
      if (chunks.length === 0) {
        console.log(`No chunks found for document ${documentId}`);
        return 0;
      }
      
      console.log(`Found ${chunks.length} chunks to delete for document ${documentId}`);
      
      // Nota: En una implementación real, necesitarías usar la API REST de ChromaDB
      // o mantener un registro de IDs de chunks para eliminarlos
      
      // Por ahora, retornamos el número de chunks encontrados
      // (eliminación real requeriría configuración adicional)
      return chunks.length;
      
    } catch (error) {
      console.error('Delete document error:', error);
      return 0;
    }
  }
  
  async deleteBySubject(subjectId: string): Promise<number> {
    await this.initialize();
    
    try {
      // Buscar todos los chunks de la asignatura
      const chunks = await this.vectorStore!.similaritySearchWithScore(
        '',
        1000,
        { subjectId }
      );
      
      console.log(`Found ${chunks.length} chunks for subject ${subjectId}`);
      
      // Similar a deleteDocument, necesitarías la API REST para eliminación real
      return chunks.length;
      
    } catch (error) {
      console.error('Delete by subject error:', error);
      return 0;
    }
  }
  
  // ========== ESTADÍSTICAS ==========
  
  async getStats(): Promise<{
    totalChunks: number;
    subjects: Record<string, number>;
    documentTypes: Record<string, number>;
  }> {
    await this.initialize();
    
    try {
      // Obtener una muestra para estadísticas
      const sampleResults = await this.vectorStore!.similaritySearchWithScore(
        '',
        1000
      );
      
      const subjects: Record<string, number> = {};
      const documentTypes: Record<string, number> = {};
      
      sampleResults.forEach(([doc]) => {
        const metadata = doc.metadata as any;
        
        // Contar por asignatura
        if (metadata.subjectId) {
          subjects[metadata.subjectId] = (subjects[metadata.subjectId] || 0) + 1;
        }
        
        // Contar por tipo de documento
        if (metadata.fileType) {
          documentTypes[metadata.fileType] = (documentTypes[metadata.fileType] || 0) + 1;
        }
      });
      
      return {
        totalChunks: sampleResults.length,
        subjects,
        documentTypes
      };
    } catch (error) {
      console.error('Get stats error:', error);
      return {
        totalChunks: 0,
        subjects: {},
        documentTypes: {}
      };
    }
  }
  
  // ========== LIMPIEZA ==========
  
  async clearAll(): Promise<boolean> {
    try {
      // Reiniciar completamente
      this.vectorStore = null;
      this.isInitialized = false;
      
      // Nota: Para eliminar la colección completamente, necesitarías la API REST
      console.log('ChromaManager cleared (collection reset requires REST API)');
      return true;
    } catch (error) {
      console.error('Clear all error:', error);
      return false;
    }
  }
}

export default new ChromaManager();