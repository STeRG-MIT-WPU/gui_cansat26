document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = 'data.csv';
    const updateInterval = 1000; // 1 second refresh
    let lastPacketCount = 0; // Track last processed packet

    // --- Chart Configuration ---
    function createChartConfig(title, yAxisLabel) {
        return {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: title,
                    data: [],
                    borderColor: 'rgba(18, 243, 243, 1)',
                    borderWidth: 1.5,
                    tension: 0.3,
                    fill: true,
                    pointRadius: 0,       // removes dots
                    pointHoverRadius: 0   // no hover dots
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // 🔹 disables animation
                plugins: {
                    title: {
                        display: true,
                        text: title,
                        font: { size: 18 }
                    },
                    legend: { display: false } // optional: hide legend
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        title: { display: true, text: yAxisLabel }
                    },
                    x: {
                        title: { display: true, text: 'Packet Count' }
                    }
                }
            }
        };
    }

    // --- Initialize All Charts ---
    const accChart = new Chart(
        document.getElementById('accelerationChart').getContext('2d'),
        createChartConfig('Acceleration', 'm/s²')
    );
    const altChart = new Chart(
        document.getElementById('altitudeChart').getContext('2d'),
        createChartConfig('Altitude', 'Meters (m)')
    );
    const velChart = new Chart(
        document.getElementById('velocityChart').getContext('2d'),
        createChartConfig('Velocity', 'm/s')
    );
    const tempChart = new Chart(
        document.getElementById('temperatureChart').getContext('2d'),
        createChartConfig('Temperature', 'Celsius (°C)')
    );

    // --- Fetch and Parse CSV Data ---
    function loadGraphData() {
        Papa.parse(csvFilePath, {
            download: true,
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function(results) {
                const rows = results.data;

                rows.forEach(row => {
                    const packetCount = row.PACKET_COUNT;

                    if (packetCount > lastPacketCount) {
                        lastPacketCount = packetCount;

                        const accMagnitude = Math.sqrt(
                            Math.pow(row.AX, 2) + Math.pow(row.AY, 2) + Math.pow(row.AZ, 2)
                        );

                        accChart.data.labels.push(packetCount);
                        accChart.data.datasets[0].data.push(accMagnitude.toFixed(2));

                        altChart.data.labels.push(packetCount);
                        altChart.data.datasets[0].data.push(row.ALTITUDE);

                        velChart.data.labels.push(packetCount);
                        velChart.data.datasets[0].data.push(row.Velocity);

                        tempChart.data.labels.push(packetCount);
                        tempChart.data.datasets[0].data.push(row.TEMPERATURE);
                    }
                });

                accChart.update();
                altChart.update();
                velChart.update();
                tempChart.update();
            },
            error: function(err) {
                console.error("Error loading or parsing CSV file:", err);
            }
        });
    }

    // --- Auto Update ---
    setInterval(loadGraphData, updateInterval);
    loadGraphData();
});