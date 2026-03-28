import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';

export interface Document {
    id: string;
    subjectId: string;
    filePath: string;
    fileName: string;
    fileType: 'pdf' | 'txt' | 'docx' | 'other';
    fileHash: string;
    indexedAt: number;
    metadata?: string;
}

export interface Subject {
    id: string;
    name: string;
    semester: number;
    year: number;
    createdAt: number;
}

export interface ChatHistory {
    id: string;
    subjectId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    sources?: string;
}

class DatabaseManager {
    private db: Database.Database;
    private static instance: DatabaseManager;
    
    private constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'aiseven.db');
    console.log('Database path:', dbPath);
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    this.initSchema();
    this.ensureDefaultSubject();
    }
    
    static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
        DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }
    
    private initSchema(): void {
    // Tabla de asignaturas (materias)
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        semester INTEGER DEFAULT 1,
        year INTEGER DEFAULT 2024,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Tabla de documentos
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        subjectId TEXT NOT NULL,
        filePath TEXT NOT NULL,
        fileName TEXT NOT NULL,
        fileType TEXT NOT NULL,
        fileHash TEXT NOT NULL,
        indexedAt INTEGER DEFAULT (strftime('%s', 'now')),
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (subjectId) REFERENCES subjects(id) ON DELETE CASCADE
        )
    `);
    
    // Tabla de historial de chat
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS chat_history (
        id TEXT PRIMARY KEY,
        subjectId TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        sources TEXT DEFAULT '[]',
        FOREIGN KEY (subjectId) REFERENCES subjects(id) ON DELETE CASCADE
        )
    `);
    
    // Índices para búsquedas rápidas
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_documents_subject ON documents(subjectId)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(fileHash)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_chat_subject ON chat_history(subjectId)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_history(timestamp DESC)');
    }
    private ensureDefaultSubject(): void {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM subjects').get();
    if (count.count === 0) {
    this.addSubject('General', 1, 2024);
    }
}
// ========== MÉTODOS PARA ASIGNATURAS ==========

    addSubject(name: string, semester: number = 1, year: number = 2024): string {
    const id = `subj_${uuidv4()}`;
    const stmt = this.db.prepare(
    'INSERT INTO subjects (id, name, semester, year) VALUES (?, ?, ?, ?)'
    );
    stmt.run(id, name, semester, year);
    return id;
}

getSubjects(): Subject[] {
    return this.db.prepare('SELECT * FROM subjects ORDER BY year DESC, semester DESC').all() as Subject[];
}

getSubject(id: string): Subject | null {
    const stmt = this.db.prepare('SELECT * FROM subjects WHERE id = ?');
    return stmt.get(id) as Subject || null;
}

updateSubject(id: string, updates: Partial<Subject>): boolean {
    const fields = [];
    const values = [];
    
    if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
    }
    if (updates.semester !== undefined) {
        fields.push('semester = ?');
        values.push(updates.semester);
    }
    if (updates.year !== undefined) {
        fields.push('year = ?');
        values.push(updates.year);
    }
    
    if (fields.length === 0) return false;
    
    values.push(id);
    const sql = `UPDATE subjects SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...values);
    return result.changes > 0;
    }
  
    deleteSubject(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM subjects WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
    }
  
  // ========== MÉTODOS PARA DOCUMENTOS ==========
  
    addDocument(doc: Omit<Document, 'id' | 'indexedAt'>): string {
    const id = `doc_${uuidv4()}`;
    const stmt = this.db.prepare(
        `INSERT INTO documents 
        (id, subjectId, filePath, fileName, fileType, fileHash, metadata) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
        id, 
        doc.subjectId, 
        doc.filePath, 
        doc.fileName, 
        doc.fileType, 
        doc.fileHash,
        doc.metadata || '{}'
    );
    return id;
    }
    getDocumentsBySubject(subjectId: string): Document[] {
    return this.db
      .prepare('SELECT * FROM documents WHERE subjectId = ? ORDER BY indexedAt DESC')
        .all(subjectId) as Document[];
}
    getDocument(id: string): Document | null {
    const stmt = this.db.prepare('SELECT * FROM documents WHERE id = ?');
    return stmt.get(id) as Document || null;
    }

    documentExists(fileHash: string): boolean {
    const result = this.db
        .prepare('SELECT 1 FROM documents WHERE fileHash = ? LIMIT 1')
        .get(fileHash);
    return !!result;
    }

    updateDocumentIndexTime(id: string): void {
    this.db
        .prepare('UPDATE documents SET indexedAt = ? WHERE id = ?')
        .run(Date.now(), id);
    }

    deleteDocument(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM documents WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
    }
    deleteDocumentsBySubject(subjectId: string): number {
    const stmt = this.db.prepare('DELETE FROM documents WHERE subjectId = ?');
    const result = stmt.run(subjectId);
    return result.changes;
    }

  // ========== MÉTODOS PARA CHAT HISTORY ==========

    addChatMessage(subjectId: string, role: 'user' | 'assistant', content: string, sources?: any[]): string {
    const id = `chat_${uuidv4()}`;
    const stmt = this.db.prepare(
        'INSERT INTO chat_history (id, subjectId, role, content, sources) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(
        id,
        subjectId,
        role,
        content,
        sources ? JSON.stringify(sources) : '[]'
    );
    return id;
    }

    getChatHistory(subjectId: string, limit: number = 50): ChatHistory[] {
    return this.db
      .prepare('SELECT * FROM chat_history WHERE subjectId = ? ORDER BY timestamp ASC LIMIT ?')
        .all(subjectId, limit) as ChatHistory[];
    }

    clearChatHistory(subjectId: string): number {
    const stmt = this.db.prepare('DELETE FROM chat_history WHERE subjectId = ?');
    const result = stmt.run(subjectId);
    return result.changes;
    }

  // ========== MÉTODOS DE ESTADÍSTICAS ==========

getStats() {
    const docCount = this.db.prepare('SELECT COUNT(*) as count FROM documents').get();
    const subjectCount = this.db.prepare('SELECT COUNT(*) as count FROM subjects').get();
    const chatCount = this.db.prepare('SELECT COUNT(*) as count FROM chat_history').get();
    
    const recentDocs = this.db
    .prepare('SELECT fileName, fileType, indexedAt FROM documents ORDER BY indexedAt DESC LIMIT 5')
    .all();
    
    return {
    documents: docCount.count,
    subjects: subjectCount.count,
    chatMessages: chatCount.count,
    recentDocuments: recentDocs
    };
}

  // ========== BACKUP Y MANTENIMIENTO ==========
backup(destinationPath: string): boolean {
    try {
    const backupDb = new Database(destinationPath);
    this.db.backup(backupDb);
    backupDb.close();
    return true;
    } catch (error) {
    console.error('Backup failed:', error);
    return false;
    }
}
vacuum(): void {
    this.db.exec('VACUUM');
}
close(): void {
    this.db.close();
}
}

export default DatabaseManager.getInstance();