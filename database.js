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
db.query(`
    CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    total_minutes INTEGER DEFAULT 0,
    week_minutes INTEGER DEFAULT 0,
    today_minutes INTEGER DEFAULT 0,
    current_serie INTEGER DEFAULT 0,
    best_serie INTEGER DEFAULT 0,
    checkin_date DATE,
    gels_disponibles INTEGER DEFAULT 0,
    date_dernier_gel DATE,
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
    
    // MIGRATION ET TERMINOLOGIE
    return db.query(`
      -- 1. Renommer streak/freeze en série/gel si les anciennes colonnes existent encore
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='current_streak') THEN
          ALTER TABLE users RENAME COLUMN current_streak TO current_serie;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='best_streak') THEN
          ALTER TABLE users RENAME COLUMN best_streak TO best_serie;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='freezes_available') THEN
          ALTER TABLE users RENAME COLUMN freezes_available TO gels_disponibles;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_freeze_date') THEN
          ALTER TABLE users RENAME COLUMN last_freeze_date TO date_dernier_gel;
        END IF;
      END $$;

      -- 2. Uniformiser checkin_date (on migre depuis last_checkin si besoin)
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_checkin') THEN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_date DATE;
          UPDATE users SET checkin_date = last_checkin::DATE WHERE checkin_date IS NULL;
        END IF;
      END $$;

      -- 3. S'assurer que les colonnes critiques sont du bon type
      ALTER TABLE users ALTER COLUMN checkin_date TYPE DATE USING checkin_date::DATE;
      ALTER TABLE users ALTER COLUMN checkout_date TYPE DATE USING checkout_date::DATE;
      
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN date_dernier_gel TYPE DATE USING date_dernier_gel::DATE;
      EXCEPTION WHEN others THEN 
        ALTER TABLE users ADD COLUMN IF NOT EXISTS date_dernier_gel DATE;
      END $$;

      ALTER TABLE users ALTER COLUMN session_start TYPE TIMESTAMPTZ USING session_start::TIMESTAMPTZ;
      ALTER TABLE users ALTER COLUMN signed_at TYPE TIMESTAMPTZ USING signed_at::TIMESTAMPTZ;

      -- 4. Autres colonnes et contraintes
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