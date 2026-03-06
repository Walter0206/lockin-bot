// ============================================================
// CHARGEMENT DES DÉPENDANCES
// ============================================================

require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");
const db = require("./database");
const express = require("express");
const path = require("path");


// ============================================================
// CRÉATION DU BOT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});


// ============================================================
// ÉVÉNEMENT : BOT CONNECTÉ
// ============================================================

client.on("ready", () => {
  console.log(`Bot connecté à Discord en tant que ${client.user.tag}`);
});


// ============================================================
// ÉVÉNEMENT : MESSAGE REÇU
// ============================================================

client.on("messageCreate", async (message) => {

  // On ignore les messages des autres bots
  if (message.author.bot) return;

  const userId = message.author.id;


  // -------------------------
  // COMMANDE DEEP WORK (!deep)
  // -------------------------

  if (message.content.startsWith("!deep")) {

    const minutes = parseInt(message.content.split(" ")[1]);

    if (!minutes) {
      message.reply("Entre un nombre de minutes. Exemple : !deep 90");
      return;
    }

    try {
      // INSERT ou UPDATE : si l'utilisateur existe déjà, on additionne ses minutes.
      await db.query(
        `INSERT INTO users (user_id, total_minutes, week_minutes, today_minutes)
         VALUES ($1, $2, $2, $2)
         ON CONFLICT(user_id)
         DO UPDATE SET
           total_minutes = users.total_minutes + $2,
           week_minutes  = users.week_minutes  + $2,
           today_minutes = users.today_minutes + $2`,
        [userId, minutes]
      );
      message.reply(`🧠 Deep work ajouté : ${minutes} minutes`);
    } catch (err) {
      console.error("Erreur !deep :", err);
      message.reply("❌ Une erreur est survenue.");
    }
  }


  // -------------------------
  // COMMANDE DONE (STREAK) (!done)
  // -------------------------

  if (message.content === "!done") {

    // Date du jour au format "YYYY-MM-DD"
    const today = new Date().toISOString().split("T")[0];

    try {
      // On récupère les données actuelles de l'utilisateur
      const { rows } = await db.query(
        `SELECT * FROM users WHERE user_id = $1`,
        [userId]
      );
      const row = rows[0];

      // PROTECTION ANTI-DOUBLE STREAK
      if (row && row.last_checkin === today) {
        message.reply(`✅ Tu as déjà validé ta journée aujourd'hui ! Streak actuel : 🔥 ${row.current_streak} jours`);
        return;
      }

      // Calcul du nouveau streak
      let streak = 1;
      if (row && row.last_checkin) {
        const last = new Date(row.last_checkin);
        const diff = (Date.now() - last) / (1000 * 60 * 60 * 24);
        if (diff <= 1.5) {
          streak = row.current_streak + 1;
        }
      }

      // Sauvegarde du nouveau streak
      await db.query(
        `INSERT INTO users (user_id, current_streak, last_checkin)
         VALUES ($1, $2, $3)
         ON CONFLICT(user_id)
         DO UPDATE SET
           current_streak = $2,
           last_checkin   = $3`,
        [userId, streak, today]
      );

      message.reply(`🔥 Streak : ${streak} jours`);
    } catch (err) {
      console.error("Erreur !done :", err);
      message.reply("❌ Une erreur est survenue.");
    }
  }

});


// ============================================================
// SERVEUR WEB (DASHBOARD)
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques (notre futur Dashboard)
app.use(express.static(path.join(__dirname, "public")));

// API : Récupérer les statistiques pour le dashboard
app.get("/api/stats", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT user_id, total_minutes, current_streak, last_checkin
      FROM users
      ORDER BY total_minutes DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error("Erreur API stats :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Lancement du serveur web
app.listen(PORT, () => {
  console.log(`✅ Dashboard accessible sur http://localhost:${PORT}`);
});


// ============================================================
// TÂCHE AUTOMATIQUE : RAPPORT QUOTIDIEN À 21H
// ============================================================

cron.schedule("0 21 * * *", async () => {

  try {
    const { rows } = await db.query(`SELECT * FROM users`);
    if (!rows || rows.length === 0) return;

    for (const user of rows) {
      const hours = (user.total_minutes / 60).toFixed(1);
      const days = (hours / 24).toFixed(2);

      try {
        const u = await client.users.fetch(user.user_id);
        await u.send(
          `📊 Daily Deep Work Report\n\nAujourd'hui : ${user.today_minutes || 0} minutes\nCette semaine : ${user.week_minutes || 0} minutes\n\nTotal :\n${user.total_minutes || 0} minutes\n${hours} heures\n${days} jours`
        );
      } catch (_) {
        // DM désactivés ou utilisateur introuvable — on passe
      }
    }

    // Remise à zéro des minutes du jour
    await db.query(`UPDATE users SET today_minutes = 0`);

  } catch (err) {
    console.error("Erreur rapport quotidien :", err);
  }

});


// ============================================================
// TÂCHE AUTOMATIQUE : RESET HEBDOMADAIRE (DIMANCHE MINUIT)
// ============================================================

cron.schedule("0 0 * * 0", async () => {
  try {
    await db.query(`UPDATE users SET week_minutes = 0`);
    console.log("Reset des minutes hebdomadaires");
  } catch (err) {
    console.error("Erreur reset hebdomadaire :", err);
  }
});


// ============================================================
// CONNEXION DU BOT À DISCORD
// ============================================================

client.login(process.env.TOKEN);