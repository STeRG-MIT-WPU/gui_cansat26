    let mapRocket;
  let rocketMarker;
  let rocketPath = JSON.parse(localStorage.getItem("rocketPath") || "[]");
  let rocketPolyline;
  let lastRowCount = parseInt(localStorage.getItem("lastRowCount") || "0");
  let customLocationMarker = null;
  let coordsControl; // box for showing coordinates

  const MAX_ZOOM_LEVEL = 17;
  const timer = 500; // ms refresh interval
  const csvFilePath = "data.csv";
  const shuttlepng = "Image\Screenshot 2025-03-11 173318.jpg";

  // =========================
  // Initialize the map
  // =========================
  function initMap() {
    mapRocket = L.map("map", {
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 22,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapRocket);

    // --- Coordinates display (top right) ---
    coordsControl = L.control({ position: "bottomleft" });
    coordsControl.onAdd = function () {
      this._div = L.DomUtil.create("div", "coords-display");
      this.update();
      return this._div;
    };
    coordsControl.update = function (lat, lng) {
      this._div.innerHTML = lat && lng
        ? `<b>Rocket Coordinates</b><br>Lat: ${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}`
        : "<b>Rocket Coordinates</b><br>Waiting...";
    };
    coordsControl.addTo(mapRocket);

    // Restore existing path if available
    if (rocketPath.length > 0) {
      panAndZoomMap(mapRocket, rocketPath);

      rocketPolyline = L.polyline(rocketPath, {
        color: "#00f",
        weight: 2,
      }).addTo(mapRocket);

      const lastRocket = rocketPath[rocketPath.length - 1];
      rocketMarker = L.marker(lastRocket, {
        icon: L.icon({
          iconUrl: shuttlepng,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
        title: "Rocket",
      }).addTo(mapRocket);

      coordsControl.update(lastRocket.lat, lastRocket.lng);
    }

    // Initial fetch + live updates
    fetchAndDrawInitialCSV();
    setInterval(fetchAndAppendNewCSV, timer);
  }

  // =========================
  // Fit map bounds to path
  // =========================
  function panAndZoomMap(map, path) {
    if (path.length === 0) return;

    const latLngs = path.map(p => L.latLng(p.lat, p.lng));
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds);

    map.once("zoomend", () => {
      if (map.getZoom() > MAX_ZOOM_LEVEL) {
        map.setZoom(MAX_ZOOM_LEVEL);
      }
    });
  }

  // =========================
  // Load initial CSV data
  // =========================
  function fetchAndDrawInitialCSV() {
    fetch(csvFilePath + "?t=" + Date.now())
      .then(res => res.text())
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: function (results) {
            const allRows = results.data;
            lastRowCount = allRows.length;
            localStorage.setItem("lastRowCount", lastRowCount.toString());

            allRows.forEach(row => {
              const rocketPos = {
                lat: parseFloat(row.GNSS_LATITUDE || row.lat),
                lng: parseFloat(row.GNSS_LONGITUDE || row.lng),
              };
              if (!isNaN(rocketPos.lat) && !isNaN(rocketPos.lng)) {
                rocketPath.push(rocketPos);
              }
            });

            if (rocketPolyline) {
              rocketPolyline.setLatLngs(rocketPath);
            } else {
              rocketPolyline = L.polyline(rocketPath, {
                color: "#00f",
                weight: 2,
              }).addTo(mapRocket);
            }

            localStorage.setItem("rocketPath", JSON.stringify(rocketPath));

            const lastRocket = rocketPath[rocketPath.length - 1];
            if (lastRocket) {
              if (!rocketMarker) {
                rocketMarker = L.marker(lastRocket, {
                  icon: L.icon({
                    iconUrl: shuttlepng,
                    iconSize: [40, 40],
                    iconAnchor: [20, 20],
                  }),
                  title: "Rocket",
                }).addTo(mapRocket);
              }
              coordsControl.update(lastRocket.lat, lastRocket.lng);
            }
          },
        });
      })
      .catch(err => console.error("CSV Load Error:", err));
  }

  // =========================
  // Fetch and append new rows
  // =========================
  function fetchAndAppendNewCSV() {
    fetch(csvFilePath + "?t=" + Date.now())
      .then(res => res.text())
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: function (results) {
            const allRows = results.data;
            const newRows = allRows.slice(lastRowCount);
            lastRowCount = allRows.length;
            localStorage.setItem("lastRowCount", lastRowCount.toString());

            newRows.forEach(row => {
              const rocketPos = {
                lat: parseFloat(row.GNSS_LATITUDE || row.lat),
                lng: parseFloat(row.GNSS_LONGITUDE || row.lng),
              };

              if (!isNaN(rocketPos.lat) && !isNaN(rocketPos.lng)) {
                rocketPath.push(rocketPos);
                rocketPolyline.setLatLngs(rocketPath);
                localStorage.setItem("rocketPath", JSON.stringify(rocketPath));

                if (rocketMarker) {
                  rocketMarker.setLatLng(rocketPos);
                } else {
                  rocketMarker = L.marker(rocketPos, {
                    icon: L.icon({
                      iconUrl: shuttlepng,
                      iconSize: [40, 40],
                      iconAnchor: [20, 20],
                    }),
                    title: "Rocket",
                  }).addTo(mapRocket);
                }

                mapRocket.setView(rocketPos);
                coordsControl.update(rocketPos.lat, rocketPos.lng);
              }
            });
          },
        });
      })
      .catch(err => console.error("CSV Update Error:", err));
  }

  // =========================
  // Show custom recovery location
  // =========================
  function showCustomLocation() {
    const input = document.getElementById("recovery-coords").value.trim();
    const [latStr, lngStr] = input.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) return;

    const location = L.latLng(lat, lng);

    if (customLocationMarker) {
      mapRocket.removeLayer(customLocationMarker);
    }

    customLocationMarker = L.marker(location, {
      icon: L.icon({
        iconUrl: "http://maps.google.com/mapfiles/ms/icons/red-pushpin.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      }),
      title: "Recovery Location",
    }).addTo(mapRocket);

    mapRocket.setView(location, MAX_ZOOM_LEVEL);
    document.getElementById("recovery-coords").value = "";
  }

  // =========================
  // Event Listeners
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    initMap();

    document.getElementById("recovery-coords").addEventListener("keypress", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        showCustomLocation();
      }
    });

    document.getElementById("clr_sim").addEventListener("click", function () {
      localStorage.removeItem("rocketPath");
      localStorage.removeItem("lastRowCount");

      rocketPath = [];
      lastRowCount = 0;

      if (rocketPolyline) {
        mapRocket.removeLayer(rocketPolyline);
        rocketPolyline = null;
      }

      if (rocketMarker) {
        mapRocket.removeLayer(rocketMarker);
        rocketMarker = null;
      }

      if (coordsControl) coordsControl.update();

      console.log("Simulation data cleared.");
    });
  });
