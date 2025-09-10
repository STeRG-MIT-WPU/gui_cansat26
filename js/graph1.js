document.addEventListener("DOMContentLoaded", function () {

    const csvFilePath = 'graph.csv';
    const updateInterval = 1000;
    // --- Chart Configuration ---
    // This function creates a configuration object for a new chart.
    function createChartConfig(title, yAxisLabel) {
        return {
            type: 'line',
            data: {
                labels: [], // X-axis labels (e.g., packet count)
                datasets: [{
                    label: title,
                    data: [], // Y-axis data points
                    borderColor: 'rgba(26, 35, 126, 1)',
                    backgroundColor: 'rgba(57, 73, 171, 0.5)',
                    borderWidth: 2,
                    tension: 0.1,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: title,
                        font: { size: 18 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: yAxisLabel
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Packet Count'
                        }
                    }
                }
            }
        };
    }

    // --- Initialize All Charts ---
    const accCtx = document.getElementById('accelerationChart').getContext('2d');
    const accChart = new Chart(accCtx, createChartConfig('Acceleration', 'm/s²'));

    const altCtx = document.getElementById('altitudeChart').getContext('2d');
    const altChart = new Chart(altCtx, createChartConfig('Altitude', 'Meters (m)'));
    
    const velCtx = document.getElementById('velocityChart').getContext('2d');
    const velChart = new Chart(velCtx, createChartConfig('Velocity', 'm/s'));

    const tempCtx = document.getElementById('temperatureChart').getContext('2d');
    const tempChart = new Chart(tempCtx, createChartConfig('Temperature', 'Celsius (°C)'));


    // --- Fetch and Parse CSV Data ---
    function loadGraphData() {
        Papa.parse(csvFilePath, {
            download: true, // Tell PapaParse to fetch the file
            header: true,   // Treat the first row as headers
            dynamicTyping: true, // Automatically convert numbers and booleans
            skipEmptyLines: true,
            complete: function(results) {
                console.log("CSV data loaded successfully:", results.data);
                
                // Clear previous data before loading new data
                accChart.data.labels = [];
                accChart.data.datasets[0].data = [];
                altChart.data.labels = [];
                altChart.data.datasets[0].data = [];
                velChart.data.labels = [];
                velChart.data.datasets[0].data = [];
                tempChart.data.labels = [];
                tempChart.data.datasets[0].data = [];

                // Loop through each row of the parsed data
                results.data.forEach(row => {
                    const packetCount = row.PACKET_COUNT;

                    // 1. Calculate Acceleration Magnitude
                    const accMagnitude = Math.sqrt(
                        Math.pow(row.AX, 2) + Math.pow(row.AY, 2) + Math.pow(row.AZ, 2)
                    );

                    // 2. Add data to each chart
                    accChart.data.labels.push(packetCount);
                    accChart.data.datasets[0].data.push(accMagnitude.toFixed(2));

                    altChart.data.labels.push(packetCount);
                    altChart.data.datasets[0].data.push(row.Altitude);

                    velChart.data.labels.push(packetCount);
                    velChart.data.datasets[0].data.push(row.Velocity);
                    
                    tempChart.data.labels.push(packetCount);
                    tempChart.data.datasets[0].data.push(row.BMP_temp);
                });

                // Update all charts to display the new data
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

    // Load the data when the page loads
    loadGraphData();
});