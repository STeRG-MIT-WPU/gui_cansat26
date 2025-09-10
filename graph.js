// data1.js

document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = "cansat_synthetic_telemetry.csv";
    const updateInterval = 1000; // Fetch new data every 1 second
    
    // Chart variables for all four graphs
    let accChart, altChart, velChart, tempChart; 
    const MAX_DATA_POINTS = 50; // Max points to show on the charts at once

    // --- CHART INITIALIZATION FUNCTIONS ---

    function initAccelerationChart() {
        const ctx = document.getElementById('accelerationChart').getContext('2d');
        if (!ctx) return;
        accChart = new Chart(ctx, {
            type: 'line', 
            data: { 
                labels: [], 
                datasets: [
                    { 
                        label: ' Acceleration',
                        data: [], 
                        borderColor: 'rgba(255, 99, 132, 1)', // Red
                        tension: 0.1, 
                        fill: false 
                    }
                ]
            },
            options: { 
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, 
                scales: { 
                    y: { title: { display: true, text: 'm/s²' }}, 
                    x: { title: { display: true, text: 'Packet Count' }}
                }
            }
        });
    }

    function initAltitudeChart() {
        const ctx = document.getElementById('altitudeChart').getContext('2d');
        if (!ctx) return;
        altChart = new Chart(ctx, {
            type: 'line', 
            data: { 
                labels: [], 
                datasets: [
                    { 
                        label: 'Altitude', 
                        data: [], 
                        borderColor: '#8e44ad', // Purple
                        tension: 0.1, 
                        fill: false 
                    }
                ]
            },
            options: { 
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, 
                scales: { 
                    y: { title: { display: true, text: 'Meters (m)' }}, 
                    x: { title: { display: true, text: 'Packet Count' }}
                }
            }
        });
    }

    function initVelocityChart() {
        const ctx = document.getElementById('velocityChart').getContext('2d');
        if (!ctx) return;
        velChart = new Chart(ctx, {
            type: 'line', 
            data: { 
                labels: [], 
                datasets: [
                    { 
                        label: 'Velocity', 
                        data: [], 
                        borderColor: '#f1c40f', // Yellow
                        tension: 0.1, 
                        fill: false 
                    }
                ]
            },
            options: { 
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, 
                scales: { 
                    y: { title: { display: true, text: 'Velocity (m/s)' }}, 
                    x: { title: { display: true, text: 'Packet Count' }}
                }
            }
        });
    }

    function initTemperatureChart() {
        const ctx = document.getElementById('temperatureChart').getContext('2d');
        if (!ctx) return;
        tempChart = new Chart(ctx, {
            type: 'line', 
            data: { 
                labels: [], 
                datasets: [
                    { 
                        label: 'Temperature', 
                        data: [], 
                        borderColor: '#e67e22', // Orange
                        tension: 0.1, 
                        fill: false 
                    }
                ]
            },
            options: { 
                responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, 
                scales: { 
                    y: { title: { display: true, text: 'Celsius (°C)' }}, 
                    x: { title: { display: true, text: 'Packet Count' }}
                }
            }
        });
    }

    // --- CHART DATA UPDATE FUNCTION ---

    function addSingleDataToChart(chart, label, value) {
        if (!chart) return;
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        // Remove the oldest data point if we have too many
        if (chart.data.labels.length > MAX_DATA_POINTS) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.update();
    }
    
    // --- CORE DATA HANDLING AND GUI UPDATE ---

   

    function updateValue(id, newValue) {
        const el = document.getElementById(id);
        if (!el) return;
        const currentText = el.textContent;
        const unit = currentText.replace(/^-?[\d.]+/g, '').replace('---', '');
        if (id === 'timer') {
             el.innerHTML = `<h3>T-${newValue}</h3>`;
        } else {
            const newText = newValue + unit;
            if (el.textContent !== newText) { el.textContent = newText; }
        }
    }

    function parseCSV(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        const result = [];
        for (let i = 1; i < lines.length; i++) {
            const obj = {};
            const currentline = lines[i].split(',').map(v => v.trim());
            headers.forEach((header, j) => { obj[header] = currentline[j]; });
            result.push(obj);
        }
        return result;
    }

    async function processAndDisplayData() {
        try {
            const response = await fetch(csvFilePath, { cache: "no-cache" });
            if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.statusText}`);
            
            const csvText = await response.text();
            const data = parseCSV(csvText);
            if (!data || data.length === 0) return;

            const latestData = data[data.length - 1];

            // Update all the text values in the GUI
            for (const key in latestData) {
                const elementId = getElementId(key);
                if (elementId) { updateValue(elementId, latestData[key]); }
            }
            
            // --- UPDATE ALL CHARTS ---
            const packetCount = latestData.PACKET_COUNT;

            // 1. Calculate acceleration magnitude from AX, AY, AZ
            const accMagnitude = Math.sqrt(
                Math.pow(latestData.AX, 2) + 
                Math.pow(latestData.AY, 2) + 
                Math.pow(latestData.AZ, 2)
            ).toFixed(2); // .toFixed(2) rounds to 2 decimal places

            // 2. Feed the data to each chart
            addSingleDataToChart(accChart, packetCount, accMagnitude);
            addSingleDataToChart(altChart, packetCount, latestData.Altitude);
            addSingleDataToChart(velChart, packetCount, latestData.Velocity);
            addSingleDataToChart(tempChart, packetCount, latestData.BMP_temp);

            // Call functions from other scripts (Battery.js, state.js)
            if (typeof updateBattery === 'function') { updateBattery(parseFloat(latestData.Voltage)); }
            if (typeof updateSoftwareState === 'function') { updateSoftwareState(parseInt(latestData.SOFTWARE_STATE)); }

        } catch (error) {
            console.error("Error processing data:", error);
        }
    }

    // --- INITIALIZATION ---
    // Create all the charts when the page loads
    initAccelerationChart();
    initAltitudeChart();
    initVelocityChart();
    initTemperatureChart();
    
    // Fetch initial data and then start the update loop
    processAndDisplayData();
    setInterval(processAndDisplayData, updateInterval);
});