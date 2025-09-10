window.addEventListener('load', () => {
    // First, check if the Battery Status API is supported by the browser.
    if ('getBattery' in navigator) {
        navigator.getBattery().then(function(battery) {
            
            const batteryLevelEl = document.getElementById('battery-level');
            const batteryPercentageEl = document.getElementById('battery-percentage');

            // This function updates the UI with the latest battery status.
            function updateBatteryStatus() {
                // Get percentage and update the text and width
                const level = Math.round(battery.level * 100);
                batteryPercentageEl.textContent = `${level}%`;
                batteryLevelEl.style.width = `${level}%`;

                // 1. Change color based on battery level
                if (level < 20) {
                    batteryLevelEl.style.backgroundColor = '#f44336'; // Red
                } else if (level < 50) {
                    batteryLevelEl.style.backgroundColor = '#ff9800'; // Orange
                } else {
                    batteryLevelEl.style.backgroundColor = '#4CAF50'; // Green
                }

                // 2. Add a charging indicator
                if (battery.charging) {
                    batteryPercentageEl.textContent += ' ⚡';
                }
            }

            // Run the function once to set the initial state.
            updateBatteryStatus();

            // Set up event listeners to automatically update when the battery status changes.
            battery.addEventListener('levelchange', updateBatteryStatus);
            battery.addEventListener('chargingchange', updateBatteryStatus);

        });
    } else {
        // Handle cases where the browser does not support the API.
        const batteryContainer = document.querySelector('.battery-container');
        batteryContainer.innerHTML = "<p>Battery API not supported</p>";
    }
});