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
    checkin_date DATE,
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
    
    // MIGRATION ET STANDARDISATION DES COLONNES
    return db.query(`
      -- 1. Uniformiser checkin_date (on migre depuis last_checkin si besoin)
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_checkin') THEN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_date DATE;
          UPDATE users SET checkin_date = last_checkin::DATE WHERE checkin_date IS NULL;
          -- On garde last_checkin temporairement ou on peut le drop dans une future version
        END IF;
      END $$;

      -- 2. S'assurer que les colonnes critiques sont du bon type (DATE/TIMESTAMPTZ)
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN checkin_date TYPE DATE USING checkin_date::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_date DATE;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN checkout_date TYPE DATE USING checkout_date::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users ADD COLUMN IF NOT EXISTS checkout_date DATE;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN last_freeze_date TYPE DATE USING last_freeze_date::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_freeze_date DATE;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN session_start TYPE TIMESTAMPTZ USING session_start::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users ADD COLUMN IF NOT EXISTS session_start TIMESTAMPTZ;
      END $$;

      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN signed_at TYPE TIMESTAMPTZ USING signed_at::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
      END $$;

      -- 3. Autres colonnes et contraintes
      ALTER TABLE users ADD COLUMN IF NOT EXISTS current_priority TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS month_minutes INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS year_minutes INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS motivations TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS commitment_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_days_at_zero INTEGER DEFAULT 0;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_secret_id_key') THEN
          ALTER TABLE users ADD CONSTRAINT users_secret_id_key UNIQUE (secret_id);
        END IF;
      EXCEPTION WHEN others THEN NULL; END $$;
    `);
  })
  .then(() => console.log("✅ Colonnes de commitment et d'exclusion vérifiées."))
  .catch(err => console.error("❌ Erreur critique lors de la connexion/création de la table :", err));

module.exports = db;