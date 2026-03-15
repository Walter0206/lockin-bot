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
    last_checkin DATE,
    freezes_available INTEGER DEFAULT 0,
    last_freeze_date DATE,
    checkout_date DATE,
    session_start TIMESTAMPTZ,
    current_priority TEXT,
    month_minutes INTEGER DEFAULT 0,
    year_minutes INTEGER DEFAULT 0,
    secret_id TEXT UNIQUE
  )
`)
  .then(() => {
    console.log("✅ Base de données PostgreSQL prête (Table 'users' vérifiée)");
    // S'assurer que les nouvelles colonnes existent avec le BON type
    // On tente une conversion, et si ça échoue (format texte incompatible), on recrée proprement.
    return db.query(`
      -- Conversion ou création de freezes_available
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS freezes_available INTEGER DEFAULT 0;
      EXCEPTION WHEN others THEN NULL; END $$;

      -- Pour les dates, on tente de convertir. Si échec, on DROP et ADD (Reset autorisé par l'user)
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN last_freeze_date TYPE DATE USING last_freeze_date::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users DROP COLUMN IF EXISTS last_freeze_date;
        ALTER TABLE users ADD COLUMN last_freeze_date DATE;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN checkin_date TYPE DATE USING checkin_date::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users DROP COLUMN IF EXISTS checkin_date;
        ALTER TABLE users ADD COLUMN checkin_date DATE;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN checkout_date TYPE DATE USING checkout_date::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users DROP COLUMN IF EXISTS checkout_date;
        ALTER TABLE users ADD COLUMN checkout_date DATE;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN session_start TYPE TIMESTAMPTZ USING session_start::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users DROP COLUMN IF EXISTS session_start;
        ALTER TABLE users ADD COLUMN session_start TIMESTAMPTZ;
      END $$;

      -- Autres colonnes
      ALTER TABLE users ADD COLUMN IF NOT EXISTS current_priority TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS month_minutes INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS year_minutes INTEGER DEFAULT 0;
      
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN secret_id TYPE TEXT;
      EXCEPTION WHEN others THEN NULL; END $$;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_id TEXT UNIQUE;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS motivations TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS commitment_signed BOOLEAN DEFAULT FALSE;
      
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN signed_at TYPE TIMESTAMPTZ USING signed_at::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN
        ALTER TABLE users DROP COLUMN IF EXISTS signed_at;
        ALTER TABLE users ADD COLUMN signed_at TIMESTAMPTZ;
      END $$;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_days_at_zero INTEGER DEFAULT 0;
    `);
  })
  .then(() => console.log("✅ Colonnes de commitment et d'exclusion vérifiées."))
  .catch(err => console.error("❌ Erreur critique lors de la connexion/création de la table :", err));

module.exports = db;