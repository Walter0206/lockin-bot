// ============================================================
// CHARGEMENT DES DÉPENDANCES
// ============================================================

require("dotenv").config();

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const cron = require("node-cron");
const db = require("./database");
const express = require("express");
const path = require("path");
const { formatInTimeZone, toZonedTime } = require("date-fns-tz");
const crypto = require("crypto");
const Stripe = require("stripe");

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

const TIMEZONE = "Europe/Paris";

// ============================================================
// CONFIGURATION DES RÔLES DE SÉRIE
// ============================================================

// Les rôles doivent être classés du plus grand nombre de jours au plus petit !
const ROLE_THRESHOLDS = [
  { days: 2500, id: "1482342432430624768", name: "Médecin" },
  { days: 2000, id: "1482342369604010175", name: "Externe" },
  { days: 1500, id: "1482342288809136291", name: "Bachelor" },
  { days: 1000, id: "1482341864349634745", name: "Grand Maître" },
  { days: 500, id: "1482341763237675018", name: "Maître" },
  { days: 250, id: "1482341671218974893", name: "Grand Sage" },
  { days: 200, id: "1482341571117715547", name: "Sage" },
  { days: 150, id: "1482341484807192586", name: "Moine" },
  { days: 100, id: "1482341391500709969", name: "Stoïque" },
  { days: 75, id: "1482341302891843634", name: "Endurant" },
  { days: 50, id: "1482341210000588902", name: "Consistant" },
  { days: 30, id: "1482341136793337866", name: "Discipliné" },
  { days: 14, id: "1482333459409014935", name: "Concentré" },
  { days: 7, id: "1482333383282397356", name: "Engagé" },
  { days: 3, id: "1482333301640532050", name: "Étudiant" },
  { days: 1, id: "1482333207356506315", name: "Déterminé" }
];

// Nouveaux rôles d'accès
const ROLE_PAID = process.env.DISCORD_PAID_ROLE_ID;
const ROLE_VERIFIED = process.env.DISCORD_VERIFIED_ROLE_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const ADMIN_ID = process.env.ADMIN_ID; // Ton ID Discord pour recevoir les alertes d'exclusion

console.log(`[Startup] Config Rôles: Paid=${ROLE_PAID}, Verified=${ROLE_VERIFIED}, Guild=${GUILD_ID}`);

// IDs des salons pour les logs silencieux
const CHAN_INTENTIONS = "1482418496586387666";
const CHAN_LIVE = "1482418541390205011";
const CHAN_BILANS = "1482419158011482132";

// Fonction utilitaire pour envoyer des messages silencieux
async function sendSilentMessage(channelId, content) {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send({
        content: content,
        flags: [4096] // MessageFlags.SuppressNotifications
      });
    }
  } catch (err) {
    console.error(`Erreur lors de l'envoi du message silencieux sur canal ${channelId}:`, err);
  }
}

/**
 * Synchronise les rôles d'un membre de manière atomique (plus robuste).
 * @param {GuildMember} member 
 * @param {number} serie 
 */
async function synchronizeMemberRoles(member, serie) {
  if (!member) return;
  try {
    // 1. Récupérer les rôles actuels du membre qui NE sont PAS gérés par le bot
    // (pour les conserver précieusement)
    const allSerieRoleIds = ROLE_THRESHOLDS.map(r => r.id);
    const managedRoleIds = [...allSerieRoleIds, ROLE_PAID, ROLE_VERIFIED];
    
    const otherRoles = member.roles.cache
      .filter(role => !managedRoleIds.includes(role.id))
      .map(role => role.id);

    // 2. Déterminer quels rôles gérés le membre DOIT avoir
    const rolesToHave = [];

    // Rôle de série (selon jours)
    const targetSerieRole = ROLE_THRESHOLDS.find(r => serie >= r.days);
    if (targetSerieRole) rolesToHave.push(targetSerieRole.id);

    // Rôle Verified (Engagement) - Uniquement si ROLE_VERIFIED est défini
    if (ROLE_VERIFIED) {
      // On vérifie en base (ou via l'état actuel) si le membre est censé être Verified
      const { rows } = await db.query("SELECT commitment_signed FROM users WHERE user_id = $1", [member.id]);
      if (rows[0]?.commitment_signed) {
        rolesToHave.push(ROLE_VERIFIED);
      } else if (ROLE_PAID) {
        // S'il n'est pas Verified, on lui laisse le rôle Paid (Onboarding)
        rolesToHave.push(ROLE_PAID);
      }
    }

    // 3. Fusionner et appliquer (Atomic Set)
    const finalRoles = [...new Set([...otherRoles, ...rolesToHave])];
    
    // Comparaison simple pour éviter l'appel API si rien ne change
    const currentRoleIds = member.roles.cache.map(r => r.id);
    const hasChanges = finalRoles.length !== currentRoleIds.length || finalRoles.some(id => !currentRoleIds.includes(id));

    if (hasChanges) {
      await member.roles.set(finalRoles);
      console.log(`[Roles] Synchronisation terminée pour ${member.user.tag} (Rôles: ${rolesToHave.length} gérés, ${otherRoles.length} autres)`);
    }
  } catch (err) {
    console.error(`❌ Erreur synchronisation rôles pour ${member.user.tag}:`, err.message);
  }
}

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

client.on("ready", async () => {
  console.log(`Bot connecté à Discord en tant que ${client.user.tag}`);

  // Vérification de sécurité au démarrage : Hiérarchie des rôles
  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (guild) {
      const botMember = await guild.members.fetch(client.user.id);
      const topRole = botMember.roles.highest;
      console.log(`[Startup] Rôle le plus haut du bot : ${topRole.name} (Position: ${topRole.position})`);

      // Trouver le rôle de série le plus haut pour comparer
      const highestSerieRole = ROLE_THRESHOLDS[0];
      const targetRole = guild.roles.cache.get(highestSerieRole.id);

      if (targetRole && topRole.position <= targetRole.position) {
        console.warn(`⚠️ ALERTE PERMISSIONS : Le rôle du bot (${topRole.name}) est INFÉRIEUR ou ÉGAL au rôle ${targetRole.name}. Le bot ne pourra pas gérer les grades de série. Merci de déplacer le rôle du bot en haut de la liste dans les paramètres du serveur.`);
      } else {
        console.log("✅ Permissions de hiérarchie des rôles validées.");
      }
    }
  } catch (err) {
    console.warn("⚠️ Impossible de vérifier la hiérarchie des rôles au démarrage :", err.message);
  }
});


// ============================================================
// ÉVÉNEMENT : INTERACTION REÇU (SLASH COMMANDS)
// ============================================================

client.on("interactionCreate", async (interaction) => {
  // Ignorer les interactions qui ne viennent pas d'un membre ou d'un serveur (sécurité)
  if (!interaction.guild) return;

  console.log(`[Interaction] Type: ${interaction.type} | User: ${interaction.user.tag} | ID: ${interaction.customId || interaction.commandName}`);
  const userId = interaction.user.id;
  const channelId = interaction.channelId;

  // --- RESTRICTIONS DE CANAUX (Pour garder le serveur propre) ---
  const RESTRICTED_COMMANDS = {
    "checkin": "1482418496586387666", // #intentions
    "checkout": "1482419158011482132", // #bilans
    "stop": "1482418541390205011",    // #travail-silencieux
    "start": "1482418541390205011"    // #travail-silencieux
  };

  if (interaction.isCommand() && RESTRICTED_COMMANDS[interaction.commandName]) {
    const targetChannelId = RESTRICTED_COMMANDS[interaction.commandName];
    if (channelId !== targetChannelId) {
      return await interaction.reply({
        content: `❌ Cette commande doit être utilisée dans le salon <#${targetChannelId}> pour ne pas polluer les autres canaux. Merci !`,
        ephemeral: true
      });
    }
  }


  // Fonction utilitaire pour récupérer l'heure de Paris
  const getParisDateInfo = () => {
    const now = new Date();
    const isoDate = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd"); // ex: 2023-10-25
    const hourStr = formatInTimeZone(now, TIMEZONE, "HH"); // ex: 08
    const hour = parseInt(hourStr, 10);
    return { now, isoDate, hour };
  };

  // Fonction utilitaire pour assurer qu'un utilisateur possède un secret_id
  const ensureSecretId = async (uid) => {
    const { rows } = await db.query(`SELECT secret_id FROM users WHERE user_id = $1`, [uid]);
    if (rows.length > 0 && rows[0].secret_id) {
      return rows[0].secret_id;
    }
    // Génération d'un UUID s'il n'existe pas
    const newSecret = crypto.randomUUID();
    await db.query(`UPDATE users SET secret_id = $1 WHERE user_id = $2`, [newSecret, uid]);
    return newSecret;
  };

  // -------------------------
  // COMMANDE PROFIL (/profil)
  // -------------------------
  if (interaction.commandName === "profil") {
    try {
      // On s'assure qu'il existe dans la DB
      await db.query(
        `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      const secret = await ensureSecretId(userId);

      // On envoie le lien en Message Privé
      const dmChannel = await interaction.user.createDM();
      await dmChannel.send(`👋 Bonjour ! Voici le lien vers ton tableau de bord personnel ultra-secret. Garde-le précieusement, il te permet de voir tes statistiques individuelles au sein de la communauté Med in silence !\n\n👉 **https://lockin-bot-production-e71a.up.railway.app/?profil=${secret}**`);

      await interaction.reply({ content: "✅ Je t'ai envoyé le lien vers ton tableau de bord personnel en Message Privé !", ephemeral: true });
    } catch (err) {
      console.error("Erreur !profil :", err);
      await interaction.reply({ content: "❌ Impossible de t'envoyer un message privé. Vérifie tes paramètres de confidentialité Discord !", ephemeral: true });
    }
  }

  // -------------------------
  // COMMANDE CHECK-IN MATINAL (/checkin)
  // -------------------------
  if (interaction.commandName === "checkin") {
    const { isoDate, hour } = getParisDateInfo();

    // Vérification de l'heure (00h00 à 09h59)
    if (hour >= 10) {
      return await interaction.reply({ content: "❌ Trop tard ! L'intention matinale (/checkin) n'est disponible qu'entre 00h00 et 10h00 (Heure de Paris).", ephemeral: true });
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
        await interaction.reply({ content: `✅ Check-in validé ! Rappel de ta priorité du jour : **${priority}**. Au boulot ! (Tape \`/start\` quand tu commences)`, ephemeral: true });
        // Log Silencieux
        await sendSilentMessage(CHAN_INTENTIONS, `🌱 **${interaction.user.tag}** a posé son intention : *${priority}*`);
      } else {
        await interaction.reply({ content: "✅ Check-in validé ! Bon courage pour tes objectifs du jour. N'oublie pas de lancer `/start` quand tu commences en Travail silencieux.", ephemeral: true });
        // Log Silencieux
        await sendSilentMessage(CHAN_INTENTIONS, `🌱 **${interaction.user.tag}** a validé sa présence le matin.`);
      }

      // Assurer la création de l'UUID en fond
      await ensureSecretId(userId);
    } catch (err) {
      console.error("Erreur !checkin :", err);
      await interaction.reply({ content: "❌ Une erreur est survenue : " + err.message, ephemeral: true });
    }
  }

  // -------------------------
  // COMMANDE START TIMER (/start)
  // -------------------------
  if (interaction.commandName === "start") {
    try {
      const { rows } = await db.query(`SELECT session_start FROM users WHERE user_id = $1`, [userId]);
      if (rows.length > 0 && rows[0].session_start) {
        return await interaction.reply({ content: "⏳ Une session de Travail silencieux est déjà en cours ! Utilise `/stop` pour l'arrêter.", ephemeral: true });
      }

      const isoNow = new Date().toISOString();
      await db.query(
        `INSERT INTO users (user_id, session_start) 
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET session_start = $2`,
        [userId, isoNow]
      );
      await interaction.reply({ content: "⏱️ Session de Travail silencieux démarrée ! Reste focus, on lâche rien. Tape `/stop` quand tu as terminé ou que tu fais une pause.", ephemeral: true });

      // Log Silencieux
      await sendSilentMessage(CHAN_LIVE, `🚀 **${interaction.user.tag}** vient de se lancer en *Travail silencieux*.`);

      // Assurer la création de l'UUID en fond
      await ensureSecretId(userId);
    } catch (err) {
      console.error("Erreur !start :", err);
      await interaction.reply({ content: "❌ Une erreur est survenue : " + err.message, ephemeral: true });
    }
  }

  // -------------------------
  // COMMANDE STOP TIMER (/stop)
  // -------------------------
  if (interaction.commandName === "stop") {
    try {
      const { rows } = await db.query(`SELECT session_start, total_minutes FROM users WHERE user_id = $1`, [userId]);

      if (!rows || rows.length === 0 || !rows[0].session_start) {
        return await interaction.reply({ content: "❌ Aucune session en cours. Tape `/start` pour en lancer une.", ephemeral: true });
      }

      const sessionStart = new Date(rows[0].session_start);
      const diffMs = new Date() - sessionStart;
      let minutes = Math.floor(diffMs / 60000);

      if (minutes < 1) {
        // Annuler la session si moins d'1 minute
        await db.query(`UPDATE users SET session_start = NULL WHERE user_id = $1`, [userId]);
        return await interaction.reply({ content: "⚠️ Session annulée (moins d'une minute écoulée).", ephemeral: true });
      }

      // ANTI-CHEAT : Plafond de 3 heures maximales par session de Travail silencieux
      let wasCapped = false;
      if (minutes > 180) {
        minutes = 180;
        wasCapped = true;
      }

      const oldTotal = rows[0].total_minutes || 0;
      const newTotal = oldTotal + minutes;
      const oldGels = Math.floor(oldTotal / 500);
      const newGels = Math.floor(newTotal / 500);
      const earned = newGels - oldGels;

      await db.query(`
        UPDATE users 
        SET total_minutes = total_minutes + $1,
            year_minutes = year_minutes + $1,
            month_minutes = month_minutes + $1,
            week_minutes = week_minutes + $1,
            today_minutes = today_minutes + $1,
            gels_disponibles = gels_disponibles + $2,
            session_start = NULL
        WHERE user_id = $3
      `, [minutes, earned, userId]);

      let rewardMsg = `⏸️ Session terminée : **${minutes} minutes** ajoutées !`;

      // Ajout du message d'avertissement en cas de dépassement
      if (wasCapped) {
        rewardMsg += `\n⚠️ **Attention :** Ta session dépassait 3 heures sans pause. Pour ta santé et l'intégrité de la communauté, le temps ajouté a été plafonné à **3h (180 minutes)**. Si c'était un oubli honnête, rattrape la différence lors de ta prochaine session de travail **sans activer le compteur** pour rééquilibrer ton total. 😉`;
      }

      if (earned > 0) {
        rewardMsg += `\n❄️ Bravo ! Tu as franchi un palier et gagné **${earned} Gel(s) de série** !`;
      }
      await interaction.reply({ content: rewardMsg, ephemeral: true });

      // Log Silencieux
      await sendSilentMessage(CHAN_LIVE, `⏸️ **${interaction.user.tag}** a terminé sa session de travail (**${minutes} minutes** ajoutées).`);
    } catch (err) {
      console.error("Erreur !stop :", err);
      await interaction.reply({ content: "❌ Une erreur est survenue : " + err.message, ephemeral: true });
    }
  }

  // -------------------------
  // COMMANDE CHECK-OUT DU SOIR (/checkout)
  // -------------------------
  if (interaction.commandName === "checkout") {
    const { isoDate, hour } = getParisDateInfo();

    // Vérification de l'heure (19h00 à 23h59)
    if (hour < 19) {
      return await interaction.reply({ content: "❌ Trop tôt ! Le bilan du soir (/checkout) n'est disponible qu'entre 19h00 et 23h59 (Heure de Paris).", ephemeral: true });
    }

    try {
      const { rows } = await db.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
      const user = rows[0];

      if (!user) {
        return await interaction.reply({ content: "❌ Utilisateur introuvable.", ephemeral: true });
      }

      // Conversion des dates Postgres en format YYYY-MM-DD pour comparaison simple (Timezone safe)
      const userCheckoutDate = user.checkout_date ? formatInTimeZone(new Date(user.checkout_date), TIMEZONE, "yyyy-MM-dd") : null;

      if (userCheckoutDate === isoDate) {
        return await interaction.reply({ content: `✅ Tu as déjà fait ton check-out aujourd'hui ! Série actuelle : 🔥 ${user.current_serie} jours`, ephemeral: true });
      }

      // VÉRIFICATION DES CONDITIONS DE SÉRIE (Pré-calcul)
      const hasCheckedIn = user.checkin_date ? formatInTimeZone(new Date(user.checkin_date), TIMEZONE, "yyyy-MM-dd") === isoDate : false;
      const hasWorked = (user.today_minutes || 0) >= 30;

      let serie = user.current_serie || 0;
      let serieMessage = "";

      // -------------------------
      // ÉTAPE 1 : VALIDATION IMMÉDIATE DE LA SÉRIE
      // -------------------------

      if (hasCheckedIn && hasWorked) {
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = formatInTimeZone(yesterdayDate, TIMEZONE, "yyyy-MM-dd");

        const lastCheckoutDate = user.checkout_date ? new Date(user.checkout_date).toISOString().split('T')[0] : null;

        if (lastCheckoutDate === yesterday || serie === 0) {
          serie += 1;
        } else {
          serie = 1; // Reprise à 1 s'il y a un trou (bien que géré par les Gels avant)
        }
        serieMessage = `✅ Conditions remplies ! Ta série monte à 🔥 **${serie} jours** !`;
      } else {
        serieMessage = `⚠️ Check-out enregistré, mais tu n'as pas rempli les devoirs du jour (Check-in ce matin ET minimum 30 min de travail). Ta série stagne à **${serie} jours**.`;
      }

      // 1ère Sauvegarde (La série est sécurisée)
      await db.query(`
        UPDATE users 
        SET checkout_date = $1::DATE,
            current_serie = $2,
            checkin_date = $1::DATE,
            failed_days_at_zero = 0
        WHERE user_id = $3
      `, [isoDate, serie, userId]);

      // Processus de Rôles (Optimisé)
      if (interaction.member && serie > 0 && hasCheckedIn && hasWorked) {
        await synchronizeMemberRoles(interaction.member, serie);
      }

      // Envoi du Rapport Quotidien en Message Privé
      try {
        const totalMinutes = user.total_minutes || 0;
        const hours = (totalMinutes / 60).toFixed(1);
        const days = (hours / 24).toFixed(2);
        await interaction.user.send(
          `📊 Daily Travail silencieux Report\n\nAujourd'hui : ${user.today_minutes || 0} minutes\nCette semaine : ${user.week_minutes || 0} minutes\n\nTotal :\n${totalMinutes} minutes\n${hours} heures\n${days} jours`
        );
      } catch (dmErr) {
        console.error("Impossible d'envoyer le rapport quotidien (DM peut-être fermé) :", dmErr);
      }

      const inlinePriority = interaction.options.getString("priorite");

      if (inlinePriority) {
        // L'utilisateur a déjà donné sa priorité dans la commande /checkout
        await db.query(`
          UPDATE users 
          SET current_priority = $1
          WHERE user_id = $2
        `, [inlinePriority, userId]);

        await interaction.reply({ content: `${serieMessage}\n\nTa priorité "**${inlinePriority}**" est bien enregistrée. Bonne nuit et à demain !`, ephemeral: true });
      } else {
        // Mode Discret : Bouton pour ouvrir un Modal
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('open_priority_modal')
              .setLabel('🎯 Définir ma priorité')
              .setStyle(ButtonStyle.Primary),
          );

        await interaction.reply({
          content: `${serieMessage}\n\n🎯 Dernière étape ! Clique sur le bouton ci-dessous pour définir ta priorité pour demain en toute discrétion.`,
          components: [row],
          ephemeral: true
        });
      }

      // --- LOG SILENCIEUX (LE BILAN PUBLIC) ---
      const gradeInfo = ROLE_THRESHOLDS.find(r => serie >= r.days);
      const gradeName = gradeInfo ? gradeInfo.name : "Débutant";
      let publicBilan = `🌌 **Bilan de ${interaction.user.tag}**\n`;
      publicBilan += `🔥 Série actuelle : **${serie} jours** (Grade : *${gradeName}*)\n`;
      const finalPriority = inlinePriority || user.current_priority;
      if (finalPriority) publicBilan += `🎯 Demain, sa priorité est : *${finalPriority}*`;

      await sendSilentMessage(CHAN_BILANS, publicBilan);

    } catch (err) {
      console.error("Erreur !checkout :", err);
      if (!interaction.replied) {
        await interaction.reply({ content: "❌ Une erreur interne est survenue : " + err.message, ephemeral: true });
      }
    }
  }

  // --- GESTION DU MODAL ET DES BOUTONS ---

  if (interaction.isButton()) {
    if (interaction.customId === 'open_priority_modal') {
      const modal = new ModalBuilder()
        .setCustomId('priority_modal')
        .setTitle('Priorité pour demain');

      const priorityInput = new TextInputBuilder()
        .setCustomId('priorityInput')
        .setLabel("Quelle est ta priorité pour demain ?")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: Avancer sur le chapitre 3...")
        .setRequired(true);

      const firstActionRow = new ActionRowBuilder().addComponents(priorityInput);
      modal.addComponents(firstActionRow);

      await interaction.showModal(modal);
    }

    if (interaction.customId === 'open_commitment_modal') {
      const modal = new ModalBuilder()
        .setCustomId('commitment_modal')
        .setTitle('Mon Contrat d\'Engagement');

      const motivationsInput = new TextInputBuilder()
        .setCustomId('motivationsInput')
        .setLabel("Pourquoi veux-tu réussir médecine ?")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Tes motivations profondes...")
        .setRequired(true);

      const dailyInput = new TextInputBuilder()
        .setCustomId('commitmentDaily')
        .setLabel("T'engages-tu à travailler chaque jour ?")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Oui, je m'y engage !")
        .setRequired(true);

      const dndInput = new TextInputBuilder()
        .setCustomId('commitmentDnd')
        .setLabel("Activeras-tu le mode 'Ne pas déranger' ?")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Oui, c'est promis !")
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(motivationsInput),
        new ActionRowBuilder().addComponents(dailyInput),
        new ActionRowBuilder().addComponents(dndInput)
      );

      await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'priority_modal') {
      const userPriority = interaction.fields.getTextInputValue('priorityInput');

      try {
        await db.query(`
          UPDATE users 
          SET current_priority = $1
          WHERE user_id = $2
        `, [userPriority, userId]);

        await interaction.reply({
          content: `✅ Ta priorité "**${userPriority}**" est bien enregistrée. Bonne nuit et à demain !`,
          ephemeral: true
        });
      } catch (err) {
        console.error("Erreur Modal Submit :", err);
        await interaction.reply({ content: "❌ Erreur lors de l'enregistrement de ta priorité.", ephemeral: true });
      }
    }

    if (interaction.customId === 'commitment_modal') {
      const motivations = interaction.fields.getTextInputValue('motivationsInput');
      const userId = interaction.user.id;

      try {
        const isoNow = new Date().toISOString();

        // 1. D'abord on enregistre en base de données (Le plus important)
        await db.query(`
            UPDATE users 
            SET motivations = $1,
                commitment_signed = TRUE,
                signed_at = $2,
                gels_disponibles = 2,
                failed_days_at_zero = 0
            WHERE user_id = $3
          `, [motivations, isoNow, userId]);

        console.log(`✅ Contrat signé en base pour ${interaction.user.tag}`);

        // 2. Ensuite on tente de gérer les rôles (Optimisé)
        try {
          const guild = interaction.guild || await client.guilds.fetch(GUILD_ID);
          const member = await guild.members.fetch(userId);
          await synchronizeMemberRoles(member, 0); // O jours car signature, mais Verified sera ajouté
        } catch (roleErr) {
          console.warn(`⚠️ Impossible de modifier les rôles de ${interaction.user.tag} :`, roleErr.message);
        }

        await interaction.reply({
          content: "🎉 **Félicitations ! Ton contrat est signé.**\n\nTu as maintenant accès à tous les salons de la communauté. Bienvenue officiellement parmi les Lockins ! 💪",
          ephemeral: true
        });
      } catch (err) {
        console.error("Erreur critique Commitment Modal :", err);
        if (!interaction.replied) {
          await interaction.reply({ content: "❌ Une erreur est survenue lors de la validation de ton contrat.", ephemeral: true });
        }
      }
    }
  }

  // -------------------------
  // COMMANDE PRIORITÉ (/priorite)
  // -------------------------
  if (interaction.commandName === "priorite") {
    const newPriority = interaction.options.getString("message");

    try {
      // On s'assure que l'utilisateur existe dans la DB
      await db.query(
        `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      await db.query(
        `UPDATE users SET current_priority = $1 WHERE user_id = $2`,
        [newPriority, userId]
      );

      await interaction.reply({
        content: `✅ Ta priorité a été mise à jour : "**${newPriority}**". Elle est maintenant visible sur ton tableau de bord !`,
        ephemeral: true
      });
    } catch (err) {
      console.error("Erreur /priorite :", err);
      await interaction.reply({
        content: "❌ Une erreur est survenue lors de la mise à jour de ta priorité : " + err.message,
        ephemeral: true
      });
    }
  }

  // -------------------------
  // COMMANDE SETUP ONBOARDING (/setup-onboarding)
  // -------------------------
  if (interaction.commandName === "setup-onboarding") {
    // Vérification admin
    if (!interaction.member.permissions.has("Administrator")) {
      return await interaction.reply({ content: "❌ Seuls les administrateurs peuvent utiliser cette commande.", ephemeral: true });
    }

    const embed = {
      title: "✍️ Contrat d'Engagement - Med in silence",
      description: "Pour accéder à la communauté et débloquer tous les salons, tu dois signer ton contrat d'engagement.\n\n" +
        "Ce n'est pas qu'une simple formalité : c'est un engagement envers toi-même et envers les autres membres.\n\n" +
        "**En cliquant sur le bouton ci-dessous, tu t'engages à :**\n" +
        "1️⃣ Travailler un peu chaque jour pour réussir tes études.\n" +
        "2️⃣ Utiliser le mode 'Ne pas déranger' lors de tes sessions.\n" +
        "3️⃣ Être un membre actif et bienveillant.\n\n" +
        "Clique sur le bouton pour remplir ton contrat !",
      color: 0x00ff00
    };

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('open_commitment_modal')
          .setLabel('Signer mon contrat')
          .setStyle(ButtonStyle.Success)
          .setEmoji('📝')
      );

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  // -------------------------
  // COMMANDE MIGRATION (/migrer-membres)
  // -------------------------
  if (interaction.commandName === "migrer-membres") {
    if (!interaction.member.permissions.has("Administrator")) {
      return await interaction.reply({ content: "❌ Seuls les administrateurs peuvent utiliser cette commande.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const { rows } = await db.query(`SELECT user_id, current_serie FROM users WHERE current_serie > 0`);

      let count = 0;
      let rolesCount = 0;
      let errors = [];
      const guild = interaction.guild;

      if (!guild) {
        return await interaction.editReply({ content: "❌ Erreur : Cette commande doit être lancée depuis un serveur." });
      }

      for (const row of rows) {
        try {
          // Utiliser fetch pour être sûr d'avoir les données à jour
          const member = await guild.members.fetch(row.user_id).catch(() => null);
          if (!member) continue;

          // 1. & 2. Gérer rôles de base et hiérarchie (Optimisé)
          await synchronizeMemberRoles(member, row.current_serie);
          count++;
          rolesCount++;
        } catch (mErr) {
          errors.push(`Système: Erreur pour ID ${row.user_id} : ${mErr.message}`);
        }
      }

      let responseText = `✅ **Migration terminée !**\n\n`;
      responseText += `• **${count}** membres ont reçu le rôle de base.\n`;
      responseText += `• **${rolesCount}** grades de hiérarchie synchronisés.\n`;

      if (errors.length > 0) {
        responseText += `\n⚠️ **Erreurs rencontrées (${errors.length}) :**\n`;
        responseText += "```" + errors.slice(0, 10).join("\n") + (errors.length > 10 ? "\n..." : "") + "```";
        responseText += "\n> _Si l'erreur est 'Missing Permissions', assure-toi que le rôle du bot est positionné TOUT EN HAUT de la liste des rôles dans les paramètres Discord._";
      }

      await interaction.editReply({ content: responseText });
    } catch (err) {
      console.error("Erreur migration :", err);
      await interaction.editReply({ content: "❌ Une erreur fatale est survenue : " + err.message });
    }
  }


  // -------------------------
  // COMMANDE CLASSEMENT (/classement)
  // -------------------------
  if (interaction.commandName === "classement") {
    try {
      const { rows } = await db.query(`
        SELECT user_id, current_serie 
        FROM users 
        WHERE current_serie > 0 
        ORDER BY current_serie DESC 
        LIMIT 50
      `);

      if (rows.length === 0) {
        return await interaction.reply({ content: "🏆 Le classement est encore vide. Soyez le premier à valider votre série !", ephemeral: true });
      }

      let description = "";
      const medals = ["🥇", "🥈", "🥉"];

      for (let i = 0; i < rows.length; i++) {
        const serie = rows[i].current_serie;

        // Trouver le grade correspondant à la série
        const currentGrade = ROLE_THRESHOLDS.find(r => serie >= r.days);
        const gradeName = currentGrade ? currentGrade.name : "Débutant";

        // Emojis spécifiques pour le top 3 ou par palier
        let emojiPrefix = "🔹";
        if (serie >= 2500) emojiPrefix = "🩺";
        else if (serie >= 1500) emojiPrefix = "🎓";
        else if (serie >= 500) emojiPrefix = "⚔️";
        else if (serie >= 100) emojiPrefix = "🏛️";
        else if (serie >= 30) emojiPrefix = "🛡️";

        const medal = medals[i] || emojiPrefix;
        description += `${medal} **<@${rows[i].user_id}>** : \`${serie}j\` (${gradeName})\n`;
      }

      const embed = {
        title: "🏆 TOP 50 - La Hiérarchie de la Consistance",
        description: description,
        color: 0xFFD700, // Gold
        thumbnail: {
          url: client.user.displayAvatarURL()
        },
        footer: {
          text: "Seul toi peux voir ce message. La régularité paye toujours ! 💪"
        },
        timestamp: new Date()
      };

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error("Erreur !classement :", err);
      await interaction.reply({ content: "❌ Une erreur est survenue lors de la récupération du classement.", ephemeral: true });
    }
  }

  // -------------------------
  // COMMANDE SETUP HIERARCHY (/setup-hierarchy)
  // -------------------------
  if (interaction.commandName === "setup-hierarchy") {
    if (!interaction.member.permissions.has("Administrator")) {
      return await interaction.reply({ content: "❌ Seuls les administrateurs peuvent utiliser cette commande.", ephemeral: true });
    }

    const embed = {
      title: "🏔️ La Montagne de la Consistance",
      description: "Voici les grades que tu peux débloquer sur le serveur en maintenant ta série quotidienne. " +
        "Chaque palier franchi montre ta détermination et ton engagement envers tes objectifs.\n\n" +
        "**📚 Les Paliers Majeurs :**\n" +
        "🩺 **Médecin** (2500 jours) : L'aboutissement de 7 ans de discipline.\n" +
        "🎓 **Bachelor/Externe** (1500-2000 jours) : La haute expertise.\n" +
        "⚔️ **Maître** (500-1000 jours) : La maîtrise absolue du silence.\n" +
        "🏛️ **Stoïque/Sage** (100-250 jours) : La sagesse ancrée.\n" +
        "🛡️ **Discipliné/Consistant** (30-75 jours) : L'habitude est une seconde nature.\n" +
        "🌱 **Déterminé/Engagé** (1-14 jours) : Les fondations de ta réussite.\n\n" +
        "**🔄 Le Cycle de la Réussite :**\n" +
        "1️⃣ **Matin (00h-10h)** : `/checkin` pour déclarer tes intentions.\n" +
        "2️⃣ **Journée** : `/start` et `/stop` pour mesurer ton effort.\n" +
        "3️⃣ **Soir (19h-00h)** : `/checkout` pour valider ta journée et ta série.\n\n" +
        "*N'oublie pas : La consistance bat l'intensité à chaque fois. Travaille en silence, laisse tes résultats faire du bruit.*",
      color: 0x3498DB, // Blue
      image: {
        url: "https://media.discordapp.net/attachments/1090332851897483264/1113886542617260062/conssitance.jpg"
      }
    };

    await interaction.reply({ embeds: [embed] });
  }

  // -------------------------
  // COMMANDES ADMINISTRATION (Support & Backup)
  // -------------------------
  if (interaction.commandName && interaction.commandName.startsWith("admin-")) {
    // SÉCURITÉ : Vérifier que c'est bien l'admin (VIA ID PERSO)
    if (interaction.user.id !== ADMIN_ID) {
      return await interaction.reply({ content: "❌ Accès refusé. Cette commande est réservée à l'administrateur spécifié.", ephemeral: true });
    }

    // --- INFO UTILISATEUR ---
    if (interaction.commandName === "admin-user-info") {
      const targetUser = interaction.options.getUser("utilisateur");
      const { rows } = await db.query(`SELECT * FROM users WHERE user_id = $1`, [targetUser.id]);

      if (rows.length === 0) return await interaction.reply({ content: "❌ Utilisateur introuvable en base de données.", ephemeral: true });

      const data = rows[0];
      let msg = `🛡️ **Données Support pour ${targetUser.tag}** :\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
      await interaction.reply({ content: msg, ephemeral: true });
    }

    // --- MODIFICATION UTILISATEUR ---
    if (interaction.commandName === "admin-user-edit") {
      const targetUser = interaction.options.getUser("utilisateur");
      const newSerie = interaction.options.getInteger("serie");
      const newGels = interaction.options.getInteger("gels");

      const updates = [];
      const values = [];
      let idx = 1;

      if (newSerie !== null) {
        updates.push(`current_serie = $${idx++}`);
        values.push(newSerie);
      }
      if (newGels !== null) {
        updates.push(`gels_disponibles = $${idx++}`);
        values.push(newGels);
      }

      if (updates.length === 0) return await interaction.reply({ content: "❓ Rien à modifier. Utilise les options `serie` ou `gels`.", ephemeral: true });

      values.push(targetUser.id);
      await db.query(`UPDATE users SET ${updates.join(", ")} WHERE user_id = $${idx}`, values);

      // Synchronisation immédiate des rôles si la série a changé
      if (newSerie !== null) {
        const guild = interaction.guild || await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (member) await synchronizeMemberRoles(member, newSerie);
      }

      await interaction.reply({ content: `✅ Données mises à jour pour **${targetUser.tag}**.`, ephemeral: true });
    }

    // --- EXPORT DATABASE ---
    if (interaction.commandName === "admin-database-export") {
      try {
        const { rows } = await db.query(`SELECT * FROM users`);
        const backupPath = path.join(__dirname, `backup_lockin_${new Date().toISOString().split('T')[0]}.json`);
        const fs = require('fs');
        fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));

        await interaction.user.send({
          content: "📂 **Backup de la base de données** généré avec succès.",
          files: [backupPath]
        });

        // Supprimer le fichier temporaire après envoi
        fs.unlinkSync(backupPath);

        await interaction.reply({ content: "✅ Backup envoyé dans tes messages privés !", ephemeral: true });
      } catch (err) {
        console.error("Erreur Export Admin:", err);
        await interaction.reply({ content: "❌ Erreur lors de l'export : " + err.message, ephemeral: true });
      }
    }

    // --- RESET GLOBAL ALL MEMBERS ---
    if (interaction.commandName === "admin-reset-all") {
      try {
        await interaction.deferReply({ ephemeral: true });

        // 1. Reset Database
        await db.query(`
          UPDATE users 
          SET current_serie = 0,
              total_minutes = 0,
              today_minutes = 0,
              week_minutes = 0,
              month_minutes = 0,
              year_minutes = 0,
              gels_disponibles = 2,
              commitment_signed = FALSE,
              checkin_date = NULL,
              checkout_date = NULL,
              current_priority = NULL,
              motivations = NULL,
              signed_at = NULL,
              session_start = NULL
        `);

        // 2. Reset Discord Roles for everybody in the guild
        const guild = interaction.guild || await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        
        let count = 0;
        const allManagedRoles = [ROLE_PAID, ROLE_VERIFIED, ...ROLE_THRESHOLDS.map(r => r.id)];

        for (const [id, member] of members) {
          const rolesToRemove = member.roles.cache.filter(r => allManagedRoles.includes(r.id));
          if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove).catch(e => console.warn(`Impossible de retirer les rôles à ${member.user.tag}:`, e.message));
            count++;
          }
        }

        await interaction.editReply({ 
          content: `✅ **Remise à zéro effectuée !**\n\n- Base de données réinitialisée pour tous les utilisateurs.\n- Rôles retirés à **${count}** membres.\n\nLe serveur est prêt pour le lancement officiel ! 🚀` 
        });

        console.log(`⚠️ RESET GLOBAL effectué par ${interaction.user.tag}`);
      } catch (err) {
        console.error("Erreur !admin-reset-all :", err);
        await interaction.editReply({ content: "❌ Erreur lors du reset : " + err.message });
      }
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
    const secretId = req.query.profil; // paramètre optionnel ?profil=XYZ

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

    // Nouvelle requête pour compter les sessions actives (travail silencieux en cours)
    const { rows: countRows } = await db.query(`
      SELECT COUNT(*) AS active_count 
      FROM users 
      WHERE session_start IS NOT NULL
    `);

    const globalStats = statsRows[0];
    const activeCount = parseInt(countRows[0].active_count, 10);

    let responsePayload = {
      globalStats: {
        today: parseInt(globalStats.today || 0, 10),
        week: parseInt(globalStats.week || 0, 10),
        month: parseInt(globalStats.month || 0, 10),
        year: parseInt(globalStats.year || 0, 10),
        allTime: parseInt(globalStats.all_time || 0, 10)
      },
      activeCount: activeCount
    };

    // Si un profil est demandé, on tente de récupérer ses données
    if (secretId) {
      const { rows: userRows } = await db.query(`SELECT * FROM users WHERE secret_id = $1`, [secretId]);
      if (userRows.length > 0) {
        const user = userRows[0];
        responsePayload.userStats = {
          serie: user.current_serie,
          gels: user.gels_disponibles,
          priority: user.current_priority || "Aucune priorité définie",
          today: user.today_minutes || 0,
          week: user.week_minutes || 0,
          month: user.month_minutes || 0,
          year: user.year_minutes || 0,
          allTime: user.total_minutes || 0,
          isActive: user.session_start ? true : false,
          sessionStart: user.session_start
        };
      }
    }

    res.json(responsePayload);
  } catch (err) {
    console.error("Erreur API stats :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


// ============================================================
// TÂCHE AUTOMATIQUE : ARRÊT AUTO APRÈS 3H (MAX LIMIT)
// ============================================================

cron.schedule("* * * * *", async () => {
  try {
    const { rows } = await db.query(`SELECT user_id, session_start, total_minutes FROM users WHERE session_start IS NOT NULL`);

    if (!rows || rows.length === 0) return;

    for (const user of rows) {
      const sessionStart = new Date(user.session_start);
      const diffMs = new Date() - sessionStart;
      const minutes = Math.floor(diffMs / 60000);

      // Si la session dépasse 180 minutes (3h)
      if (minutes >= 180) {
        const rewardMinutes = 180;

        const oldTotal = user.total_minutes || 0;
        const newTotal = oldTotal + rewardMinutes;
        const oldGels = Math.floor(oldTotal / 500);
        const newGels = Math.floor(newTotal / 500);
        const earned = newGels - oldGels;

        await db.query(`
          UPDATE users 
          SET total_minutes = total_minutes + $1,
              year_minutes = year_minutes + $1,
              month_minutes = month_minutes + $1,
              week_minutes = week_minutes + $1,
              today_minutes = today_minutes + $1,
              gels_disponibles = gels_disponibles + $2,
              session_start = NULL
          WHERE user_id = $3
        `, [rewardMinutes, earned, user.user_id]);

        let pmMessage = `⚠️ **Arrêt Automatique :** Ta session de Travail silencieux a atteint la limite maximale de 3 heures sans pause. Ta session a été interrompue automatiquement et **180 minutes** ont été créditées à ton profil.\n\nSi tu es toujours en train de travailler, relance un \`/start\` pour démarrer un nouveau bloc. S'il s'agissait d'un oubli de chronomètre, sois honnête et travaille la différence (le surplus que tu aurais théoriquement fait) sans relancer d'autre compteur la prochaine fois. 😉`;

        if (earned > 0) {
          pmMessage += `\n\n❄️ Bonus : Au passage, tu as franchi un palier et gagné **${earned} Gel(s) de série** !`;
        }

        try {
          const u = await client.users.fetch(user.user_id);
          await u.send(pmMessage);
          console.log(`⏱️ Arrêt auto (3h) déclenché pour l'utilisateur ${user.user_id}`);
        } catch (err) {
          console.error(`Impossible d'envoyer le message de stop auto à ${user.user_id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Erreur cron Arrêt Automatique :", err);
  }
});


// ============================================================
// TÂCHE AUTOMATIQUE : GELS DE SÉRIE À 23H59
// ============================================================

cron.schedule("59 23 * * *", async () => {
  const today = new Date().toISOString().split("T")[0];

  try {
    // On cherche tous les utilisateurs actifs/engagés qui n'ont pas validé aujourd'hui
    const { rows } = await db.query(`
      SELECT * FROM users 
      WHERE commitment_signed = TRUE 
      AND (checkout_date IS NULL OR checkout_date != $1)
    `, [today]);

    for (const user of rows) {
      // --- LOGIQUE DU BOUCLIER DE GRÂCE (3 JOURS) ---
      let isUnderGracePeriod = false;
      if (user.signed_at) {
        const signedDate = new Date(user.signed_at);
        const diffMs = new Date() - signedDate;
        const diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours < 72) {
          isUnderGracePeriod = true;
        }
      }

      if (isUnderGracePeriod) {
        // CASE 0: Sous bouclier de grâce -> On sauve la série sans consommer de gel
        try {
          await db.query(`
            UPDATE users 
            SET checkout_date = $1::DATE,
                checkin_date = $1::DATE,
                failed_days_at_zero = 0
            WHERE user_id = $2
          `, [today, user.user_id]);

          const u = await client.users.fetch(user.user_id);
          await u.send(`🛡️ **BOUCLIER DE GRÂCE ACTIVÉ** 🛡️\n\nTu as oublié de valider ta journée aujourd'hui. Comme tu viens de nous rejoindre (moins de 3 jours), j'ai activé ton bouclier de protection pour sauver ta série sans utiliser tes gels. \n\nProfite de cette période pour bien intégrer la routine ! 💪`);
          console.log(`🛡️ Bouclier de grâce utilisé pour ${user.user_id}`);
        } catch (err) { console.error(`Erreur bouclier grâce pour ${user.user_id}:`, err); }
      }
      else if (user.gels_disponibles > 0) {
        // CASE 1: L'utilisateur a des gels -> On en utilise un
        try {
          await db.query(`
            UPDATE users 
            SET gels_disponibles = gels_disponibles - 1,
                checkout_date = $1::DATE,
                checkin_date = $1::DATE,
                date_dernier_gel = $1::DATE,
                failed_days_at_zero = 0
            WHERE user_id = $2
          `, [today, user.user_id]);

          const u = await client.users.fetch(user.user_id);
          await u.send(`❄️ **GEL DE SÉRIE AUTOMATIQUE** ❄️\n\nTu as oublié de valider ta journée aujourd'hui, mais j'ai utilisé un de tes gels pour sauver ta série de **${user.current_serie} jours**..\n\nIl te reste **${user.gels_disponibles - 1}** gel(s).`);
          console.log(`❄️ Gel automatique utilisé pour ${user.user_id}`);
        } catch (err) { console.error(`Erreur gel auto pour ${user.user_id}:`, err); }
      }
      else {
        // CASE 2: Pas de gels -> La série tombe à zéro ou l'inactivité s'accumule
        try {
          let newFailedDays = (user.failed_days_at_zero || 0) + 1;

          if (user.current_serie > 0) {
            // Premier jour d'échec sans gel : Perte de la série
            await db.query(`UPDATE users SET current_serie = 0, failed_days_at_zero = 1 WHERE user_id = $1`, [user.user_id]);

            // Retrait des rôles (Optimisé)
            const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
            const member = await guild?.members.fetch(user.user_id).catch(() => null);
            if (member) {
              await synchronizeMemberRoles(member, 0); // Série à 0 retire tous les grades de consistance
            }

            const u = await client.users.fetch(user.user_id);
            await u.send(`💔 **SÉRIE PERDUE** 💔\n\nTu n'as pas validé ta journée et tu n'as plus de gel disponible. Ta série retombe à 0.\n⚠️ **Attention :** Si tu ne valides pas tes objectifs demain non plus, tu seras exclu(e) de la communauté.`);
            console.log(`💔 Série cassée pour ${user.user_id}`);
          }
          else if (newFailedDays >= 2) {
            // Deuxième jour d'échec à zéro série : EXCLUSION
            await db.query(`
              UPDATE users 
              SET commitment_signed = FALSE, 
                  failed_days_at_zero = 0,
                  current_priority = NULL,
                  motivations = NULL
              WHERE user_id = $1
            `, [user.user_id]);

            const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
            const member = await guild?.members.fetch(user.user_id).catch(() => null);
            if (member && ROLE_VERIFIED) {
              await member.roles.remove(ROLE_VERIFIED);
              if (ROLE_PAID) await member.roles.add(ROLE_PAID); // Retour au rôle d'attente si applicable
            }

            const u = await client.users.fetch(user.user_id);
            await u.send(`🚫 **EXCLUSION TEMPORAIRE** 🚫\n\nTu n'as pas manifesté d'activité depuis 2 jours consécutifs. La discipline est la clé de la réussite.\n\nTon accès aux salons a été suspendu. Pour revenir, tu dois signer de nouveau ton **Contrat d'Engagement** dans le salon dédié.`);
            console.log(`🚫 Utilisateur ${user.user_id} exclu pour inactivité.`);

            // Alerte à l'Administrateur (Toi)
            if (ADMIN_ID) {
              try {
                const admin = await client.users.fetch(ADMIN_ID);
                await admin.send(`🚫 **Alerte Exclusion** : l'utilisateur **${u.tag}** (<@${user.user_id}>) a été suspendu pour inactivité (2 jours sans validation).`);
              } catch (adminErr) {
                console.error("Impossible d'envoyer le DM d'exclusion à l'admin:", adminErr.message);
              }
            }
          }
          else {
            // Incrémenter simplement les jours d'échec (si déjà à 0 série)
            await db.query(`UPDATE users SET failed_days_at_zero = $1 WHERE user_id = $2`, [newFailedDays, user.user_id]);
          }
        } catch (err) { console.error(`Erreur gestion échec pour ${user.user_id}:`, err); }
      }
    }
  } catch (err) {
    console.error("Erreur globale Auto-Gel/Exclusion :", err);
  }

  // RÉINITIALISATION JOURNALIÈRE POUR TOUT LE MONDE À MINUIT
  try {
    await db.query(`UPDATE users SET today_minutes = 0`);
    console.log("Remise à zéro de today_minutes à minuit.");
  } catch (err) {
    console.error("Erreur reset journalier (23:59) :", err);
  }
});

// ============================================================
// STRIPE WEBHOOK (Paiement → Accès Discord automatique)
// ============================================================

// ⚠️  Ce endpoint doit recevoir le body brut (avant express.json())
// C'est obligatoire pour que Stripe puisse vérifier la signature.
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("❌ Stripe non configuré (clés manquantes)");
      return res.status(500).send("Stripe non configuré");
    }

    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Signature Stripe invalide :", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const GUILD_ID = process.env.DISCORD_GUILD_ID;

      // ----- TENTATIVE : Notifier l'administrateur -----
    if (event.type === "checkout.session.created") {
      const session = event.data.object;
      if (ADMIN_ID) {
        try {
          const admin = await client.users.fetch(ADMIN_ID);
          const customerEmail = session.customer_details?.email || session.customer_email || "Inconnu";
          await admin.send(`💳 **Nouvelle Tentative de Paiement** : Un utilisateur (${customerEmail}) a ouvert une session Stripe.`);
        } catch (err) {
          console.error("Erreur notification tentative à l'admin:", err.message);
        }
      }
    }

    // ----- PAIEMENT VALIDÉ : Attribuer le rôle Discord -----
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Notification Admin (Succès)
      if (ADMIN_ID) {
        try {
          const admin = await client.users.fetch(ADMIN_ID);
          const amount = (session.amount_total / 100).toFixed(2);
          const currency = session.currency.toUpperCase();
          await admin.send(`💰 **Paiement Réussi !**\n\nUn montant de **${amount} ${currency}** a été reçu.\nSession ID: \`${session.id}\``);
        } catch (err) {
          console.error("Erreur notification succès à l'admin:", err.message);
        }
      }

      let discordUserId = session.metadata?.discord_user_id;

      if (!discordUserId && session.custom_fields) {
        const discordField = session.custom_fields.find(f =>
          f.text && (f.label.type === 'custom' && f.label.custom.toLowerCase().includes('discord'))
        );
        if (discordField) {
          discordUserId = discordField.text.value;
        }
      }

      if (!discordUserId) {
        console.error("⚠️ Webhook reçu sans discord_user_id (ni metadata, ni custom_fields).");
        return res.status(200).send("OK (pas d'ID Discord fourni)");
      }

      discordUserId = discordUserId.trim();

      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordUserId);

        if (ROLE_PAID) {
          await member.roles.add(ROLE_PAID);
          console.log(`✅ Rôle Onboarding attribué à ${discordUserId} (paiement Stripe validé)`);
        } else {
          // Fallback
          const MEMBER_ROLE_ID = process.env.DISCORD_MEMBER_ROLE_ID;
          if (MEMBER_ROLE_ID) await member.roles.add(MEMBER_ROLE_ID);
        }

        await db.query(
          `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
          [discordUserId]
        );

        const user = await client.users.fetch(discordUserId);
        await user.send(
          `🎉 **Bienvenue dans Med in silence !**\n\nTon paiement a été validé, tu as maintenant accès à toute la communauté !\n\nCommence par taper \`/checkin\` dans le serveur pour enregistrer ta première journée. Les sessions live sont chaque soir de **20h30 à 21h**. On compte sur toi ! 💪`
        );
      } catch (err) {
        console.error(`❌ Erreur attribution de rôle à ${discordUserId} :`, err);
      }
    }

    // ----- ABONNEMENT ANNULÉ : Retirer le rôle Discord -----
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const discordUserId = subscription.metadata?.discord_user_id;

      if (!discordUserId) {
        console.error("⚠️  Webhook annulation reçu sans discord_user_id.");
        return res.status(200).send("OK");
      }

      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordUserId);

        if (ROLE_VERIFIED) await member.roles.remove(ROLE_VERIFIED);
        if (ROLE_PAID) await member.roles.remove(ROLE_PAID);

        for (const r of ROLE_THRESHOLDS) {
          if (member.roles.cache.has(r.id)) {
            await member.roles.remove(r.id);
          }
        }

        console.log(`🔴 Accès retiré à ${discordUserId} (abonnement annulé)`);

        const user = await client.users.fetch(discordUserId);
        await user.send(
          `😢 **Ton abonnement Med in silence est terminé.**\n\nNous espérons te revoir bientôt ! Tu peux te réabonner à tout moment sur notre page de vente.`
        );
      } catch (err) {
        console.error(`❌ Erreur retrait de rôle à ${discordUserId} :`, err);
      }
    }

    res.status(200).json({ received: true });
  }
);

// Lancement du serveur web
app.listen(PORT, () => {
  console.log(`✅ Dashboard accessible sur http://localhost:${PORT}`);
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