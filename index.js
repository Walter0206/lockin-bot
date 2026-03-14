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
// CONFIGURATION DES RÔLES DE STREAK
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
// ÉVÉNEMENT : INTERACTION REÇU (SLASH COMMANDS)
// ============================================================

client.on("interactionCreate", async (interaction) => {
  console.log(`[Interaction] Type: ${interaction.type} | User: ${interaction.user.tag} | ID: ${interaction.customId || interaction.commandName}`);
  const userId = interaction.user.id;


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

    // Vérification de l'heure (00:00 à 08:59)
    if (hour >= 9) {
      return await interaction.reply({ content: "❌ Trop tard ! Le check-in matinal n'est disponible qu'entre 00h00 et 08h59 (Heure de Paris).", ephemeral: true });
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
      } else {
        await interaction.reply({ content: "✅ Check-in validé ! Bon courage pour tes objectifs du jour. N'oublie pas de lancer `/start` quand tu commences en Travail silencieux.", ephemeral: true });
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

      // Ajout du message d'avertissement en cas de dépassement
      if (wasCapped) {
        rewardMsg += `\n⚠️ **Attention :** Ta session dépassait 3 heures sans pause. Pour ta santé et l'intégrité de la communauté, le temps ajouté a été plafonné à **3h (180 minutes)**. Si c'était un oubli honnête, rattrape la différence lors de ta prochaine session de travail **sans activer le compteur** pour rééquilibrer ton total. 😉`;
      }

      if (earned > 0) {
        rewardMsg += `\n❄️ Bravo ! Tu as franchi un palier et gagné **${earned} Streak Freeze(s)** !`;
      }
      await interaction.reply({ content: rewardMsg, ephemeral: true });
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

    // Vérification de l'heure (21:00 à 23:59)
    if (hour < 21) {
      return await interaction.reply({ content: "❌ Trop tôt ! Le check-out du soir n'est disponible qu'entre 21h00 et 23h59 (Heure de Paris).", ephemeral: true });
    }

    try {
      const { rows } = await db.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
      const user = rows[0];

      if (!user) {
        return await interaction.reply({ content: "❌ Utilisateur introuvable.", ephemeral: true });
      }

      if (user.checkout_date === isoDate) {
        return await interaction.reply({ content: `✅ Tu as déjà fait ton check-out aujourd'hui ! Streak actuel : 🔥 ${user.current_streak} jours`, ephemeral: true });
      }

      // VÉRIFICATION DES CONDITIONS DE STREAK (Pré-calcul)
      const hasCheckedIn = user.checkin_date === isoDate;
      const hasWorked = user.today_minutes > 0;

      let streak = user.current_streak || 0;
      let streakMessage = "";

      // -------------------------
      // ÉTAPE 1 : VALIDATION IMMÉDIATE DU STREAK
      // -------------------------

      if (hasCheckedIn && hasWorked) {
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = formatInTimeZone(yesterdayDate, TIMEZONE, "yyyy-MM-dd");

        if (user.checkout_date === yesterday || streak === 0) {
          streak += 1;
        } else {
          streak = 1; // Reprise à 1 s'il y a un trou (bien que géré par les Freezes avant)
        }
        streakMessage = `✅ Conditions remplies ! Ton streak monte à 🔥 **${streak} jours** !`;
      } else {
        streakMessage = `⚠️ Check-out enregistré, mais tu n'as pas rempli les devoirs du jour (Check-in ce matin ET temps de travail). Ton streak stagne à **${streak} jours**.`;
      }

      // 1ère Sauvegarde (Le Streak est sécurisé)
      await db.query(`
        UPDATE users 
        SET checkout_date = $1,
            current_streak = $2,
            last_checkin = $1,
            failed_days_at_zero = 0
        WHERE user_id = $3
      `, [isoDate, streak, userId]);

      // Processus de Rôles
      try {
        if (interaction.member && streak > 0 && hasCheckedIn && hasWorked) {
          const targetRole = ROLE_THRESHOLDS.find(r => streak >= r.days);
          if (targetRole) {
            const hasRole = interaction.member.roles.cache.has(targetRole.id);
            if (!hasRole) await interaction.member.roles.add(targetRole.id);

            // Sécurité : S'assurer qu'il a toujours le rôle d'accès général
            if (ROLE_VERIFIED && !interaction.member.roles.cache.has(ROLE_VERIFIED)) {
              await interaction.member.roles.add(ROLE_VERIFIED);
            }

            for (const r of ROLE_THRESHOLDS) {
              if (r.id !== targetRole.id && interaction.member.roles.cache.has(r.id)) {
                await interaction.member.roles.remove(r.id);
              }
            }
          }
        }
      } catch (roleErr) {
        console.error("Erreur rôles (!checkout):", roleErr);
      }

      // Envoi du Rapport Quotidien en Message Privé
      try {
        const hours = (user.total_minutes / 60).toFixed(1);
        const days = (hours / 24).toFixed(2);
        await interaction.user.send(
          `📊 Daily Travail silencieux Report\n\nAujourd'hui : ${user.today_minutes || 0} minutes\nCette semaine : ${user.week_minutes || 0} minutes\n\nTotal :\n${user.total_minutes || 0} minutes\n${hours} heures\n${days} jours`
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

        await interaction.reply({ content: `${streakMessage}\n\nTa priorité "**${inlinePriority}**" est bien enregistrée. Bonne nuit et à demain !`, ephemeral: true });
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
          content: `${streakMessage}\n\n🎯 Dernière étape ! Clique sur le bouton ci-dessous pour définir ta priorité pour demain en toute discrétion.`,
          components: [row],
          ephemeral: true
        });
      }

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
              failed_days_at_zero = 0
          WHERE user_id = $3
        `, [motivations, isoNow, userId]);

        console.log(`✅ Contrat signé en base pour ${interaction.user.tag}`);

        // 2. Ensuite on tente de gérer les rôles (Optionnel si admin/permissions)
        try {
          const guild = await client.guilds.fetch(GUILD_ID);
          const member = await guild.members.fetch(userId);

          if (ROLE_VERIFIED) {
            await member.roles.add(ROLE_VERIFIED);
          }
          if (ROLE_PAID && member.roles.cache.has(ROLE_PAID)) {
            await member.roles.remove(ROLE_PAID);
          }
          console.log(`✅ Rôles mis à jour pour ${interaction.user.tag}`);
        } catch (roleErr) {
          console.warn(`⚠️ Impossible de modifier les rôles de ${interaction.user.tag} (Probablement Admin ou permissions insuffisantes) :`, roleErr.message);
          // On ne bloque pas la réponse à l'utilisateur ici
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
      console.log("🚀 Lancement de la migration des rôles...");
      const { rows } = await db.query(`SELECT user_id, current_streak FROM users WHERE current_streak > 0`);
      console.log(`📊 ${rows.length} utilisateurs avec un streak trouvés en base.`);
      
      let count = 0;
      let rolesCount = 0;
      let errors = 0;
      const guild = await client.guilds.fetch(GUILD_ID).catch(err => {
        console.error("❌ Impossible de récupérer la Guild:", err);
        return null;
      });

      if (!guild) {
        return await interaction.editReply({ content: "❌ Erreur critique : Le bot ne parvient pas à accéder au serveur Discord (ID incorrect ou accès refusé)." });
      }

      for (const row of rows) {
        try {
          const member = await guild.members.fetch(row.user_id).catch(() => null);
          if (!member) {
            console.log(`⚠️ Membre ${row.user_id} non trouvé sur le serveur.`);
            continue;
          }

          // 1. Gérer le rôle de base (Lockin/Verified)
          if (ROLE_VERIFIED) {
            if (!member.roles.cache.has(ROLE_VERIFIED)) {
              await member.roles.add(ROLE_VERIFIED).catch(e => console.error(`Erreur ajout ROLE_VERIFIED pour ${member.user.tag}:`, e.message));
              count++;
            }
          }

          // 2. Gérer la hiérarchie de consistance
          const streak = row.current_streak;
          const targetRole = ROLE_THRESHOLDS.find(r => streak >= r.days);

          if (targetRole) {
            const hasTarget = member.roles.cache.has(targetRole.id);
            if (!hasTarget) {
              console.log(`🔧 Attribution du rôle ${targetRole.name} (${targetRole.id}) à ${member.user.tag} (Streak: ${streak})`);
              await member.roles.add(targetRole.id).catch(e => {
                console.error(`❌ Erreur ajout rôle ${targetRole.name} pour ${member.user.tag}:`, e.message);
                errors++;
              });
              rolesCount++;
            }

            // Nettoyer les autres rôles de hiérarchie au passage
            for (const r of ROLE_THRESHOLDS) {
              if (r.id !== targetRole.id && member.roles.cache.has(r.id)) {
                await member.roles.remove(r.id).catch(e => console.error(`Erreur retrait ancien rôle ${r.name} pour ${member.user.tag}:`, e.message));
              }
            }
          }
        } catch (mErr) {
          console.error(`Erreur migration pour ${row.user_id}:`, mErr);
          errors++;
        }
      }

      await interaction.editReply({ 
        content: `✅ Migration terminée !\n- **${count}** membres ont reçu le rôle de base.\n- **${rolesCount}** grades de hiérarchie synchronisés.\n- **${errors}** erreurs rencontrées (voir les logs).` 
      });
    } catch (err) {
      console.error("Erreur migration :", err);
      await interaction.editReply({ content: "❌ Une erreur fatale est survenue lors de la migration : " + err.message });
    }
  }


  // -------------------------
  // COMMANDE CLASSEMENT (/classement)
  // -------------------------
  if (interaction.commandName === "classement") {
    try {
      const { rows } = await db.query(`
        SELECT user_id, current_streak 
        FROM users 
        WHERE current_streak > 0 
        ORDER BY current_streak DESC 
        LIMIT 50
      `);

      if (rows.length === 0) {
        return await interaction.reply({ content: "🏆 Le classement est encore vide. Soyez le premier à valider votre streak !", ephemeral: true });
      }

      let description = "";
      const medals = ["🥇", "🥈", "🥉"];

      for (let i = 0; i < rows.length; i++) {
        const streak = rows[i].current_streak;
        
        // Trouver le grade correspondant au streak
        const currentGrade = ROLE_THRESHOLDS.find(r => streak >= r.days);
        const gradeName = currentGrade ? currentGrade.name : "Débutant";
        
        // Emojis spécifiques pour le top 3 ou par palier
        let emojiPrefix = "🔹";
        if (streak >= 2500) emojiPrefix = "🩺";
        else if (streak >= 1500) emojiPrefix = "🎓";
        else if (streak >= 500) emojiPrefix = "⚔️";
        else if (streak >= 100) emojiPrefix = "🏛️";
        else if (streak >= 30) emojiPrefix = "🛡️";

        const medal = medals[i] || emojiPrefix;
        description += `${medal} **<@${rows[i].user_id}>** : \`${streak}j\` (${gradeName})\n`;
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
      description: "Voici les grades que tu peux débloquer sur le serveur en maintenant ton streak quotidien. " +
        "Chaque palier franchi montre ta détermination et ton engagement envers tes objectifs.\n\n" +
        "**📚 Les Paliers Majeurs :**\n" +
        "🩺 **Médecin** (2500 jours) : L'aboutissement de 7 ans de discipline.\n" +
        "🎓 **Bachelor/Externe** (1500-2000 jours) : La haute expertise.\n" +
        "⚔️ **Maître** (500-1000 jours) : La maîtrise absolue du silence.\n" +
        "🏛️ **Stoïque/Sage** (100-250 jours) : La sagesse ancrée.\n" +
        "🛡️ **Discipliné/Consistant** (30-75 jours) : L'habitude est une seconde nature.\n" +
        "🌱 **Déterminé/Engagé** (1-14 jours) : Les fondations de ta réussite.\n\n" +
        "**🔄 Le Cycle de la Réussite :**\n" +
        "1️⃣ **Matin (00h-09h)** : `/checkin` pour déclarer tes intentions.\n" +
        "2️⃣ **Journée** : `/start` et `/stop` pour mesurer ton effort.\n" +
        "3️⃣ **Soir (21h-00h)** : `/checkout` pour valider ta journée et ton streak.\n\n" +
        "*N'oublie pas : La consistance bat l'intensité à chaque fois. Travaille en silence, laisse tes résultats faire du bruit.*",
      color: 0x3498DB, // Blue
      image: {
        url: "https://media.discordapp.net/attachments/1090332851897483264/1113886542617260062/conssitance.jpg"
      }
    };

    await interaction.reply({ embeds: [embed] });
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
          streak: user.current_streak,
          freezes: user.freezes_available,
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
        `, [rewardMinutes, earned, user.user_id]);

        let pmMessage = `⚠️ **Arrêt Automatique :** Ta session de Travail silencieux a atteint la limite maximale de 3 heures sans pause. Ta session a été interrompue automatiquement et **180 minutes** ont été créditées à ton profil.\n\nSi tu es toujours en train de travailler, relance un \`!start\` pour démarrer un nouveau bloc. S'il s'agissait d'un oubli de chronomètre, sois honnête et travaille la différence (le surplus que tu aurais théoriquement fait) sans relancer d'autre compteur la prochaine fois. 😉`;

        if (earned > 0) {
          pmMessage += `\n\n❄️ Bonus : Au passage, tu as franchi un palier et gagné **${earned} Streak Freeze(s)** !`;
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
// TÂCHE AUTOMATIQUE : STREAK FREEZE À 23H59
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
      if (user.freezes_available > 0) {
        // CASE 1: L'utilisateur a des freezes -> On en utilise un
        try {
          await db.query(`
            UPDATE users 
            SET freezes_available = freezes_available - 1,
                checkout_date = $1,
                last_checkin = $1,
                last_freeze_date = $1,
                failed_days_at_zero = 0
            WHERE user_id = $2
          `, [today, user.user_id]);

          const u = await client.users.fetch(user.user_id);
          await u.send(`❄️ **STREAK FREEZE AUTOMATIQUE** ❄️\n\nTu as oublié de valider ta journée aujourd'hui, mais j'ai utilisé un de tes freezes pour sauver ton streak de **${user.current_streak} jours**.\n\nIl te reste **${user.freezes_available - 1}** freeze(s).`);
          console.log(`❄️ Freeze automatique utilisé pour ${user.user_id}`);
        } catch (err) { console.error(`Erreur freeze auto pour ${user.user_id}:`, err); }
      }
      else {
        // CASE 2: Pas de freezes -> Le streak tombe à zéro ou l'inactivité s'accumule
        try {
          let newFailedDays = (user.failed_days_at_zero || 0) + 1;

          if (user.current_streak > 0) {
            // Premier jour d'échec sans freeze : Perte du streak
            await db.query(`UPDATE users SET current_streak = 0, failed_days_at_zero = 1 WHERE user_id = $1`, [user.user_id]);

            // Retrait des rôles
            const guild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
            const member = await guild?.members.fetch(user.user_id).catch(() => null);
            if (member) {
              for (const r of ROLE_THRESHOLDS) { if (member.roles.cache.has(r.id)) await member.roles.remove(r.id); }
            }

            const u = await client.users.fetch(user.user_id);
            await u.send(`💔 **STREAK PERDU** 💔\n\nTu n'as pas validé ta journée et tu n'as plus de freeze. Ton streak retombe à 0.\n⚠️ **Attention :** Si tu ne valides pas tes objectifs demain non plus, tu seras exclu(e) de la communauté.`);
            console.log(`💔 Streak cassé pour ${user.user_id}`);
          }
          else if (newFailedDays >= 2) {
            // Deuxième jour d'échec à zéro streak : EXCLUSION
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
          }
          else {
            // Incrémenter simplement les jours d'échec (si déjà à 0 streak)
            await db.query(`UPDATE users SET failed_days_at_zero = $1 WHERE user_id = $2`, [newFailedDays, user.user_id]);
          }
        } catch (err) { console.error(`Erreur gestion échec pour ${user.user_id}:`, err); }
      }
    }
  } catch (err) {
    console.error("Erreur globale Auto-Freeze/Exclusion :", err);
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

    // ----- PAIEMENT VALIDÉ : Attribuer le rôle Discord -----
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

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