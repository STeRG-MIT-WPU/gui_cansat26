// GNSS track of the CanSat. Everything shown comes from the received telemetry (GNSS_LATITUDE,
// GNSS_LONGITUDE, GNSS_ALTITUDE): the map starts on a world view and flies to the first fix.
const csvFilePath = CSV_PATH;
const REFRESH_MS = 500;
let path = [];
let flownToFix = false;

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
  initialViewState: { longitude: 0, latitude: 0, zoom: 1, pitch: 0, bearing: 0 },   // no fix yet: whole world
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
          path = results.data
            .map(row => {
              const lat = parseFloat(row.GNSS_LATITUDE);
              const lng = parseFloat(row.GNSS_LONGITUDE);
              const alt = parseFloat(row.GNSS_ALTITUDE);
              if ([lat, lng, alt].some(isNaN)) return null;
              if (lat === 0 && lng === 0) return null;          // receiver reports 0,0 before it has a fix
              return [lng, lat, alt];
            })
            .filter(p => p !== null);

          updateLayers();
        }
      });
    })
    .catch(err => console.error("CSV Load Error:", err));
}

function updateLayers() {
  if (!path.length) return;

  const lineData = [];
  for (let i = 1; i < path.length; i++) {
    lineData.push({ start: path[i - 1], end: path[i] });
  }
  const lastPos = path[path.length - 1];

  const props = {
    layers: [
      new deck.LineLayer({
        id: 'line-layer',
        data: lineData,
        getSourcePosition: d => d.start,
        getTargetPosition: d => d.end,
        getColor: [255, 0, 0, 200],
        getWidth: 7
      }),
      new deck.IconLayer({
        id: 'cansat-marker',
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
  };
  if (!flownToFix) {                                              // first fix: fly in from the world view
    flownToFix = true;
    props.initialViewState = {
      longitude: lastPos[0], latitude: lastPos[1], zoom: 16, pitch: 60, bearing: 0,
      transitionDuration: 2000, transitionInterpolator: new deck.FlyToInterpolator()
    };
  }
  deckgl.setProps(props);

  const tracker = document.getElementById("tracker");
  if (tracker) {
    tracker.innerHTML = `
      <b>CanSat Position</b><br>
      Lat: ${lastPos[1].toFixed(6)} <br>
      Lng: ${lastPos[0].toFixed(6)} <br>
      Alt: ${lastPos[2].toFixed(1)} m
    `;
  }
}

loadCSVAndUpdate();
setInterval(loadCSVAndUpdate, REFRESH_MS);

document.addEventListener("contextmenu", event => {
  event.preventDefault();
});
