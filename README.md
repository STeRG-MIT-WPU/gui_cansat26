# CanSat 2026 Ground Station GUI

Browser-based ground station for Team 011 (STeRG, MIT-WPU) CanSat 2026. A small Python server
receives telemetry from the flight computer over **XBee**, **LoRa** and **MQTT**, logs each link
to its own CSV, reassembles downlinked images, and serves a dashboard with live values, graphs,
a 3D attitude model, a GNSS map and the camera view.

The frame format, MQTT settings and image protocol follow the flight software:

- RF board firmware: https://github.com/STeRG-MIT-WPU/rf_pcb-fw
- Flight computer firmware (branch `FC`): https://github.com/STeRG-MIT-WPU/cansat26_fw

## Features

- One identical dashboard per link, selected with `?src=xbee|lora|mqtt` or the three coloured circles in the
  top bar (orange XBEE, purple LORA, cyan MQTT; hover for the name).
- Live telemetry: accelerometer, gyro, magnetometer, Euler angles, altitude, pressure,
  temperature, velocity, GNSS, current, voltage, battery %, software state, error flags.
- Mission clock (`T+hh:mm:ss`) and packet counter from the packet itself.
- Flight-phase bar: BOOT → STANDBY → ASCENT → DESCENT → RECOVERY.
- Error-flag grid decoded from the FC `EFLAG` field (see below).
- 3D CanSat model (`CanSat.glb`) driven by the received roll / pitch / yaw, with a calibrate button.
- GNSS map (deck.gl + MapLibre on ESRI imagery) that flies to the first fix and draws the track.
- CAMERA tab opens a separate screen showing the latest image received on XBee and on MQTT.
- Telecommands: a menu of every FC command from the FC handoff next to the command box; Enter sends
  it on the link currently shown, dangerous ones ask for confirmation first (see below).
- Raw data table of the last 100 packets.
- The ring around the active circle is green while packets arrive and red after 3 s of silence.

## Requirements

- Python 3.10+ (tested on 3.13)
- `pip install -r requirements.txt` (pyserial, paho-mqtt)
- The desktop window uses Microsoft Edge WebView2, which is part of Windows 10/11. The map
  and 3D libraries load from CDNs, so the ground station PC needs internet access for the map
  tiles and for MQTT.

Node / Electron are optional (`npm run start:electron`) and not needed for normal use.

## Running

Desktop app (one command, opens its own window):

```
python app.py
```

Pick the COM port of the XBee and LoRa radios from the two selectors at the bottom left. The list
shows every port currently plugged in and refreshes every 2 s, so radios can be connected after
the app is open. The dot next to each selector is grey (no port), red (port chosen but not open,
retried every 3 s) or green (receiving). The choice is saved in `ports.json` and preselected the
next time the app starts; change it there whenever the port numbers move.

The same GUI can also be served to a normal browser:

```
python server.py
```

Options for both commands:

| Option          | Default            | Meaning                                                |
|-----------------|--------------------|--------------------------------------------------------|
| `--xbee COMx`   | last GUI choice    | Serial port of the XBee ground radio                   |
| `--lora COMx`   | last GUI choice    | Serial port of the LoRa ground receiver                |
| `--baud N`      | `115200`           | Baud rate for both serial links                        |
| `--port N`      | `8000`             | HTTP port                                              |
| `--no-browser`  | off                | `server.py` only: do not open the browser              |

Screens (the desktop app opens the first one; CAMERA opens in a second window):

- http://localhost:8000/index.html?src=xbee
- http://localhost:8000/index.html?src=lora
- http://localhost:8000/index.html?src=mqtt
- http://localhost:8000/camera.html

MQTT uses `broker.hivemq.com:1883`, topics `cansat/011/tlm` (telemetry), `cansat/011/cmd`
(uplink) and `cansat/011/img` (images). Change the constants at the top of `server.py` if the
team ID or broker changes.

## Telecommands

The command box on each dashboard follows `GUI_HANDOFF.md` of the FC firmware (branch `FC`): the
GUI sends the exact upper-case strings, the FC acts on them immediately and never answers over the
radio, so each menu entry comes with the telemetry field to watch for confirmation.

How to operate it:

1. Open the **COMMANDS** menu in the command box and pick an entry. Entries ending in `<...>` are
   put in the box without the number so you type it (`SERVO ` + `1500`); `TIME hh mm ss` is
   prefilled with the PC clock. You can also type the whole command yourself, case does not matter.
2. Press **Enter**. The server checks the line (known command, argument in range, ASCII, 127 chars
   max, 20 ms after the previous one) and writes it to the link of the screen you are on: the
   serial port of that radio, or `cansat/011/cmd` on MQTT. Each screen only ever uses its own link.
3. `RESET`, `PERSIST CLEAR`, `STATE n`, `DEPLOY`, `BURN`, `BURN <ms>` and `SD CLEAR` open a
   confirmation dialog first, as the FC has no arm step. Cancel sends nothing.
4. The box then shows `SENT <command> - WATCH: ...` with the expected evidence
   (`PKT increments`, `STATE changes within one packet`, `$IMGSTART ...`), or `REFUSED` with the
   reason. Every attempt is logged in `command.csv` with time, link and result.

| Group      | Commands                                                                                              |
|------------|-------------------------------------------------------------------------------------------------------|
| Mission    | `ENABLE`, `DISABLE`, `TIME hh mm ss`, `CALIB`, `STATE 0..4`, `RESET`, `PERSIST CLEAR`                 |
| Actuators  | `DEPLOY`, `PARA`, `SERVO STOW|DEPLOY|1000..2000`, `BURN [1..10000|OFF]`, `PROP ON|OFF|TARE`, `PROP HEADING deg`, `PROP 1|2|ALL us`, `RW ON|OFF`, `BUZZ ON|OFF` |
| Camera     | `CAPTURE`, `IMG TX id`, `SD CLEAR`                                                                    |
| Bench only | `BENCH ON|OFF`, `CAM AUTO ON|OFF`                                                                     |

`SIM`, `DIAG`, `HELP`, `STATUS` and the other USB-only console commands are refused, as the handoff
asks. `BUZZ ON` / `BUZZ OFF` is the recommended link test: it is audible on the CanSat.

## Data files

| Path                        | Content                                                         |
|-----------------------------|-----------------------------------------------------------------|
| `data_xbee.csv` etc.        | Frames of the current session, one file per link                |
| `logs/data_<link>_<ts>.csv` | Previous sessions, rotated automatically at start-up            |
| `images/xbee/`, `images/mqtt/` | Reassembled JPEGs, `IMG00007.jpg`; `_partial` if chunks were lost |
| `command.csv`               | Every command sent: time, link, command, success                |

These are runtime files and are ignored by git (except the `command.csv` header).

## Telemetry frame

Every radio carries the same FC frame, `|` separates vector components:

```
$,TEAM_ID,TIME,PKT,ACC(x|y|z),GYR(x|y|z),MAG(x|y|z),EUL(r|p|y),ALT,PRES,TEMP,VEL(x|y|z),
  GNSS_TIME,LAT,LON,GNSS_ALT,SATS,GNSS_VEL(x|y),CURRENT,VOLT,BATT%,STATE,EFLAG,#
```

Units: altitude m, pressure hPa, temperature °C, current A, voltage V.
`STATE` 0..4 = BOOT, STANDBY, ASCENT, DESCENT, RECOVERY.

### Error flags

`EFLAG` is the hex value of `pd.e_flag` from `variables.h` in the FC firmware:

| Bit | Flag           | Bit | Flag             |
|-----|----------------|-----|------------------|
| 0   | E_NONE         | 6   | E_STALL          |
| 1   | E_LOW_BAT      | 7   | E_MOUNT          |
| 2   | E_COMM_LOS     | 8   | E_FULL           |
| 3   | E_COMM_DELAY   | 9   | E_FLASH          |
| 4   | E_PARA         | 10  | E_PAYLOAD        |
| 5   | E_SD_NOT_FOUND |     |                  |

The FC currently writes the field both as a bit mask (`|= E_FLASH`) and as a plain bit number
(`= 4` for E_PARA, …). The GUI accepts both forms and also shows the raw hex value.

### Images

The FC sends a JPEG as NMEA-style lines, relayed unchanged by the RF board on XBee and MQTT
(LoRa carries no images):

```
$IMGSTART,<id>,<size>,<total>*hh
$IMG,<id>,<seq>,<total>,<len>,<base64 of 135 bytes>*hh
$IMGEND,<id>,<total>,<size>*hh
```

`hh` is the XOR of all characters between `$` and `*`. Lines with a bad checksum are dropped.
On `$IMGEND` the chunks are joined in sequence order and written to `images/<link>/`. If chunks
are missing (typical on MQTT) the file is still written with a `_partial` suffix and the number
of missing chunks is printed.

## Repository layout

```
app.py             desktop window around server.py (pywebview)
server.py          serial + MQTT receiver, CSV logger, image reassembly, HTTP server, /cmd, /latest, /ports
test_server.py     self-check of the frame parser and image reassembly: python test_server.py
index.html         main dashboard (Cansat.css)
camera.html        camera screen (camera.css)
Model.html         3D attitude view, embedded in index.html (js/modelv2.js, CanSat.glb)
3DMaps.html        GNSS map, embedded in index.html (js/3DMapsV2.js)
js/source.js       reads ?src= and picks the CSV to poll
js/data3.js        dashboard values, phases, error flags, command box
js/graph2.js       live graphs
Precheck GUI/      pre-flight checklist screen
```

## Tests

```
python test_server.py
```

Prints `server ok` when the frame parser, checksum and image reassembly behave as expected.
