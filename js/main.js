document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = "telemetry.csv";
    let lastData = {};
    let lastRow = null;
    let isDataAvailable = true;
    const timer = 500;

    // --------------------------- Camera Toggle --------------------------------------------------//
    const button = document.getElementById('toggle-button');
    const video = document.getElementById('camera');
    let stream;

    button.addEventListener('click', () => {
        if (button.textContent === "CAMERA OFF") {
            stopCamera();
            button.textContent = "CAMERA ON";
        } else {
            startCamera();
            button.textContent = "CAMERA OFF";
        }
    });

    function startCamera() {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then((s) => {
                stream = s;
                video.srcObject = stream;
            })
            .catch((error) => {
                console.error("Camera Access Error:", error);
            });
    }

    function stopCamera() {
        if (stream) {
            const tracks = stream.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
        }
    }
    // --------------------------------------------------------------------------------------------//

    function loadCSVData() {
        fetch(csvFilePath + "?t=" + new Date().getTime())
            .then(response => response.text())
            .then(csvText => {
                Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: function (results) {
                        if (results.data.length > 0) {
                            let latestRow = results.data[results.data.length - 1];
                            if (JSON.stringify(latestRow) !== JSON.stringify(lastRow)) {
                                requestAnimationFrame(() => updateDashboard(latestRow));
                                lastRow = latestRow;
                                addNewRowToTable(lastRow);
                            }
                        } else {
                            if (isDataAvailable) {
                                isDataAvailable = false;
                                console.log("No new data available in the CSV file.");
                                stopDataUpdates();
                            }
                        }
                    }
                });
            })
            .catch(error => console.error("CSV Load Error:", error));

        if (isDataAvailable) {
            setTimeout(loadCSVData, 500);
        }
    }

    function updateDashboard(data) {
        for (let key in data) {
            let value = data[key];

            if (key === "State") {
                updatePhaseDiv(value);
            } else if (key === "Error") {
                updateErrorFlags(value);
            } else {
                const id = getElementId(key);
                if (id && lastData[key] !== value) {
                    updateValue(id, value);
                }
            }
        }

        lastData = { ...data };

        const batteryPercent = 80.97;
        document.getElementById('battery-fill').style.width = batteryPercent + '%';
        document.getElementById('battery-text').innerText = batteryPercent + '%';
    }

    function updateValue(id, newValue) {
        const el = document.getElementById(id);
        if (el && el.textContent !== newValue) {
            el.textContent = newValue;
        }
    }

    function getElementId(csvKey) {
        const idMap = {
           "Timestamp": "time",
            "PACKET_COUNT": "packets",
            "AX": "AX", "AY": "AY", "AZ": "AZ",
            "GX": "GX", "GY": "GY", "GZ": "GZ",
            "MX": "MX", "MY": "MY", "MZ": "MZ",
            "lat": "latitude",
            "lng": "longitude",
            "Satellites": "satellites",
            "Altitude": "altitude",
            "LUX": "lux",
            "BMP_temp": "bmp-temp",
            "Current": "current",
            "Voltage": "voltage",
            "Pressure": "pressure",
            "Gas": "gas",
            "Error": "error-flag",
            'RSSI' : 'rssi',
            'Roll' : 'roll',
            'Pitch' : 'pitch',
            'Yaw' : 'yaw',
            "Velocity": "velocity",
            "AA": "AA"
        };
        return idMap[csvKey] || null;
    }

    function updatePhaseDiv(stateValue) {
        const allPhases = document.querySelectorAll('.phase, .phase.active');
        allPhases.forEach(phase => {
            phase.className = 'phase';
        });

        let phaseId = "";
        switch (stateValue) {
            case "1": phaseId = "launch-phase"; break;
            case "2": phaseId = "ascent-phase"; break;
            case "3": phaseId = "coast-phase"; break;
            case "4": phaseId = "descent-phase"; break;
            case "5": phaseId = "recovery-phase"; break;
            default: return;
        }

        const targetDiv = document.getElementById(phaseId);
        if (targetDiv) targetDiv.className = 'phase active';
    }

    function updateErrorFlags(hexValue) {
        const errorBitMap = {
            0: "e-batt",
            1: "e-comms-loss",
            2: "e-comms-del",
            3: "e-mem",
            4: "e-sd",
            5: "e-flash",
            6: "e-over-mb",
            7: "e-over-ab",
            8: "e-trajectory",
            9: "e-para",
            10: "e-payload"
        };

        document.querySelectorAll(".error-grid .btn").forEach(btn => {
            btn.className = "btn";
        });

        let binary = parseInt(hexValue, 16).toString(2).padStart(16, '0');

        if (!binary.includes('1')) {
            const noneBtn = document.getElementById("e-none");
            if (noneBtn) noneBtn.className = "btn active";
            return;
        }

        for (let i = 0; i < 16; i++) {
            if (binary[15 - i] === '1' && errorBitMap.hasOwnProperty(i)) {
                const el = document.getElementById(errorBitMap[i]);
                if (el) el.className = "btn abort";
            }
        }
    }

    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        let clockElement = document.getElementById('clock');
        if (clockElement) clockElement.textContent = timeString;
    }

    function setupTimer() {
        const timerEl = document.querySelector('.coundown');
        const missionTimeEl = document.getElementById('countdwn');

        let counter = 5;
        let countingUp = false;
        let missionCounter = 0;

        setInterval(() => {
            let minutes = String(Math.floor(counter / 60)).padStart(2, '0');
            let seconds = String(counter % 60).padStart(2, '0');
            let timeDisplay = `${minutes}:${seconds}`;

            if (!countingUp) {
                timerEl.innerHTML = `<span>T-</span>${timeDisplay}`;
                counter--;
                if (counter < 0) {
                    countingUp = true;
                    counter = 1;
                }
            } else {
                timerEl.innerHTML = `<span>T+</span>${timeDisplay}`;
                counter++;
            }
        }, 500);

        setInterval(() => {
            let h = String(Math.floor(missionCounter / 3600)).padStart(2, '0');
            let m = String(Math.floor((missionCounter % 3600) / 60)).padStart(2, '0');
            let s = String(missionCounter % 60).padStart(2, '0');
            missionTimeEl.textContent = `${h}:${m}:${s}`;
            missionCounter++;
        }, 500);
    }

    function addNewRowToTable(rowData) {
        const tableBody = document.getElementById("table-body");
        const newRow = tableBody.insertRow(0);
        Object.values(rowData).forEach(value => {
            const cell = newRow.insertCell();
            cell.textContent = value;
        });
    }

    function stopDataUpdates() {
        console.log("Data updates stopped.");
    }

    loadCSVData();
    setupTimer();
    addNewRowToTable(lastRow);
    setInterval(updateClock, 1000);
});
