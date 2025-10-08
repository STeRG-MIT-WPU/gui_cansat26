document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = "data.csv";  // Your CSV file
    let lastData = {};
    let lastRow = null;
    let isDataAvailable = true;
    const timer = 1000; // 1 second refresh

    // --- Restore table rows from localStorage ---
    function restoreTable() {
        const savedRows = JSON.parse(localStorage.getItem("rawDataTable") || "[]");
        savedRows.reverse().forEach(row => addNewRowToTable(row, false));
    }

    // --- Load CSV and trigger updates ---
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
                                addNewRowToTable(latestRow);
                            }
                        } else if (isDataAvailable) {
                            isDataAvailable = false;
                        }
                    }
                });
            })
            .catch(error => console.error("CSV Load Error:", error));

        if (isDataAvailable) {
            setTimeout(loadCSVData, timer);
        }
    }

    // --- Dashboard Updates ---
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

    function updateValue(id, newValue) {
        const el = document.getElementById(id);
        if (el && el.textContent !== newValue) {
            el.textContent = newValue;
        }
    }

    function updateBatteryFromVoltage(voltage) {
        const BATTERY_MIN_VOLTAGE = 2.5;
        const BATTERY_MAX_VOLTAGE = 6.5;

        const clampedVoltage = Math.max(BATTERY_MIN_VOLTAGE, Math.min(voltage, BATTERY_MAX_VOLTAGE));
        const batteryPercent = ((clampedVoltage - BATTERY_MIN_VOLTAGE) / (BATTERY_MAX_VOLTAGE - BATTERY_MIN_VOLTAGE)) * 100;
        const roundedPercent = Math.round(batteryPercent * 10) / 10;

        const batteryFill = document.getElementById('battery-fill');
        const batteryText = document.getElementById('battery-text');
        if (batteryFill) batteryFill.style.width = roundedPercent + '%';
        if (batteryText) batteryText.innerText = roundedPercent + '%';
    }

    // --- CSV Key → Element ID Map ---
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
            "GNSS_SATELLITES": "satellites",
            "ALTITUDE": "altitude",
            "LUXMETER": "lux",
            "TEMPERATURE": "bmp-temp",
            "CURRENT": "current",
            "VOLTAGE": "voltage",
            "PRESSURE": "pressure",
            "HUMIDITY": "humidity",
            "ERROR_FLAGS": "error",   // ⚠ Make sure error flag grid has buttons with IDs (see updateErrorFlags)
            'XBEE_RSSI': 'xbee_rssi',
            'LORA_RSSI': 'rssi',
            'SOFTWARE_STATE': 'state', // ⚠ Maps to phase display divs (see updatePhaseDiv)
        };
        return idMap[csvKey.trim()] || null;
    }

    // --- Update Phase Div ---
    function updatePhaseDiv(stateValue) {
        document.querySelectorAll('.phase').forEach(phase => {
            phase.className = 'phase';
        });

        // ⚠ REQUIRED IDs for phases in your HTML
        // <div id="launch-phase" class="phase"></div>
        // <div id="ascent-phase" class="phase"></div>
        // <div id="coast-phase" class="phase"></div>
        // <div id="descent-phase" class="phase"></div>
        // <div id="recovery-phase" class="phase"></div>
        const phaseMap = {
            "1": "launch-phase",
            "2": "ascent-phase",
            "3": "coast-phase",
            "4": "descent-phase",
            "5": "recovery-phase"
        };

        const phaseId = phaseMap[stateValue];
        if (phaseId) {
            const targetDiv = document.getElementById(phaseId);
            if (targetDiv) targetDiv.className = 'phase active';
        }
    }

    // --- Error Flag Handler ---
    function updateErrorFlags(hexValue) {
        // ⚠ REQUIRED IDs for error flags in your HTML
        // <button id="e-batt" class="btn"></button>
        // <button id="e-comms-loss" class="btn"></button>
        // <button id="e-comms-del" class="btn"></button>
        // <button id="e-mem" class="btn"></button>
        // <button id="e-sd" class="btn"></button>
        // <button id="e-flash" class="btn"></button>
        // <button id="e-para" class="btn"></button>
        // <button id="e-fins" class="btn"></button>
        // <button id="e-cs" class="btn"></button>
        // <button id="e-none" class="btn"></button>  <-- special "no error" state
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

        document.querySelectorAll(".error-grid .btn").forEach(btn => {
            btn.className = "btn";
        });

        let binary = parseInt(hexValue, 16).toString(2).padStart(9, '0');

        if (!binary.includes('1')) {
            const noneBtn = document.getElementById("e-none");
            if (noneBtn) noneBtn.className = "error-button active";
            return;
        }

        for (let i = 0; i < 9; i++) {
            if (binary[binary.length - 1 - i] === '1') {
                const el = document.getElementById(errorBitMap[i]);
                if (el) el.className = "error-button-abort";
            }
        }
    }

    // --- Clock ---
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        const clockElement = document.getElementById('clock');
        if (clockElement) clockElement.textContent = timeString;
    }

    // --- Countdown + Mission Timer ---
   /* function setupTimer() {
        const timerEl = document.querySelector('.countdown');
        const missionTimeEl = document.getElementById('countdown');
        const startButton = document.getElementById('start');

        let counter = 10; 
        let countingUp = false;
        let missionCounter = 0;
        let timerInterval = null;
        let missionInterval = null;

        startButton.addEventListener('click', () => {
            if (timerInterval) return; 
            timerInterval = setInterval(() => {
                const minutes = String(Math.floor(counter / 60)).padStart(2, '0');
                const seconds = String(counter % 60).padStart(2, '0');
                const timeDisplay = ${minutes}:${seconds};
                timerEl.innerHTML = <span>T${countingUp ? ' +' : ' -'} </span>${timeDisplay};

                if (!countingUp) {
                    counter--;
                    if (counter < 0) {
                        countingUp = true;
                        counter = 0;
                        missionCounter = 0;
                        missionInterval = setInterval(() => {
                            const h = String(Math.floor(missionCounter / 3600)).padStart(2, '0');
                            const m = String(Math.floor((missionCounter % 3600) / 60)).padStart(2, '0');
                            const s = String(missionCounter % 60).padStart(2, '0');
                            missionTimeEl.textContent = ${h}:${m}:${s};
                            missionCounter++;
                        }, 1000);
                    }
                } else {
                    counter++;
                }
            }, 1000);
        });
    }
*/
    // --- Add Row to Raw Data Table ---
    function addNewRowToTable(rowData, saveToStorage = true) {
        const tableBody = document.getElementById("table-body");
        const newRow = tableBody.insertRow(0);
        Object.values(rowData).forEach(value => {
            const cell = newRow.insertCell();
            cell.textContent = value;
        });

        if (saveToStorage) {
            const existing = JSON.parse(localStorage.getItem("rawDataTable") || "[]");
            existing.push(rowData);
            localStorage.setItem("rawDataTable", JSON.stringify(existing.slice(-100)));
        }
    }

    // --- START EVERYTHING ---
    restoreTable();
    loadCSVData();
    setupTimer();
    setInterval(updateClock, 1000);
});