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
// CONFIGURATION DES RÔLES DE STREAK
// ============================================================

// Les rôles doivent être classés du plus grand nombre de jours au plus petit !
const ROLE_THRESHOLDS = [
  { days: 30, id: "1479824619518033942", name: "Légende" },
  { days: 14, id: "1479824521014939728", name: "On fire" },
  { days: 7, id: "1479824430443008232", name: "Engagé" },
  { days: 3, id: "1479824330857779312", name: "Régulier" },
  { days: 1, id: "1479823817856778444", name: "Débutant" }
];

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
      // 1. On récupère les minutes actuelles pour le calcul des freezes
      const { rows } = await db.query(`SELECT total_minutes FROM users WHERE user_id = $1`, [userId]);
      const oldTotal = rows[0] ? rows[0].total_minutes : 0;
      const newTotal = oldTotal + minutes;

      // Calcul des freezes gagnés (1 tous les 500 min)
      const oldFreezes = Math.floor(oldTotal / 500);
      const newFreezes = Math.floor(newTotal / 500);
      const earned = newFreezes - oldFreezes;

      // 2. INSERT ou UPDATE
      await db.query(
        `INSERT INTO users (user_id, total_minutes, week_minutes, today_minutes, freezes_available)
         VALUES ($1, $2, $2, $2, $3)
         ON CONFLICT(user_id)
         DO UPDATE SET
           total_minutes = users.total_minutes + $2,
           week_minutes  = users.week_minutes  + $2,
           today_minutes = users.today_minutes + $2,
           freezes_available = users.freezes_available + $3`,
        [userId, minutes, earned]
      );

      let rewardMsg = `🧠 Deep work ajouté : ${minutes} minutes`;
      if (earned > 0) {
        rewardMsg += `\n❄️ Bravo ! Tu as gagné **${earned} Streak Freeze(s)** ! (Total : ${newFreezes})`;
      }
      message.reply(rewardMsg);
    } catch (err) {
      console.error("Erreur !deep :", err);
      message.reply("❌ Une erreur est survenue : " + err.message);
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
        // On crée une date pour "hier" en format YYYY-MM-DD
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = yesterdayDate.toISOString().split("T")[0];

        if (row.last_checkin === yesterday) {
          streak = row.current_streak + 1;
        } else {
          // Le streak est brisé
          streak = 1;
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

      // --- LOGIQUE D'ATTRIBUTION DES RÔLES ---
      try {
        if (message.member) {
          const targetRole = ROLE_THRESHOLDS.find(r => streak >= r.days);

          if (targetRole) {
            // Est-ce qu'il a déjà le rôle ?
            const hasRole = message.member.roles.cache.has(targetRole.id);
            if (!hasRole) {
              await message.member.roles.add(targetRole.id);
            }

            // On retire tous les autres rôles de streak inférieurs ou supérieurs
            for (const r of ROLE_THRESHOLDS) {
              if (r.id !== targetRole.id && message.member.roles.cache.has(r.id)) {
                await message.member.roles.remove(r.id);
              }
            }
          } else {
            // Pas ou plus éligible à un rôle (streak = 0)
            for (const r of ROLE_THRESHOLDS) {
              if (message.member.roles.cache.has(r.id)) {
                await message.member.roles.remove(r.id);
              }
            }
          }
        }
      } catch (roleErr) {
        console.error("Erreur d'attribution des rôles (!done):", roleErr);
      }

      message.reply(`🔥 Streak : ${streak} jours (Glace restante : ❄️ ${row ? row.freezes_available : 0})`);
    } catch (err) {
      console.error("Erreur !done :", err);
      message.reply("❌ Une erreur est survenue : " + err.message);
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
      SELECT user_id, total_minutes, current_streak, last_checkin, freezes_available
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


// ============================================================
// TÂCHE AUTOMATIQUE : STREAK FREEZE À 23H59
// ============================================================

cron.schedule("59 23 * * *", async () => {
  const today = new Date().toISOString().split("T")[0];

  try {
    // On cherche les utilisateurs qui n'ont pas fait !done aujourd'hui MAIS qui ont un streak actif
    const { rows } = await db.query(`
      SELECT * FROM users 
      WHERE (last_checkin IS NULL OR last_checkin != $1)
      AND current_streak > 0
    `, [today]);

    for (const user of rows) {
      if (user.freezes_available > 0) {
        try {
          // Consommation du freeze et MAJ de la date de check-in / date de dernier freeze
          await db.query(`
            UPDATE users 
            SET freezes_available = freezes_available - 1,
                last_checkin = $1,
                last_freeze_date = $1
            WHERE user_id = $2
          `, [today, user.user_id]);

          // Notification par DM
          const u = await client.users.fetch(user.user_id);
          await u.send(
            `❄️ **STREAK FREEZE AUTOMATIQUE** ❄️\n\nTu as oublié de valider ta journée aujourd'hui, mais pas de panique ! J'ai utilisé l'un de tes freezes pour sauver ton streak de **${user.current_streak} jours**.\n\nIl te reste **${user.freezes_available - 1}** freeze(s). Continue comme ça, ne lâche rien ! 💪`
          );
          console.log(`❄️ Freeze automatique utilisé pour ${user.user_id}`);
        } catch (err) {
          console.error(`Erreur freeze auto pour ${user.user_id}:`, err);
        }
      } else {
        try {
          // Pas de freeze disponible -> Perte du streak
          await db.query(`
            UPDATE users 
            SET current_streak = 0
            WHERE user_id = $1
          `, [user.user_id]);

          // --- RETRAIT DE TOUS LES RÔLES DE STREAK ---
          try {
            const guild = client.guilds.cache.first();
            if (guild) {
              const member = await guild.members.fetch(user.user_id).catch(() => null);
              if (member) {
                for (const r of ROLE_THRESHOLDS) {
                  if (member.roles.cache.has(r.id)) {
                    await member.roles.remove(r.id);
                  }
                }
              }
            }
          } catch (roleErr) {
            console.error("Erreur retrait rôle auto (cron):", roleErr);
          }

          // Notification par DM
          const u = await client.users.fetch(user.user_id);
          await u.send(
            `💔 **STREAK PERDU** 💔\n\nTu n'as pas validé ta journée aujourd'hui et tu n'avais plus de ❄️ Streak Freeze...\nTon streak de **${user.current_streak} jours** retombe à 0. C'est le moment d'en démarrer un nouveau dès demain, on recommence sur de bonnes bases ! 💪`
          );
          console.log(`💔 Streak cassé pour ${user.user_id}`);
        } catch (err) {
          console.error(`Erreur reset streak pour ${user.user_id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Erreur globale Auto-Freeze :", err);
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