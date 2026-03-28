import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { extractText } from 'mammoth';
import pdfParse from 'pdf-parse';
import DatabaseManager from '../database/DatabaseManager';
import ChromaManager from './ChromaManager';

export interface ProcessResult {
  success: boolean;
  documentId?: string;
  chunks?: number;
  error?: string;
  textLength?: number;
  processingTime?: number;
}

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

class DocumentProcessor {
  
  // ========== INFORMACIÓN DEL ARCHIVO ==========
  
  async getFileInfo(filePath: string): Promise<FileInfo> {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size,
        type: this.getFileType(ext),
        lastModified: stats.mtimeMs
      };
    } catch (error) {
      throw new Error(`Cannot access file: ${error.message}`);
    }
  }
  
  private getFileType(extension: string): string {
    const types: Record<string, string> = {
      '.pdf': 'pdf',
      '.txt': 'txt',
      '.md': 'txt',
      '.docx': 'docx',
      '.doc': 'docx',
      '.rtf': 'rtf'
    };
    
    return types[extension] || 'other';
  }
  
  // ========== HASH DEL ARCHIVO ==========
  
  async calculateFileHash(filePath: string): Promise<string> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      throw new Error(`Cannot calculate hash: ${error.message}`);
    }
  }
  
  // ========== EXTRACCIÓN DE TEXTO ==========
  
  async extractTextFromFile(filePath: string): Promise<{
    text: string;
    metadata: Record<string, any>;
  }> {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    
    console.log(`Extracting text from ${fileName} (${ext})`);
    
    try {
      let text = '';
      let metadata: Record<string, any> = {
        fileName,
        extension: ext,
        processedAt: Date.now()
      };
      
      switch (ext) {
        case '.pdf':
          const pdfResult = await this.extractFromPDF(filePath);
          text = pdfResult.text;
          metadata = { ...metadata, ...pdfResult.metadata };
          break;
          
        case '.txt':
        case '.md':
        case '.rtf':
          text = await fs.readFile(filePath, 'utf-8');
          metadata.encoding = 'utf-8';
          break;
          
        case '.docx':
        case '.doc':
          const docxResult = await this.extractFromDOCX(filePath);
          text = docxResult.text;
          metadata = { ...metadata, ...docxResult.metadata };
          break;
          
        default:
          throw new Error(`Formato no soportado: ${ext}. Soporta: PDF, TXT, MD, DOCX, DOC, RTF`);
      }
      
      if (!text.trim()) {
        throw new Error('El archivo está vacío o no se pudo extraer texto');
      }
      
      return {
        text: text.trim(),
        metadata
      };
      
    } catch (error) {
      console.error(`Error extracting from ${filePath}:`, error);
      throw new Error(`Error procesando ${fileName}: ${error.message}`);
    }
  }
  
  private async extractFromPDF(filePath: string): Promise<{
    text: string;
    metadata: Record<string, any>;
  }> {
    try {
      const pdfBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      
      return {
        text: pdfData.text,
        metadata: {
          numPages: pdfData.numpages,
          pdfInfo: pdfData.info || {},
          textLength: pdfData.text.length
        }
      };
    } catch (error) {
      throw new Error(`PDF parsing error: ${error.message}`);
    }
  }
  
  private async extractFromDOCX(filePath: string): Promise<{
    text: string;
    metadata: Record<string, any>;
  }> {
    try {
      const result = await extractText({ 
        path: filePath,
        includeEmbedded: false
      });
      
      return {
        text: result.value,
        metadata: {
          rawText: result.rawText || '',
          messages: result.messages || []
        }
      };
    } catch (error) {
      throw new Error(`DOCX parsing error: ${error.message}`);
    }
  }
  
  // ========== PIPELINE COMPLETO ==========
  
  async processDocument(
    filePath: string, 
    subjectId: string,
    options: {
      forceReprocess?: boolean;
      chunkSize?: number;
    } = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    
    try {
      console.log(`Processing document: ${filePath}`);
      
      // 1. Obtener información del archivo
      const fileInfo = await this.getFileInfo(filePath);
      
      // 2. Calcular hash
      const fileHash = await this.calculateFileHash(filePath);
      
      // 3. Verificar si ya existe (a menos que forceReprocess sea true)
      if (!options.forceReprocess && DatabaseManager.documentExists(fileHash)) {
        console.log(`Document already exists (hash: ${fileHash.substring(0, 16)}...)`);
        return {
          success: true,
          documentId: 'existing',
          chunks: 0,
          textLength: 0,
          processingTime: Date.now() - startTime,
          error: 'Document already indexed'
        };
      }
      
      // 4. Extraer texto
      const { text, metadata } = await this.extractTextFromFile(filePath);
      
      if (text.length < 50) {
        throw new Error(`Texto muy corto (${text.length} caracteres). El documento podría no contener texto extraíble.`);
      }
      
      console.log(`Extracted ${text.length} characters from ${fileInfo.name}`);
      
      // 5. Añadir a ChromaDB
      const chunksAdded = await ChromaManager.addDocument(text, {
        documentId: `temp_${Date.now()}`,
        fileName: fileInfo.name,
        fileType: fileInfo.type,
        subjectId,
        fileHash,
        originalPath: filePath,
        ...metadata
      });
      
      // 6. Registrar en SQLite
      const documentId = DatabaseManager.addDocument({
        subjectId,
        filePath,
        fileName: fileInfo.name,
        fileType: fileInfo.type as any,
        fileHash,
        metadata: JSON.stringify(metadata)
      });
      
      // 7. Actualizar el documento en ChromaDB con el ID real
      // (En una implementación más avanzada, actualizarías los metadatos)
      
      const processingTime = Date.now() - startTime;
      
      console.log(`Successfully processed ${fileInfo.name}: ${chunksAdded} chunks in ${processingTime}ms`);
      
      return {
        success: true,
        documentId,
        chunks: chunksAdded,
        textLength: text.length,
        processingTime
      };
      
    } catch (error) {
      console.error('Document processing failed:', error);
      
      return {
        success: false,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }
  
  // ========== PROCESAMIENTO POR LOTES ==========
  
  async processBatch(
    filePaths: string[], 
    subjectId: string,
    onProgress?: (processed: number, total: number, currentFile: string) => void
  ): Promise<Array<ProcessResult & { filePath: string }>> {
    const results: Array<ProcessResult & { filePath: string }> = [];
    
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      
      if (onProgress) {
        onProgress(i, filePaths.length, path.basename(filePath));
      }
      
      try {
        const result = await this.processDocument(filePath, subjectId);
        results.push({ filePath, ...result });
      } catch (error) {
        results.push({
          filePath,
          success: false,
          error: error.message,
          processingTime: 0
        });
      }
    }
    
    return results;
  }
  
  // ========== VALIDACIÓN ==========
  
  async validateDocument(filePath: string): Promise<{
    valid: boolean;
    errors: string[];
    info?: FileInfo;
  }> {
    const errors: string[] = [];
    
    try {
      // Verificar que el archivo existe
      await fs.access(filePath);
      
      // Obtener información
      const info = await this.getFileInfo(filePath);
      
      // Validar tamaño (máximo 50MB)
      if (info.size > 50 * 1024 * 1024) {
        errors.push(`Archivo muy grande (${(info.size / 1024 / 1024).toFixed(2)} MB). Máximo: 50MB`);
      }
      
      // Validar tipo
      const supportedTypes = ['pdf', 'txt', 'docx'];
      if (!supportedTypes.includes(info.type)) {
        errors.push(`Tipo no soportado: ${info.type}. Soporta: ${supportedTypes.join(', ')}`);
      }
      
      return {
        valid: errors.length === 0,
        errors,
        info
      };
      
    } catch (error) {
      errors.push(`Error de acceso: ${error.message}`);
      return {
        valid: false,
        errors
      };
    }
  }
  
  // ========== UTILIDADES ==========
  
  async getSupportedExtensions(): Promise<string[]> {
    return ['.pdf', '.txt', '.md', '.docx', '.doc', '.rtf'];
  }
  
  async getSupportedMimeTypes(): Promise<string[]> {
    return [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/rtf'
    ];
  }
}

export default new DocumentProcessor();