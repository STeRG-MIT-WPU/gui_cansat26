const csvFilePath = "data.csv";
const REFRESH_MS = 500;
let rocketPath = [];

const deckgl = new deck.DeckGL({
  container: 'map',
  map: maplibregl,
  mapStyle: {
    "version": 8,
    "sources": {
      "esri": {
        "type": "raster",
        "tiles": [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        "tileSize": 256,
      }
    },
    "layers": [
      {
        "id": "esri",
        "type": "raster",
        "source": "esri",
        "minzoom": 0,
        "maxzoom": 20
      }
    ]
  },
  initialViewState: {
    longitude: 73.815226,
    latitude: 18.518516,
    zoom: 14,
    pitch: 60,
    bearing: 0
  },
  controller: true
});

function loadCSVAndUpdate() {
  fetch(csvFilePath + "?t=" + Date.now())
    .then(res => res.text())
    .then(csvText => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
          rocketPath = results.data
            .map(row => {
              let lat = parseFloat(row.GNSS_LATITUDE || row.rocket_lat);
              let lng = parseFloat(row.GNSS_LONGITUDE || row.rocket_lng);
              let alt = parseFloat(row.ALTITUDE || row.alt || row.Altitude);
              if (!isNaN(lat) && !isNaN(lng) && !isNaN(alt)) {
                return [lng, lat, alt];
              }
              return null;
            })
            .filter(p => p !== null);

          updateLayers();
        }
      });
    })
    .catch(err => console.error("CSV Load Error:", err));
}

function updateLayers() {
  if (rocketPath.length < 2) return;

  const lineData = [];
  for (let i = 1; i < rocketPath.length; i++) {
    lineData.push({ start: rocketPath[i - 1], end: rocketPath[i] });
  }

  const lastPos = rocketPath[rocketPath.length - 1];

  deckgl.setProps({
    layers: [
      new deck.LineLayer({
        id: 'line-layer',
        data: lineData,
        getSourcePosition: d => d.start,
        getTargetPosition: d => d.end,
        getColor: [255, 0, 0, 200],
        getWidth: 7
      }),
      new deck.ScatterplotLayer({
        id: 'points-layer',
        data: rocketPath,
        getPosition: d => d,
        getFillColor: [0, 200, 255],
        getRadius: 0
      }),
      new deck.IconLayer({
        id: 'rocket-marker',
        data: [{ position: lastPos }],
        getIcon: d => 'rocket',
        getPosition: d => d.position,
        getSize: 6,
        sizeUnits: 'pixels',
        getColor: [255, 255, 0],
        iconAtlas: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Rocket_icon.png',
        iconMapping: {
          rocket: { x: 0, y: 0, width: 512, height: 512, anchorY: 512 }
        }
      })
    ]
  });

  const tracker = document.getElementById("tracker");
  if (tracker && lastPos) {
    tracker.innerHTML = `
      <b>Rocket Position</b><br>
      Lat: ${lastPos[1].toFixed(6)} <br>
      Lng: ${lastPos[0].toFixed(6)} <br>
      Alt: ${lastPos[2].toFixed(2)} m
    `;
  }
}

loadCSVAndUpdate();
setInterval(loadCSVAndUpdate, REFRESH_MS);

document.addEventListener("contextmenu", event => {
  event.preventDefault();
});
