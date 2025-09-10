document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = "cansat_synthetic_telemetry.csv";
    const updateInterval = 1000; // Fetch new data every 1000 ms (1 second)
    let dataIntervalId = null; // This will store the ID of our interval

    // The updateValue, getElementId, and parseCSV functions remain exactly the same.
    // ... (previous helper functions are here) ...

    /**
     * A smarter update function that preserves units.
     */
    function updateValue(id, newValue) {
        const el = document.getElementById(id);
        if (!el) return;
        const currentText = el.textContent;
        // This regex finds the numeric part (including potential negative sign and decimal) at the start
        const unit = currentText.replace(/^-?[\d.]+/g, '').replace('---', '');
        const newText = newValue + unit.trim(); // Use trim() to clean up leading space
        if (el.textContent !== newText) {
            el.textContent = newText;
        }
    }

    /**
     * Maps CSV header names to the corresponding HTML element IDs.
     */
    function getElementId(csvKey) {
        const idMap = {
            "TEAM_ID": "teamid",
            "Timestamp": "time",
            "PACKET_COUNT": "packets",
            "AX": "AX", "AY": "AY", "AZ": "AZ",
            "GX": "GX", "GY": "GY", "GZ": "GZ",
            "MX": "MX", "MY": "MY", "MZ": "MZ",
            "GNSS_LATITUDE": "latitude",
            "GNSS_LONGITUDE": "longitude",
            "SATELLITES": "satellites",
            "ALTITUDE": "altitude",
            "LUXMETER": "lux",
            "BMP_TEMP": "bmp-temp",
            "CURRENT": "current",
            "VOLTAGE": "voltage",
            "PRESSURE": "pressure",
            "Gas": "gas",
            "Error": "error-flag",
            'LORA_RSSI': 'rssi',
        };
        return idMap[csvKey] || null;
    }

    /**
     * Fetches the CSV file, parses it, and updates the dashboard.
     */
    async function processAndDisplayData() {
        try {
            // Using "no-cache" is important for live data
            const response = await fetch(csvFilePath, { cache: "no-cache" });
            if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.statusText}`);
            
            const csvText = await response.text();
            const data = parseCSV(csvText);

            if (!data || data.length === 0) return;

            // Always display the latest data point from the CSV
            const latestData = data[data.length - 1];
            for (const key in latestData) {
                const elementId = getElementId(key);
                if (elementId) {
                    updateValue(elementId, latestData[key]);
                }
            }
        } catch (error) {
            console.error("Error processing data:", error);
        }
    }

    /**
     * A helper function to parse raw CSV text.
     */
    function parseCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        const result = [];
        for (let i = 1; i < lines.length; i++) {
            const obj = {};
            const currentline = lines[i].split(',').map(v => v.trim());
            headers.forEach((header, j) => {
                obj[header] = currentline[j];
            });
            result.push(obj);
        }
        return result;
    }

    // --- CONTROL FUNCTIONS ---

    function startUpdates() {
        // Avoid starting multiple loops
        if (dataIntervalId) return;
        console.log("Starting live data updates...");
        // Immediately fetch data once, then start the interval
        processAndDisplayData(); 
        dataIntervalId = setInterval(processAndDisplayData, updateInterval);
    }

    function stopUpdates() {
        if (!dataIntervalId) return; // Already stopped
        console.log("Stopping live data updates...");
        clearInterval(dataIntervalId);
        dataIntervalId = null; // Reset the ID
    }

    // --- START THE PROCESS ---
    // Instead of just loading data once, call the function that starts the loop.
    startUpdates();
});