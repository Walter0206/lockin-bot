async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        const leaderboardBody = document.getElementById('leaderboard-body');
        const totalFocusValue = document.querySelector('#total-focus .stat-value');
        const activeUsersValue = document.querySelector('#active-users .stat-value');

        if (data.length === 0) {
            leaderboardBody.innerHTML = '<div class="loading">Aucune donnée pour le moment. Allez bosser ! 🧠</div>';
            return;
        }

        let totalMinutes = 0;
        leaderboardBody.innerHTML = '';

        data.forEach((user, index) => {
            totalMinutes += user.total_minutes;

            const hours = Math.floor(user.total_minutes / 60);
            const minutes = user.total_minutes % 60;
            const timeStr = `${hours}h ${minutes}m`;

            const entry = document.createElement('div');
            entry.className = 'entry';
            entry.innerHTML = `
                <div class="rank">#${index + 1}</div>
                <div class="user-info">
                    <span class="user-id">Utilisateur ${user.user_id.slice(-4)}</span>
                    <span class="streak">🔥 ${user.current_streak} jours | ❄️ ${user.freezes_available} freezes</span>
                </div>
                <div class="time">${timeStr}</div>
            `;
            leaderboardBody.appendChild(entry);
        });

        // Update stats summary
        totalFocusValue.innerText = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
        activeUsersValue.innerText = data.length;

    } catch (error) {
        console.error('Erreur lors de la récupération des stats:', error);
        document.getElementById('leaderboard-body').innerHTML = '<div class="loading">Erreur de connexion.</div>';
    }
}

// Fetch stats initially and then every 30 seconds
fetchStats();
setInterval(fetchStats, 30000);
