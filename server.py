"""CanSat ground station: XBee + LoRa (serial) and MQTT -> per-link CSV, served to the browser.

    python app.py                        # desktop window (see app.py); COM ports are picked in the GUI
    python server.py [--xbee COM5] [--lora COM6] [--baud 115200] [--port 8000] [--no-browser]

Each link writes data_<xbee|lora|mqtt>.csv; the GUI polls the one picked with ?src=.
Frame layout and MQTT settings come from rf_pcb-fw (Core/Src/freertos.c, Core/Inc/telemetry.h).
"""
import argparse, base64, csv, json, math, os, re, shutil, sys, threading, time, webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

BAUD = 115200                                                  # ground-side radios: ports are picked in the GUI
PORTS_FILE = os.path.join(ROOT, "ports.json")                    # last choice, restored at the next start
MQTT_BROKER, MQTT_PORT = "broker.hivemq.com", 1883
MQTT_TOPIC_TLM, MQTT_TOPIC_CMD, MQTT_TOPIC_IMG = "cansat/011/tlm", "cansat/011/cmd", "cansat/011/img"

# FC telecommands, FC/GUI_HANDOFF.md section 3 (cansat26_fw branch FC, f76ad0f). The GUI menu is built from
# this list and /cmd refuses anything that is not on it (section 3.4: SIM, DIAG, HELP, STATUS ... never go out).
# (group, menu text, regex the line must match or None for the menu text itself, confirm first, what to watch)
US, MS = r"(1\d{3}|2000)", r"([1-9]\d{0,3}|10000)"
COMMANDS = [
    ("Mission",   "ENABLE",             None, 0, "packets resume at 10 Hz, PKT increments"),
    ("Mission",   "DISABLE",            None, 0, "packets stop (image lines may still arrive)"),
    ("Mission",   "TIME hh mm ss",      r"TIME ([01]?\d|2[0-3]) ([0-5]?\d) ([0-5]?\d)", 0, "TIME jumps to the new value"),
    ("Mission",   "CALIB",              None, 0, "no visible change, ALT stays raw barometric"),
    ("Mission",   "STATE <0-4>",        r"STATE [0-4]", 1, "STATE changes within one packet (3 runs the full deployment)"),
    ("Mission",   "RESET",              None, 1, "gap of about 3 s, then PKT continues"),
    ("Mission",   "PERSIST CLEAR",      None, 1, "after the next RESET, PKT and STATE restart at 0"),
    ("Actuators", "DEPLOY",             None, 1, "nothing in the packet; EFLAG 4 only if still falling fast 2 s later"),
    ("Actuators", "PARA",               None, 0, "nothing in the packet"),
    ("Actuators", "SERVO STOW",         None, 0, "nothing in the packet"),
    ("Actuators", "SERVO DEPLOY",       None, 0, "nothing in the packet"),
    ("Actuators", "SERVO <1000-2000>",  r"SERVO " + US, 0, "nothing in the packet"),
    ("Actuators", "BURN",               None, 1, "nothing in the packet"),
    ("Actuators", "BURN <1-10000 ms>",  r"BURN " + MS, 1, "nothing in the packet"),
    ("Actuators", "BURN OFF",           None, 0, "nothing in the packet"),
    ("Actuators", "PROP ON",            None, 0, "EUL yaw settles toward the target"),
    ("Actuators", "PROP OFF",           None, 0, "nothing in the packet"),
    ("Actuators", "PROP TARE",          None, 0, "nothing in the packet"),
    ("Actuators", "PROP HEADING <deg>", r"PROP HEADING -?\d+(\.\d+)?", 0, "EUL yaw"),
    ("Actuators", "PROP 1 <us>",        r"PROP 1 " + US, 0, "nothing in the packet, 1500 = stop"),
    ("Actuators", "PROP 2 <us>",        r"PROP 2 " + US, 0, "nothing in the packet, 1500 = stop"),
    ("Actuators", "PROP ALL <us>",      r"PROP ALL " + US, 0, "nothing in the packet, 1500 = stop"),
    ("Actuators", "RW ON",              None, 0, "GYR z"),
    ("Actuators", "RW OFF",             None, 0, "GYR z"),
    ("Actuators", "BUZZ ON",            None, 0, "audible on the CanSat, use as the link test"),
    ("Actuators", "BUZZ OFF",           None, 0, "buzzer stops"),
    ("Camera",    "CAPTURE",            None, 0, "$IMGSTART with a new id within a few seconds"),
    ("Camera",    "IMG TX <id>",        r"IMG TX \d{1,5}", 0, "$IMGSTART,<id> again"),
    ("Camera",    "SD CLEAR",           None, 1, "nothing in the packet"),
    ("Bench only", "BENCH ON",          None, 0, "nothing in the packet"),
    ("Bench only", "BENCH OFF",         None, 0, "nothing in the packet"),
    ("Bench only", "CAM AUTO ON",       None, 0, "repeated $IMGSTART"),
    ("Bench only", "CAM AUTO OFF",      None, 0, "images stop"),
]


def check_cmd(cmd):
    """Section 2/3 line rules. Returns (COMMANDS entry, None) or (None, why it must not go to the FC)."""
    if len(cmd) > 127 or not all(32 <= ord(c) < 127 for c in cmd):
        return None, "printable ASCII only, at most 127 characters"
    for entry in COMMANDS:
        if re.fullmatch(entry[2] or re.escape(entry[1]), cmd):
            if entry[1].startswith("PROP HEADING") and not -180 <= float(cmd.split()[2]) <= 360:
                return None, "heading must be -180..360"
            return entry, None
    return None, "not an FC telecommand, pick one from the menu"


# FC frame, identical on every radio ('|' separates vector components):
# $,TEAM_ID,TIME,PKT,ACC(x|y|z),GYR(x|y|z),MAG(x|y|z),EUL(r|p|y),ALT,PRES,TEMP,VEL(x|y|z),
#   GNSS_TIME,LAT,LON,GNSS_ALT,SATS,GNSS_VEL(x|y),CURRENT,VOLT,BATT%,STATE,EFLAG,#
HEADERS = ["TEAM_ID", "MISSION_TIME", "PACKET_COUNT", "AX", "AY", "AZ", "GX", "GY", "GZ", "MX", "MY", "MZ",
           "ROLL", "PITCH", "YAW", "ALTITUDE", "PRESSURE", "TEMPERATURE", "VX", "VY", "VZ", "GNSS_TIME",
           "GNSS_LATITUDE", "GNSS_LONGITUDE", "GNSS_ALTITUDE", "GNSS_SATELLITES", "GNSS_VX", "GNSS_VY",
           "CURRENT", "VOLTAGE", "BATTERY", "SOFTWARE_STATE", "ERROR_FLAGS", "VELOCITY", "RX_TIME"]


def parse_tlm(line):
    """One FC frame -> dict keyed by HEADERS, or None if it is not a complete frame."""
    tok = line.strip().split(",")
    if len(tok) != 24 or tok[0] != "$" or tok[-1] != "#":
        return None
    flat = [v for t in tok[1:-1] for v in t.split("|")]
    if len(flat) != 33:
        return None
    row = dict(zip(HEADERS, flat))
    try:
        row["VELOCITY"] = "%.2f" % math.sqrt(sum(float(row[k]) ** 2 for k in ("VX", "VY", "VZ")))
    except ValueError:
        return None
    row["RX_TIME"] = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    return row


def nmea_ok(line):
    """'$...*hh' with hh = XOR of the chars between $ and * (cansat26_fw image_link.c send_line)."""
    body, _, hh = line.rpartition("*")
    x = 0
    for c in body[1:]:
        x ^= ord(c)
    return len(hh) == 2 and x == int(hh, 16)


def image_line(store, line):
    """Reassemble $IMGSTART/$IMG/$IMGEND lines (cansat26_fw image_link.c, relayed verbatim by the RF
    board over XBee and the MQTT img topic). Returns (id, bytes, missing) on $IMGEND, else None."""
    if not nmea_ok(line):
        raise ValueError("checksum")
    f = line.rpartition("*")[0].split(",")
    if f[0] == "$IMGSTART":
        store[f[1]] = {}
    elif f[0] == "$IMG" and f[1] in store:
        store[f[1]][int(f[2])] = f[5]
    elif f[0] == "$IMGEND" and f[1] in store:
        chunks = store.pop(f[1])
        data = base64.b64decode("".join(chunks[i] for i in sorted(chunks)))
        return f[1], data, int(f[2]) - len(chunks)
    return None


class Source:
    """One telemetry link. Appends frames to data_<name>.csv, saves images, sends commands."""

    def __init__(self, name):
        self.name, self.port, self.ser, self.mqtt, self.images, self.count = name, None, None, None, {}, 0
        self.path = os.path.join(ROOT, f"data_{name}.csv")
        if os.path.exists(self.path) and sum(1 for _ in open(self.path)) > 1:    # keep last session's log
            os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
            shutil.move(self.path, os.path.join(ROOT, "logs", f"data_{name}_{datetime.now():%Y%m%d_%H%M%S}.csv"))
        with open(self.path, "w", newline="") as f:
            csv.writer(f).writerow(HEADERS)

    def feed(self, line):
        line = re.sub(r"^\[\w+\]\s*", "", line.strip())           # ground radios prefix "[LORA] " / "[XBEE] "
        if line.startswith("$IMG"):
            try:
                done = image_line(self.images, line)
            except (IndexError, ValueError) as e:
                print(f"[{self.name}] bad image line ({e}): {line[:40]}")
                return
            if done:                                                 # one folder per link: images/xbee, images/mqtt
                img_id, data, missing = done
                folder = os.path.join(ROOT, "images", self.name)
                os.makedirs(folder, exist_ok=True)
                out = os.path.join(folder, f"IMG{int(img_id):05d}{'_partial' if missing else ''}.jpg")
                with open(out, "wb") as f:
                    f.write(data)
                print(f"[{self.name}] image saved {out}" + (f" ({missing} chunks missing)" if missing else ""))
            return
        row = parse_tlm(line)
        if row:
            with open(self.path, "a", newline="") as f:
                csv.writer(f).writerow(row[h] for h in HEADERS)
            self.count += 1
        elif line:
            print(f"[{self.name}] ignored: {line[:80]}")

    def send(self, cmd):
        try:
            if self.ser:
                self.ser.write((cmd + "\r\n").encode())
                return True
            if self.mqtt:
                return self.mqtt.publish(MQTT_TOPIC_CMD, cmd).rc == 0
        except Exception as e:
            print(f"[{self.name}] send failed: {e}")
        return False


def serial_reader(src, baud):
    """Keeps src.port open and follows it when the GUI picks another port (closes within 2 s)."""
    import serial
    last_err = None
    while True:
        port = src.port
        if not port:
            time.sleep(1)
            continue
        try:
            with serial.Serial(port, baud, timeout=2) as ser:     # LoRa frame comes in 2 chunks, 500 ms apart
                print(f"[{src.name}] {port} open @ {baud}")
                src.ser, last_err = ser, None
                while src.port == port:
                    line = ser.readline().decode(errors="ignore")
                    if line:
                        src.feed(line)
            print(f"[{src.name}] {port} closed")
        except serial.SerialException as e:
            if str(e) != last_err:                                   # say it once, not every 3 s
                print(f"[{src.name}] {port}: {e} (retrying every 3 s until it appears)")
                last_err = str(e)
            time.sleep(3)
        src.ser = None


def port_state():
    """What the GUI's COM selectors show: ports plugged in now + which one each link uses and if it is open."""
    import serial.tools.list_ports
    return {"ports": [{"device": p.device, "description": p.description} for p in serial.tools.list_ports.comports()],
            **{n: {"port": SOURCES[n].port, "open": SOURCES[n].ser is not None} for n in ("xbee", "lora")}}


def set_ports(choice):
    """{"xbee": "COM11"} / {"lora": ""}: hand the port to the reader thread and remember it for next time."""
    for n in ("xbee", "lora"):
        if n in choice:
            SOURCES[n].port = choice[n] or None
    with open(PORTS_FILE, "w") as f:
        json.dump({n: SOURCES[n].port for n in ("xbee", "lora")}, f)


def mqtt_reader(src):
    import paho.mqtt.client as mqtt
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:                                           # paho < 2.0
        client = mqtt.Client()

    def on_connect(c, *_):
        print(f"[mqtt] connected to {MQTT_BROKER}, subscribed {MQTT_TOPIC_TLM}, {MQTT_TOPIC_IMG}")
        c.subscribe([(MQTT_TOPIC_TLM, 0), (MQTT_TOPIC_IMG, 0)])

    client.on_connect = on_connect
    client.on_message = lambda c, u, msg: src.feed(msg.payload.decode(errors="ignore"))
    client.connect_async(MQTT_BROKER, MQTT_PORT, 60)                # retries/reconnects in the background
    client.loop_start()
    src.mqtt = client


SOURCES = {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    last_tx = 0.0

    def do_GET(self):                                               # /latest -> newest image per link for camera.html
        if self.path.split("?")[0] == "/ports":
            return self.send_json(port_state())
        if self.path == "/commands":                                # menu for the GUI command box
            return self.send_json([{"group": g, "text": t, "confirm": c, "watch": w} for g, t, _, c, w in COMMANDS])
        if self.path.split("?")[0] != "/latest":
            return super().do_GET()
        latest = {}
        for name in ("xbee", "mqtt"):
            folder = os.path.join(ROOT, "images", name)
            files = [os.path.join(folder, f) for f in os.listdir(folder)] if os.path.isdir(folder) else []
            if files:
                newest = max(files, key=os.path.getmtime)
                latest[name] = {"url": f"images/{name}/{os.path.basename(newest)}",
                                "time": datetime.fromtimestamp(os.path.getmtime(newest)).strftime("%H:%M:%S"),
                                "count": len(files)}
            else:
                latest[name] = None
        self.send_json(latest)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or b"{}"))
        if self.path == "/ports":                                   # {"xbee": "COM11"} from the GUI's selector
            set_ports(body)
            return self.send_json(port_state())
        if self.path != "/cmd":
            return self.send_error(404)
        # {"src": "xbee", "cmd": "state 1", "confirmed": true}; upper-case single-spaced words as the FC wants them
        src, cmd = SOURCES.get(body.get("src")), " ".join(str(body.get("cmd", "")).upper().split())
        entry, err = check_cmd(cmd)
        if err:
            print(f"[{body.get('src')}] cmd {cmd!r} refused: {err}")
            return self.send_json({"ok": False, "error": err}, 400)
        if entry[3] and not body.get("confirmed"):                  # section 3.5: no arm step on the FC, ask first
            return self.send_json({"ok": False, "error": "confirm", "watch": entry[4]}, 409)
        time.sleep(max(0.0, Handler.last_tx + 0.02 - time.time()))  # section 2: at least 20 ms between commands
        Handler.last_tx = time.time()
        ok = bool(src) and src.send(cmd)
        with open(os.path.join(ROOT, "command.csv"), "a", newline="") as f:
            csv.writer(f).writerow([datetime.now().strftime("%H:%M:%S"), body.get("src"), cmd, int(ok)])
        print(f"[{body.get('src')}] cmd {cmd!r} -> {'sent' if ok else 'FAILED (link not open)'}")
        self.send_json({"ok": ok, "watch": entry[4], "error": None if ok else "link not open"}, 200 if ok else 503)


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xbee", help="XBee COM port (otherwise the last one picked in the GUI)")
    ap.add_argument("--lora", help="LoRa COM port (otherwise the last one picked in the GUI)")
    ap.add_argument("--baud", type=int, default=BAUD)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    return ap.parse_args(argv)


def start(args):
    """Open the links and return the HTTP server, not yet serving (app.py serves it from a thread)."""
    sys.stdout.reconfigure(line_buffering=True)                     # log lines show up when piped too
    for name in ("xbee", "lora", "mqtt"):
        SOURCES[name] = Source(name)
    saved = json.load(open(PORTS_FILE)) if os.path.exists(PORTS_FILE) else {}
    set_ports({"xbee": args.xbee or saved.get("xbee"), "lora": args.lora or saved.get("lora")})
    print("COM ports present:", [f"{p['device']} ({p['description']})" for p in port_state()["ports"]] or "none")
    for name in ("xbee", "lora"):
        threading.Thread(target=serial_reader, args=(SOURCES[name], args.baud), daemon=True).start()
    mqtt_reader(SOURCES["mqtt"])
    return ThreadingHTTPServer(("", args.port), Handler)


if __name__ == "__main__":
    args = parse_args()
    httpd = start(args)
    url = f"http://localhost:{args.port}/index.html?src="
    print(f"GUI: {url}xbee  {url}lora  {url}mqtt   (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url + "xbee")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
