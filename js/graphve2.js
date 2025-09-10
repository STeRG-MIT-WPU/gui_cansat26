document.addEventListener("DOMContentLoaded", function () {
    const csvFilePath = "telemetry.csv";
    const maxPoints = 50;
    const timer = 200;
    let altitudeData = [];
    let velocityData = [];
    let accelerationData = [];

    const graphs = {
        altitude: { selector: "#altitude-graph", data: altitudeData, key: "ALTITUDE" },
        velocity: { selector: "#velocity-graph", data: velocityData, key: "TEMP_AB" },
        acceleration: { selector: "#acceleration-graph", data: accelerationData, key: "AX" }
    };

    // --- Fixed Y scale ranges ---
    const yLimits = {
        altitude: { min: -200, max: 1500 },       // meters
        velocity: { min: 0, max: 100 },      // temperature (C)
        acceleration: { min: -5, max: 3 }    // m/s²
    };

    function updateData(list, val) {
        val = parseFloat(val) || 0;
        list.push(val);
        if (list.length > maxPoints) list.shift();
    }

    function renderGraph(svgId, data, key) {
        const svg = d3.select(svgId);
        const width = svg.node().getBoundingClientRect().width;
        const height = svg.node().getBoundingClientRect().height;
        svg.selectAll("*").remove();

        const margin = { top: 10, right: 10, bottom: 20, left: 30 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        const x = d3.scaleLinear()
            .domain([0, data.length - 1])
            .range([0, innerWidth]);

        // --- Fixed Y scale logic ---
        let minVal = yLimits[key].min;
        let maxVal = yLimits[key].max;

        const dataMin = d3.min(data);
        const dataMax = d3.max(data);

        // Expand only if data exceeds current limits
        if (dataMin < minVal) minVal = dataMin * 1.1;
        if (dataMax > maxVal) maxVal = dataMax * 1.1;

        const y = d3.scaleLinear()
            .domain([minVal, maxVal])
            .range([innerHeight, 0]);
        // ----------------------------------

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        g.append("g")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(d3.axisBottom(x).ticks(5))
            .selectAll("text").style("font-size", "8px");

        g.append("g")
            .call(d3.axisLeft(y).ticks(5))
            .selectAll("text").style("font-size", "8px");

        // Grid lines
        g.append("g")
            .selectAll(".x-grid")
            .data(x.ticks(5))
            .enter().append("line")
            .attr("class", "x-grid")
            .attr("x1", d => x(d))
            .attr("x2", d => x(d))
            .attr("y1", 0)
            .attr("y2", innerHeight)
            .attr("stroke", "#aaaaaa")
            .attr("stroke-width", 0.5)
            .attr("stroke-dasharray", "2,2");

        g.append("g")
            .selectAll(".y-grid")
            .data(y.ticks(5))
            .enter().append("line")
            .attr("class", "y-grid")
            .attr("x1", 0)
            .attr("x2", innerWidth)
            .attr("y1", d => y(d))
            .attr("y2", d => y(d))
            .attr("stroke", "#aaaaaa")
            .attr("stroke-width", 0.5)
            .attr("stroke-dasharray", "2,2");

        const line = d3.line()
            .x((_, i) => x(i))
            .y(d => y(d))
            .curve(d3.curveMonotoneX);

        g.append("path")
            .datum(data)
            .attr("fill", "none")
            .attr("stroke", "#65e0e0")
            .attr("stroke-width", 2)
            .attr("d", line);
    }

    function saveDataToLocalStorage() {
        const saved = {
            altitude: altitudeData,
            velocity: velocityData,
            acceleration: accelerationData
        };
        localStorage.setItem("graphData", JSON.stringify(saved));
    }

    function loadDataFromLocalStorage() {
        const saved = JSON.parse(localStorage.getItem("graphData") || "{}");
        if (saved.altitude) altitudeData = saved.altitude;
        if (saved.velocity) velocityData = saved.velocity;
        if (saved.acceleration) accelerationData = saved.acceleration;
    }

    function drawAllGraphs() {
        renderGraph(graphs.altitude.selector, altitudeData, "altitude");
        renderGraph(graphs.velocity.selector, velocityData, "velocity");
        renderGraph(graphs.acceleration.selector, accelerationData, "acceleration");
    }

    function loadCSVData() {
        fetch(csvFilePath + "?t=" + new Date().getTime())
            .then(res => res.text())
            .then(csv => {
                Papa.parse(csv, {
                    header: true,
                    skipEmptyLines: true,
                    complete: function (results) {
                        const rows = results.data;
                        if (!rows.length) return;

                        const lastRow = rows[rows.length - 1];

                        updateData(altitudeData, lastRow["ALTITUDE"]);
                        updateData(velocityData, lastRow["TEMP_AB"]);
                        updateData(accelerationData, lastRow["AY"]);

                        saveDataToLocalStorage();
                        drawAllGraphs();
                    }
                });
            });

        setTimeout(loadCSVData, timer);
    }

    loadDataFromLocalStorage();
    drawAllGraphs();
    loadCSVData();
});

// Clear simulation button
document.getElementById("clr_sim").addEventListener("click", function () {
  localStorage.removeItem("rocketPath");
  localStorage.removeItem("lastRowCount");

  rocketPath = [];
  lastRowCount = 0;

  if (rocketPolyline) {
    rocketPolyline.setPath([]);
  }

  if (rocketMarker) {
    rocketMarker.setMap(null);
    rocketMarker = null;
  }

  console.log("Simulation data cleared.");
});
