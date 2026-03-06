// ============================================================
// CONNEXION À LA BASE DE DONNÉES POSTGRESQL
// ============================================================

// "pg" est le driver officiel Node.js pour PostgreSQL.
// Railway fournit automatiquement la variable DATABASE_URL
// avec toutes les infos de connexion (hôte, port, user, mot de passe, nom de la DB).
const { Pool } = require("pg");

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL obligatoire sur Railway et la plupart des hébergeurs cloud.
  // "rejectUnauthorized: false" évite les erreurs de certificat auto-signé.
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Création de la table si elle n'existe pas encore.
// Même structure qu'avant, juste la syntaxe PostgreSQL (très proche de SQLite).
db.query(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    total_minutes INTEGER DEFAULT 0,
    week_minutes INTEGER DEFAULT 0,
    today_minutes INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    last_checkin TEXT
  )
`).catch(err => console.error("Erreur création table:", err));

module.exports = db;