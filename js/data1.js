document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = "data.csv";
    const updateInterval = 1000; // Fetch new data every 1000 ms (1 second)
    let dataIntervalId = null;   // This will store the ID of our interval

    
    function updateValue(id, newValue) {
        const el = document.getElementById(id);
        if (!el) return;

        const currentText = el.textContent;
        // This regex finds the numeric part to extract the unit (e.g., "°C", "hPa")
        const unit = currentText.replace(/^-?[\d.]+/g, '').replace('---', '');
        
        // Combine the new value with the extracted unit
        const newText = newValue + unit.trim();
        
        if (el.textContent !== newText) {
            el.textContent = newText;
        }
    }
function updateDashboard(data) {
        for (let key in data) {
            let value = data[key];
            if (key === "SOFTWARE_STATE") {
                updatePhaseDiv(value);
            } else if (key === "ERROR_FLAGS") {
                 updateErrorFlags(value);
            } else {
                const id = getElementId(key);
                if (id && lastData[key] !== value) {
                    if (Array.isArray(id)) {
                        id.forEach(singleId => updateValue(singleId, value));
                    } else {
                        updateValue(id, value);
                    }
                }
            }
        }

        lastData = { ...data };
        updateBatteryFromVoltage(parseFloat(data["VOLTAGE"]));
    }
    /**
     * Maps CSV header names to the corresponding HTML element IDs.
     */
    function getElementId(csvKey) {
        const idMap = {
            "TEAM_ID": "teamid",
            "MISSION_TIME": "time",
            "PACKET_COUNT": "packets", 
            "AX": "AX", "AY": "AY", "AZ": "AZ",
            "GX": "GX", "GY": "GY", "GZ": "GZ",
            "MX": "MX", "MY": "MY", "MZ": "MZ",
            "GNSS_LATITUDE": "lat",
            "GNSS_LONGITUDE": "lng",
            "SATELLITES": "satellites",
            "ALTITUDE": "altitude",
            "LUXMETER": "lux",
            "TEMPERATURE": "bmp-temp",
            "CURRENT": "current",
            "VOLTAGE": "voltage",
            "PRESSURE": "pressure",
            "Gas": "gas",
            "ERROR_FLAGS": "error",
            'LORA_RSSI': 'rssi',
        };
        // Use trim() on the key to handle potential whitespace from the CSV header
        return idMap[csvKey.trim()] || null;
    }

    /**
     * Fetches the CSV file, parses it, and updates the dashboard.
     * This version contains the specific fix for the timestamp.
     */
    async function processAndDisplayData() {
        try {
            const response = await fetch(csvFilePath, { cache: "no-cache" });
            if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.statusText}`);
            
            const csvText = await response.text();
            const data = parseCSV(csvText);

            if (!data || data.length === 0) return;

            const latestData = data[data.length - 1];
            
            // Loop through all data from the latest row
            for (const key in latestData) {
                const elementId = getElementId(key);
                const value = latestData[key];

                // ==========================================================
                // ========= THIS IS THE CRITICAL FIX SECTION ===============
                // ==========================================================
                if (elementId === 'time') {
                    // **SPECIAL HANDLING FOR TIMESTAMP**
                    // We directly set the text content because it's not a number with a unit.
                    const timeEl = document.getElementById('time');
                    if (timeEl && timeEl.textContent !== value) {
                        timeEl.textContent = value;
                    }
                } else if (elementId) {
                    // **ORIGINAL LOGIC FOR ALL OTHER DATA**
                    // Use the original function for all other numeric data points.
                    updateValue(elementId, value);
                }
                // ==========================================================
            }
        } catch (error) {
            console.error("Error processing data:", error);
        }
    }

    function updateErrorFlags(hexValue) {
    const errorBitMap = {
        0: "e_fin",
        1: "e_mem",
        2: "e_cs",
        3: "e_flash",
        4: "e_batt",
        5: "e_comms_loss",
        6: "e_sd",
        7: "e_para",
        8: "e_comms_del"
    };

    // Reset all error buttons
    document.querySelectorAll(".error-grid .error-button, .error-grid .error-button-abort")
        .forEach(btn => btn.className = "error-button");

    // Convert hex to 9-bit binary string
    let binary = parseInt(hexValue, 16).toString(2).padStart(9, '0');

    // Apply active state for each '1'
    for (let i = 0; i < 9; i++) {
        if (binary[binary.length - 1 - i] === '1') {  // LSB first
            const el = document.getElementById(errorBitMap[i]);
            if (el) el.className = "error-button-abort";
        }
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
        if (dataIntervalId) return;
        console.log("Starting live data updates...");
        processAndDisplayData(); 
        dataIntervalId = setInterval(processAndDisplayData, updateInterval);
    }

    function stopUpdates() {
        if (!dataIntervalId) return;
        console.log("Stopping live data updates...");
        clearInterval(dataIntervalId);
        dataIntervalId = null;
    }

    // --- START THE PROCESS ---
    startUpdates();
    updateDashboard();
});
