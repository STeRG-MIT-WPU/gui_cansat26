document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = CSV_PATH;    // data_<src>.csv, see js/source.js
    let lastData = {};
    let lastRow = null;
    let lastRx = 0;
    let isDataAvailable = true;
    const timer = 100; // ms between polls (MQTT link is 15 Hz)

    const steps = document.querySelectorAll(".progress-step");
    const lines = document.querySelectorAll(".line");

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
                                lastRx = Date.now();
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
                updateProgress(value);
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
        updateBattery(parseFloat(data["BATTERY"]));
        updateMissionClock(parseFloat(data["MISSION_TIME"]));
    }

    function updateValue(id, newValue) {
        const el = document.getElementById(id);
        if (el && el.textContent !== newValue) {
            el.textContent = newValue;
        }
    }

    // BATT% field of the packet (INA226 estimate on the FC)
    function updateBattery(percent) {
        if (isNaN(percent)) return;
        const level = document.getElementById('battery-level');
        const text = document.getElementById('battery-percentage');
        const p = Math.max(0, Math.min(100, percent));
        if (level) {
            level.style.width = p + '%';
            level.style.backgroundColor = p < 20 ? '#f44336' : p < 50 ? '#ff9800' : '#4CAF50';
        }
        if (text) text.textContent = p.toFixed(0) + '%';
    }

    // TIME field of the packet (mission seconds) as T+hh:mm:ss on the navbar
    function updateMissionClock(seconds) {
        const el = document.querySelector('#timer h3');
        if (!el || isNaN(seconds)) return;
        const s = Math.floor(seconds), pad = n => String(n).padStart(2, '0');
        el.textContent = `T+${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    }

    // --- CSV Key → Element ID Map ---
    function getElementId(csvKey) {
        const idMap = {
            "TEAM_ID": ["teamid", "teamid-nav"],
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
            "ERROR_FLAGS": "error",   
            'XBEE_RSSI': 'xbee_rssi',
            'LORA_RSSI': 'rssi',
            'SOFTWARE_STATE': 'state'
        };
        return idMap[csvKey.trim()] || null;
    }

    // --- Update Phase Div ---
    function updatePhaseDiv(stateValue) {
        document.querySelectorAll('.phase').forEach(phase => {
            phase.classList.remove("active");
        });

        const phaseMap = {          // state_t in cansat26_fw state_machine_var.h
            "0": "launch-phase",    // BOOT
            "1": "ascent-phase",    // STANDBY (shown as IDLE)
            "2": "coast-phase",     // ASCENT
            "3": "descent-phase",   // DESCENT
            "4": "recovery-phase"   // RECOVERY
        };

        const phaseId = phaseMap[stateValue];
        if (phaseId) {
            const targetDiv = document.getElementById(phaseId);
            if (targetDiv) targetDiv.classList.add("active");
        }
    }

    // --- Update Progress Steps + Lines ---
    function updateProgress(stateValue) {
        steps.forEach((step, index) => {
            step.classList.remove("active");
            if (lines[index]) lines[index].classList.remove("active");
        });

        const phaseMap = {
            "0": 0, "1": 1, "2": 2, "3": 3, "4": 4
        };

        const stepIndex = phaseMap[stateValue];
        if (stepIndex === undefined) return;

        for (let i = 0; i <= stepIndex; i++) {
            steps[i].classList.add("active");
            if (lines[i]) lines[i].classList.add("active");
        }
    }

    // --- Error Flag Handler ---
    // EFLAG is printed with %X from pd.e_flag (cansat26_fw, FC branch). Bit numbers from variables.h:
    const ERROR_FLAGS = ["e_none", "e_low_bat", "e_comm_los", "e_comm_delay", "e_para", "e_sd_not_found",
                         "e_stall", "e_mount", "e_full", "e_flash", "e_payload"];

    function decodeErrorFlags(hexValue) {
        let v = parseInt(hexValue, 16) || 0;
        const bits = new Set();
        // The FC writes pd.e_flag two ways: `|= E_FLASH` (bit mask 0x200, persist.c failure) and
        // `= n` with n the bit NUMBER (1 low batt, 4 para, 5 sd init, 6 stall, 7 mount, 8 full).
        if (v & 0x200) { bits.add(9); v &= ~0x200; }
        if (v > 0 && v <= 10) bits.add(v);                       // bit number form
        else for (let i = 0; i < ERROR_FLAGS.length; i++) if (v >> i & 1) bits.add(i);   // mask form
        return bits;
    }

    function updateErrorFlags(hexValue) {
        const bits = decodeErrorFlags(hexValue);
        ERROR_FLAGS.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.className = bits.has(i) ? "error-button-abort" : "error-button";
        });
        const none = document.getElementById("e_none");
        if (none && bits.size === 0) none.className = "error-button active";
        const raw = document.getElementById("e_raw");
        if (raw) raw.textContent = "EFLAG 0x" + String(hexValue).toUpperCase();
    }

    // --- Clock ---
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        const clockElement = document.getElementById('clock');
        if (clockElement) clockElement.textContent = timeString;
    }

    // --- Add Row to Raw Data Table ---
    function addNewRowToTable(rowData, saveToStorage = true) {
        const tableBody = document.getElementById("table-body");
        if (!tableBody) return;
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

    // --- Link switcher: mark the active link, red dot when no packet for 3 s ---
    document.title = "CANSAT GUI - " + SRC.toUpperCase();
    document.querySelector(`.source-switch a[data-src="${SRC}"]`)?.classList.add("active");
    setInterval(() => document.body.classList.toggle("link-stale", Date.now() - lastRx > 3000), 1000);

    // --- Command box: menu of FC telecommands (server.py COMMANDS, from FC/GUI_HANDOFF.md), Enter sends on this link.
    //     The server validates the line and answers 409 for RESET/BURN/DEPLOY/STATE/... until confirmed here. ---
    const cmdInput = document.getElementById("commandInput"), cmdPick = document.getElementById("commandPick");
    fetch("/commands").then(r => r.json()).then(list => {
        const groups = {};
        for (const c of list) {
            groups[c.group] ??= cmdPick.appendChild(Object.assign(document.createElement("optgroup"), { label: c.group }));
            groups[c.group].appendChild(new Option(c.text + (c.confirm ? "  (confirm)" : ""), c.text));
        }
    }).catch(() => {});
    cmdPick?.addEventListener("change", () => {
        const t = cmdPick.value, now = new Date();
        cmdPick.value = "";
        if (!t) return;
        cmdInput.value = t === "TIME hh mm ss" ? `TIME ${now.getHours()} ${now.getMinutes()} ${now.getSeconds()}`   // PC clock
                                              : t.replace(/<.*$/, "");                                              // "<us>" -> type it
        cmdInput.focus();
        cmdInput.placeholder = "";
    });
    const postCmd = (cmd, confirmed) => fetch("/cmd", { method: "POST", headers: { "Content-Type": "application/json" },
                                                       body: JSON.stringify({ src: SRC, cmd, confirmed }) })
        .then(async r => ({ status: r.status, ...(await r.json()) })).catch(() => ({ status: 0, error: "server not reachable" }));
    cmdInput?.addEventListener("keydown", async e => {
        const cmd = cmdInput.value.trim().toUpperCase();
        if (e.key !== "Enter" || !cmd) return;
        let r = await postCmd(cmd, false);
        if (r.status === 409) {
            if (!confirm(`${cmd}\n\nThe flight computer acts on this immediately, there is no arm step.\nExpect: ${r.watch}\n\nSend it?`))
                return cmdInput.placeholder = "CANCELLED: " + cmd, void (cmdInput.value = "");
            r = await postCmd(cmd, true);
        }
        cmdInput.value = "";
        cmdInput.placeholder = r.ok ? `SENT ${cmd}  -  WATCH: ${r.watch}` : `REFUSED ${cmd}: ${r.error}`;
    });

    // --- COM port selectors: /ports lists what is plugged in; POST assigns a port to a link (server.py) ---
    async function refreshPorts(choice) {
        const opts = choice ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) } : {};
        const r = await fetch("/ports", opts).catch(() => null);
        if (!r || !r.ok) return;
        const st = await r.json();
        for (const link of ["xbee", "lora"]) {
            const sel = document.getElementById("port-" + link), cur = st[link].port || "";
            if (document.activeElement !== sel) {                    // don't rebuild the list while it is open
                const items = st.ports.map(p => `<option value="${p.device}" title="${p.description}">${p.device}</option>`);
                if (cur && !st.ports.some(p => p.device === cur)) items.push(`<option value="${cur}">${cur} (unplugged)</option>`);
                sel.innerHTML = '<option value="">--</option>' + items.join("");
                sel.value = cur;
            }
            document.getElementById("dot-" + link).className = "dot " + (st[link].open ? "open" : cur ? "retry" : "");
        }
    }
    ["xbee", "lora"].forEach(link =>
        document.getElementById("port-" + link).addEventListener("change", e => refreshPorts({ [link]: e.target.value })));
    setInterval(() => refreshPorts(), 2000);

    // --- Desktop app (app.py): CAMERA opens a second native window instead of a browser tab ---
    document.getElementById("camera-link")?.addEventListener("click", e => {
        if (window.pywebview) { e.preventDefault(); pywebview.api.camera(); }
    });

    // --- START EVERYTHING ---
    refreshPorts();
    restoreTable();
    loadCSVData();
    setInterval(updateClock, 1000);
});
