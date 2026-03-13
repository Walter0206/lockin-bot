// ============================================================
// CONNEXION À LA BASE DE DONNÉES POSTGRESQL
// ============================================================

// "pg" est le driver officiel Node.js pour PostgreSQL.
// Railway fournit automatiquement la variable DATABASE_URL
// avec toutes les infos de connexion (hôte, port, user, mot de passe, nom de la DB).
const { Pool } = require("pg");

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

if (!process.env.DATABASE_URL) {
  console.error("❌ ERREUR : La variable DATABASE_URL est manquante ! Assure-toi d'avoir ajouté un service PostgreSQL dans ton projet Railway.");
} else {
  console.log("✅ DATABASE_URL détectée, tentative de connexion...");
}

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
    last_checkin TEXT,
    freezes_available INTEGER DEFAULT 0,
    last_freeze_date TEXT,
    checkout_date TEXT,
    session_start TEXT,
    current_priority TEXT,
    month_minutes INTEGER DEFAULT 0,
    year_minutes INTEGER DEFAULT 0,
    secret_id TEXT UNIQUE
  )
`)
  .then(() => {
    console.log("✅ Base de données PostgreSQL prête (Table 'users' vérifiée)");
    // S'assurer que les nouvelles colonnes existent si la table a été créée avant la fonctionnalité de Freeze
    return db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS freezes_available INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_freeze_date TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_date TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS checkout_date TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS session_start TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS current_priority TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS month_minutes INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS year_minutes INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_id TEXT UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS motivations TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS commitment_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS signed_at TEXT;
    `);
  })
  .then(() => console.log("✅ Colonnes de commitment vérifiées."))
  .catch(err => console.error("❌ Erreur critique lors de la connexion/création de la table :", err));

module.exports = db;