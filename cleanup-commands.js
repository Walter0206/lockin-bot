// cleanup-commands.js
require("dotenv").config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
const guildId = process.env.DISCORD_GUILD_ID;

(async () => {
    try {
        const app = await rest.get(Routes.oauth2CurrentApplication());
        const clientId = app.id;

        console.log('--- NETTOYAGE DES COMMANDES ---');

        if (guildId) {
            console.log(`Nettoyage des commandes du serveur (Guild): ${guildId}`);
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
            console.log('✅ Commandes du serveur supprimées.');
        }

        console.log('Nettoyage des commandes globales...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log('✅ Commandes globales supprimées.');

        console.log('\n--- RÉ-ENREGISTREMENT ---');
        // On pourrait appeler register-commands.js ici, mais on va juste dire à l'utilisateur de le faire
        console.log('Tout est propre. Maintenant, lance : node register-commands.js');

    } catch (error) {
        console.error('Erreur lors du nettoyage:', error);
    }
})();
