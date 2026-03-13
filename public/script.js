async function fetchStats() {
    try {
        // Helper function to format minutes into "Xh Ym"
        const formatTime = (totalMinutes) => {
            if (!totalMinutes || totalMinutes === 0) return "0h 0m";
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${hours}h ${minutes}m`;
        };

        // Lire le paramètre ?profil= dans l'URL
        const urlParams = new URLSearchParams(window.location.search);
        const profilId = urlParams.get('profil');

        // Préparer l'URL de l'API avec le profil si présent
        const apiUrl = profilId ? `/api/stats?profil=${profilId}` : '/api/stats';

        const response = await fetch(apiUrl);
        const data = await response.json();

        // DOM Elements Globaux
        const activeUsersCount = document.getElementById('active-count');
        const activePulse = document.getElementById('active-pulse');
        const statToday = document.getElementById('stat-today');
        const statWeek = document.getElementById('stat-week');
        const statMonth = document.getElementById('stat-month');
        const statYear = document.getElementById('stat-year');
        const statAllTime = document.getElementById('stat-alltime');

        // DOM Elements Personnels
        const personalPanel = document.getElementById('personal-panel');
        const userStreak = document.getElementById('user-streak');
        const userFreezes = document.getElementById('user-freezes');
        const userPriority = document.getElementById('user-priority');
        const userToday = document.getElementById('user-today');
        const userWeek = document.getElementById('user-week');
        const userMonth = document.getElementById('user-month');
        const userYear = document.getElementById('user-year');
        const userAllTime = document.getElementById('user-alltime');
        const liveTimer = document.getElementById('live-session-timer');

        // Community Progress Elements
        const commCheckin = document.getElementById('community-checkin');
        const commWork = document.getElementById('community-work');
        const commCheckout = document.getElementById('community-checkout');

        // Personal Checklist Elements
        const stepIn = document.getElementById('check-step-in');
        const stepWork = document.getElementById('check-step-work');
        const stepOut = document.getElementById('check-step-out');

        // Mettre à jour les stats globales de la communauté
        if (data.globalStats) {
            statToday.innerText = formatTime(data.globalStats.today);
            statWeek.innerText = formatTime(data.globalStats.week);
            statMonth.innerText = formatTime(data.globalStats.month);
            statYear.innerText = formatTime(data.globalStats.year);
            statAllTime.innerText = formatTime(data.globalStats.allTime);
        }

        // Mettre à jour la progression communautaire
        if (data.communityProgress) {
            const total = data.communityProgress.total;
            commCheckin.innerText = `${data.communityProgress.checkin} / ${total}`;
            commWork.innerText = `${data.communityProgress.work} / ${total}`;
            commCheckout.innerText = `${data.communityProgress.checkout} / ${total}`;
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

        // Mettre à jour l'Espace Personnel (si les données sont présentes)
        if (data.userStats) {
            // Afficher le panneau
            personalPanel.classList.remove('hidden');

            // Remplir les données
            userStreak.innerText = data.userStats.streak || 0;
            userFreezes.innerText = data.userStats.freezes || 0;
            userPriority.innerText = data.userStats.priority;

            userToday.innerText = formatTime(data.userStats.today);
            userWeek.innerText = formatTime(data.userStats.week);
            userMonth.innerText = formatTime(data.userStats.month);
            userYear.innerText = formatTime(data.userStats.year);
            userAllTime.innerText = formatTime(data.userStats.allTime);

            // Mise à jour de la Check-list personnelle
            const updateCheckItem = (el, isValid) => {
                const icon = el.querySelector('.check-icon');
                if (isValid) {
                    el.classList.add('valid');
                    icon.innerText = '✅';
                } else {
                    el.classList.remove('valid');
                    icon.innerText = '⚪';
                }
            };

            updateCheckItem(stepIn, data.userStats.hasCheckin);
            updateCheckItem(stepWork, data.userStats.hasWork);
            updateCheckItem(stepOut, data.userStats.hasCheckout);

            // Gestion du Chronomètre de session en direct
            if (data.userStats.isActive && data.userStats.sessionStart) {
                liveTimer.classList.remove('hidden');
                window.currentSessionStart = new Date(data.userStats.sessionStart);
            } else {
                liveTimer.classList.add('hidden');
                window.currentSessionStart = null;
            }
        } else {
            // Cacher le panneau si erreur ou pas de profil
            personalPanel.classList.add('hidden');
            liveTimer.classList.add('hidden');
        }

    } catch (error) {
        console.error('Erreur lors de la récupération des stats:', error);
        document.getElementById('leaderboard-body').innerHTML = '<div class="loading">Erreur de connexion.</div>';
    }
}

function updateCountdown() {
    const targetDate = new Date('2026-08-27T09:00:00+02:00'); // 9h Brussels (UTC+2 in summer)
    const now = new Date();
    const diff = targetDate - now;

    if (diff <= 0) {
        document.querySelector('.countdown-panel h2').innerText = "🎉 C'est le moment ! Bonne chance pour le concours !";
        document.querySelector('.countdown-grid').classList.add('hidden');
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    document.getElementById('days').innerText = days.toString().padStart(2, '0');
    document.getElementById('hours').innerText = hours.toString().padStart(2, '0');
    document.getElementById('minutes').innerText = minutes.toString().padStart(2, '0');
    document.getElementById('seconds').innerText = seconds.toString().padStart(2, '0');
}

function updateStopwatchDisplay() {
    if (!window.currentSessionStart) return;

    const now = new Date();
    const diff = now - window.currentSessionStart;

    if (diff < 0) return;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const formattedStopwatch = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    document.getElementById('stopwatch-value').innerText = formattedStopwatch;
}

// Fetch stats initially and then every 30 seconds
fetchStats();
setInterval(fetchStats, 30000);

// Update timers every second
setInterval(() => {
    updateCountdown();
    updateStopwatchDisplay();
}, 1000);

// Initial run
updateCountdown();
updateStopwatchDisplay();
