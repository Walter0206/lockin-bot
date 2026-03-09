async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        // DOM Elements
        const activeUsersCount = document.getElementById('active-count');
        const activePulse = document.getElementById('active-pulse');
        const statToday = document.getElementById('stat-today');
        const statWeek = document.getElementById('stat-week');
        const statMonth = document.getElementById('stat-month');
        const statYear = document.getElementById('stat-year');
        const statAllTime = document.getElementById('stat-alltime');

        // Helper function to format minutes into "Xh Ym"
        const formatTime = (totalMinutes) => {
            if (!totalMinutes || totalMinutes === 0) return "0h 0m";
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${hours}h ${minutes}m`;
        };

        // Mettre à jour les stats globales de la communauté
        if (data.globalStats) {
            statToday.innerText = formatTime(data.globalStats.today);
            statWeek.innerText = formatTime(data.globalStats.week);
            statMonth.innerText = formatTime(data.globalStats.month);
            statYear.innerText = formatTime(data.globalStats.year);
            statAllTime.innerText = formatTime(data.globalStats.allTime);
        }

        // Mettre à jour le compteur d'utilisateurs en direct
        if (data.activeCount !== undefined) {
            activeUsersCount.innerText = data.activeCount;

            // Ajouter/Retirer l'effet visuel de pulsation si quelqu'un travaille
            if (data.activeCount > 0) {
                activePulse.classList.add('live-active');
            } else {
                activePulse.classList.remove('live-active');
            }
        }

    } catch (error) {
        console.error('Erreur lors de la récupération des stats:', error);
        document.getElementById('leaderboard-body').innerHTML = '<div class="loading">Erreur de connexion.</div>';
    }
}

// Fetch stats initially and then every 30 seconds
fetchStats();
setInterval(fetchStats, 30000);
