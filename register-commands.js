// register-commands.js
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Obtenir le lien de ton tableau de bord personnel'),
  new SlashCommandBuilder()
    .setName('checkin')
    .setDescription('Valider ta présence le matin (00h00 - 10h00)'),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Démarrer une session de Travail silencieux'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Arrêter la session de Travail silencieux en cours'),
  new SlashCommandBuilder()
    .setName('checkout')
    .setDescription('Valider ta journée le soir (21h00 - 23h59)')
    .addStringOption(option =>
      option.setName('priorite')
        .setDescription('Ta priorité pour demain (optionnel)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('priorite')
    .setDescription('Définir ou modifier ta priorité du jour')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Ta nouvelle priorité')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('setup-onboarding')
    .setDescription('Installer le message d\'onboarding avec le bouton d\'engagement (Admin uniquement)'),
  new SlashCommandBuilder()
    .setName('migrer-membres')
    .setDescription('Donner le rôle Lockin à tous les membres ayant un streak (Migration)'),
  new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Afficher le Top 10 des membres les plus réguliers'),
  new SlashCommandBuilder()
    .setName('setup-hierarchy')
    .setDescription('Installer le message de présentation de la hiérarchie (Admin uniquement)'),
  new SlashCommandBuilder()
    .setName('admin-user-edit')
    .setDescription('🛡️ [ADMIN] Modifier les données d\'un membre')
    .addUserOption(option => option.setName('utilisateur').setDescription('Le membre à modifier').setRequired(true))
    .addIntegerOption(option => option.setName('streak').setDescription('Nouveau streak (jours)'))
    .addIntegerOption(option => option.setName('freezes').setDescription('Nouveau nombre de freezes disponibles')),
  new SlashCommandBuilder()
    .setName('admin-user-info')
    .setDescription('🛡️ [ADMIN] Voir toutes les données d\'un membre')
    .addUserOption(option => option.setName('utilisateur').setDescription('Le membre à inspecter').setRequired(true)),
  new SlashCommandBuilder()
    .setName('admin-database-export')
    .setDescription('🛡️ [ADMIN] Exporter la base de données (Backup JSON)'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("Début du rafraîchissement des commandes (/) de l'application.");

    // We extract the client ID from the token (the first part of the token base64 encoded)
    // Actually, discord REST API requires client_id. It's safer to provide it via ENV or extract it.
    // The easiest generic way to get the bot's user ID is to use the Get Current Application endpoint
    const app = await rest.get(Routes.oauth2CurrentApplication());
    const clientId = app.id;

    // Register globally for the bot
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );

    console.log('Les commandes (/) ont été rechargées avec succès.');
  } catch (error) {
    console.error(error);
  }
})();
