// Which telemetry link this screen shows: ?src=xbee|lora|mqtt (default xbee).
// Loaded by index.html and by the map/model iframes, which read the parent's URL.
const SRC = (new URLSearchParams(window.top.location.search).get("src") || "xbee").toLowerCase();
const CSV_PATH = "data_" + SRC + ".csv";
