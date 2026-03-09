// ============================================================
// CHARGEMENT DES DÉPENDANCES
// ============================================================

require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");
const db = require("./database");
const express = require("express");
const path = require("path");
const { formatInTimeZone, toZonedTime } = require("date-fns-tz");

const TIMEZONE = "Europe/Paris";

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


  // Fonction utilitaire pour récupérer l'heure de Paris
  const getParisDateInfo = () => {
    const now = new Date();
    const isoDate = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd"); // ex: 2023-10-25
    const hourStr = formatInTimeZone(now, TIMEZONE, "HH"); // ex: 08
    const hour = parseInt(hourStr, 10);
    return { now, isoDate, hour };
  };

  // -------------------------
  // COMMANDE CHECK-IN MATINAL (!checkin)
  // -------------------------
  if (message.content.startsWith("!checkin")) {
    const { isoDate, hour } = getParisDateInfo();

    // Vérification de l'heure (00:00 à 08:59)
    if (hour >= 9) {
      return message.reply("❌ Trop tard ! Le check-in matinal n'est disponible qu'entre 00h00 et 08h59 (Heure de Paris).");
    }

    try {
      // On insère le checkin_date, mais on veut aussi lire la priorité
      const { rows } = await db.query(
        `INSERT INTO users (user_id, checkin_date) 
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET checkin_date = $2
         RETURNING current_priority`,
        [userId, isoDate]
      );

      const priority = rows[0]?.current_priority;

      if (priority) {
        message.reply(`✅ Check-in validé ! Rappel de ta priorité du jour : **${priority}**. Au boulot ! (Tape \`!start\` quand tu commences)`);
      } else {
        message.reply("✅ Check-in validé ! Bon courage pour tes objectifs du jour. N'oublie pas de lancer `!start` quand tu commences en Deep Work.");
      }
    } catch (err) {
      console.error("Erreur !checkin :", err);
      message.reply("❌ Une erreur est survenue : " + err.message);
    }
  }

  // -------------------------
  // COMMANDE START TIMER (!start)
  // -------------------------
  if (message.content.startsWith("!start")) {
    try {
      const { rows } = await db.query(`SELECT session_start FROM users WHERE user_id = $1`, [userId]);
      if (rows.length > 0 && rows[0].session_start) {
        return message.reply("⏳ Une session de Deep Work est déjà en cours ! Utilise `!stop` pour l'arrêter.");
      }

      const isoNow = new Date().toISOString();
      await db.query(
        `INSERT INTO users (user_id, session_start) 
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET session_start = $2`,
        [userId, isoNow]
      );
      message.reply("⏱️ Session de Deep Work démarrée ! Reste focus, on lâche rien. Tape `!stop` quand tu as terminé ou que tu fais une pause.");
    } catch (err) {
      console.error("Erreur !start :", err);
      message.reply("❌ Une erreur est survenue : " + err.message);
    }
  }

  // -------------------------
  // COMMANDE STOP TIMER (!stop)
  // -------------------------
  if (message.content.startsWith("!stop")) {
    try {
      const { rows } = await db.query(`SELECT session_start, total_minutes FROM users WHERE user_id = $1`, [userId]);

      if (!rows || rows.length === 0 || !rows[0].session_start) {
        return message.reply("❌ Aucune session en cours. Tape `!start` pour en lancer une.");
      }

      const sessionStart = new Date(rows[0].session_start);
      const diffMs = new Date() - sessionStart;
      const minutes = Math.floor(diffMs / 60000);

      if (minutes < 1) {
        // Annuler la session si moins d'1 minute
        await db.query(`UPDATE users SET session_start = NULL WHERE user_id = $1`, [userId]);
        return message.reply("⚠️ Session annulée (moins d'une minute écoulée).");
      }

      const oldTotal = rows[0].total_minutes || 0;
      const newTotal = oldTotal + minutes;
      const oldFreezes = Math.floor(oldTotal / 500);
      const newFreezes = Math.floor(newTotal / 500);
      const earned = newFreezes - oldFreezes;

      await db.query(`
        UPDATE users 
        SET total_minutes = total_minutes + $1,
            year_minutes = year_minutes + $1,
            month_minutes = month_minutes + $1,
            week_minutes = week_minutes + $1,
            today_minutes = today_minutes + $1,
            freezes_available = freezes_available + $2,
            session_start = NULL
        WHERE user_id = $3
      `, [minutes, earned, userId]);

      let rewardMsg = `⏸️ Session terminée : **${minutes} minutes** ajoutées !`;
      if (earned > 0) {
        rewardMsg += `\n❄️ Bravo ! Tu as franchi un palier et gagné **${earned} Streak Freeze(s)** !`;
      }
      message.reply(rewardMsg);
    } catch (err) {
      console.error("Erreur !stop :", err);
      message.reply("❌ Une erreur est survenue : " + err.message);
    }
  }

  // -------------------------
  // COMMANDE CHECK-OUT DU SOIR (!checkout)
  // -------------------------
  if (message.content.startsWith("!checkout")) {
    const { isoDate, hour } = getParisDateInfo();

    // Vérification de l'heure (21:00 à 23:59)
    if (hour < 21) {
      return message.reply("❌ Trop tôt ! Le check-out du soir n'est disponible qu'entre 21h00 et 23h59 (Heure de Paris).");
    }

    try {
      const { rows } = await db.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
      const user = rows[0];

      if (!user) {
        return message.reply("❌ Utilisateur introuvable.");
      }

      if (user.checkout_date === isoDate) {
        return message.reply(`✅ Tu as déjà fait ton check-out aujourd'hui ! Streak actuel : 🔥 ${user.current_streak} jours`);
      }

      // VÉRIFICATION DES CONDITIONS DE STREAK (Pré-calcul)
      const hasCheckedIn = user.checkin_date === isoDate;
      const hasWorked = user.today_minutes > 0;

      let streak = user.current_streak || 0;
      let streakMessage = "";

      // QUESTION DE LA PRIORITÉ
      message.reply("C'est noté ! Quelle est ta priorité pour demain ? (Tu as 60 secondes pour répondre dans ce salon)");

      // Création du filtre pour le collecteur de messages
      const filter = (m) => m.author.id === userId;

      try {
        // On attend UN seul message correspondant au filtre, pendant 60 secondes max
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const priorityMessage = collected.first();
        const userPriority = priorityMessage.content;

        // Si on arrive ici, l'utilisateur a répondu à temps !
        if (hasCheckedIn && hasWorked) {
          const yesterdayDate = new Date();
          yesterdayDate.setDate(yesterdayDate.getDate() - 1);
          const yesterday = formatInTimeZone(yesterdayDate, TIMEZONE, "yyyy-MM-dd");

          if (user.checkout_date === yesterday || streak === 0) {
            streak += 1;
          } else {
            streak = 1;
          }
          streakMessage = `✅ Conditions remplies ! Ton streak monte à 🔥 **${streak} jours** !`;
        } else {
          streakMessage = `⚠️ Tu fais ton check-out, mais tu n'as pas rempli les devoirs du jour (Check-in ce matin ET temps de travail). Ton streak ne montera pas.`;
        }

        // Sauvegarde PENDANT le check-out
        await db.query(`
          UPDATE users 
          SET checkout_date = $1,
              current_streak = $2,
              last_checkin = $1,
              current_priority = $3
          WHERE user_id = $4
        `, [isoDate, streak, userPriority, userId]);

        // --- LOGIQUE D'ATTRIBUTION DES RÔLES ---
        try {
          if (message.member && streak > 0 && hasCheckedIn && hasWorked) {
            const targetRole = ROLE_THRESHOLDS.find(r => streak >= r.days);
            if (targetRole) {
              const hasRole = message.member.roles.cache.has(targetRole.id);
              if (!hasRole) await message.member.roles.add(targetRole.id);

              for (const r of ROLE_THRESHOLDS) {
                if (r.id !== targetRole.id && message.member.roles.cache.has(r.id)) {
                  await message.member.roles.remove(r.id);
                }
              }
            }
          }
        } catch (roleErr) {
          console.error("Erreur rôles (!checkout):", roleErr);
        }

        priorityMessage.reply(`${streakMessage}\nTa priorité "**${userPriority}**" est bien enregistrée. Bonne nuit et à demain !`);

      } catch (timeout) {
        // L'utilisateur n'a pas répondu en 60 secondes
        return message.channel.send(`<@${userId}> ⏱️ Temps écoulé (60 secondes). Ton Check-out a été annulé car tu n'as pas donné ta priorité. Merci de retaper \`!checkout\` quand tu seras prêt !`);
      }

    } catch (err) {
      console.error("Erreur !checkout :", err);
      message.reply("❌ Une erreur interne est survenue : " + err.message);
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

// API : Récupérer les statistiques globales de la communauté (Dashboard MIB)
app.get("/api/stats", async (req, res) => {
  try {
    // Somme totale de tous les temps de la communauté
    const { rows: statsRows } = await db.query(`
      SELECT 
        SUM(today_minutes) AS today,
        SUM(week_minutes) AS week,
        SUM(month_minutes) AS month,
        SUM(year_minutes) AS year,
        SUM(total_minutes) AS all_time 
      FROM users
    `);

    // Nouvelle requête pour compter les sessions actives (deepwork en cours)
    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) AS active_count 
      FROM users 
      WHERE session_start IS NOT NULL
    `);

    const globalStats = statsRows[0];
    const activeCount = parseInt(countRows[0].active_count, 10);

    res.json({
      globalStats: {
        today: parseInt(globalStats.today || 0, 10),
        week: parseInt(globalStats.week || 0, 10),
        month: parseInt(globalStats.month || 0, 10),
        year: parseInt(globalStats.year || 0, 10),
        allTime: parseInt(globalStats.all_time || 0, 10)
      },
      activeCount: activeCount
    });
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
    // On cherche les utilisateurs qui n'ont pas fait de checkout aujourd'hui MAIS qui ont un streak actif
    const { rows } = await db.query(`
      SELECT * FROM users 
      WHERE (checkout_date IS NULL OR checkout_date != $1)
      AND current_streak > 0
    `, [today]);

    for (const user of rows) {
      if (user.freezes_available > 0) {
        try {
          // Consommation du freeze et MAJ des dates pour compenser l'oubli de checkout
          await db.query(`
            UPDATE users 
            SET freezes_available = freezes_available - 1,
                checkout_date = $1,
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

  // RÉINITIALISATION JOURNALIÈRE POUR TOUT LE MONDE À MINUIT
  try {
    await db.query(`UPDATE users SET today_minutes = 0, session_start = NULL`);
    console.log("Remise à zéro de today_minutes et arrêts des chronos oubliés.");
  } catch (err) {
    console.error("Erreur reset journalier (23:59) :", err);
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
    // (Auparavant le today_minutes s'effaçait ici à 21h, ce qui faussait le travail du soir. Il est maintenant à 23h59)
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
// TÂCHE AUTOMATIQUE : RESET MENSUEL (1ER DU MOIS À MINUIT)
// ============================================================

cron.schedule("0 0 1 * *", async () => {
  try {
    await db.query(`UPDATE users SET month_minutes = 0`);
    console.log("Reset des minutes mensuelles");
  } catch (err) {
    console.error("Erreur reset mensuel :", err);
  }
});


// ============================================================
// TÂCHE AUTOMATIQUE : RESET ANNUEL (1ER JANVIER À MINUIT)
// ============================================================

cron.schedule("0 0 1 1 *", async () => {
  try {
    await db.query(`UPDATE users SET year_minutes = 0`);
    console.log("Reset des minutes annuelles");
  } catch (err) {
    console.error("Erreur reset annuel :", err);
  }
});


// ============================================================
// CONNEXION DU BOT À DISCORD
// ============================================================

client.login(process.env.TOKEN);