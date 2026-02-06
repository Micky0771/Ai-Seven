import Database from 'better-sqlite3';

// Creamos la base de datos directamente. 
// Al no usar 'path', se creará en la raíz del proyecto donde ejecutes el comando.
const db = new Database('aiseven.db', { verbose: console.log });

// Creamos la tabla de asignaturas para guardar tus ramos
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `).run();
} catch (error) {
  console.error("Error creando la tabla:", error);
}

export default db;