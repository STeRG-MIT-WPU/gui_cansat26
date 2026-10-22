"""CanSat ground station: XBee + LoRa (serial) and MQTT -> per-link CSV, served to the browser.

    python server.py [--xbee COM5] [--lora COM6] [--baud 115200] [--port 8000] [--no-browser]

Each link writes data_<xbee|lora|mqtt>.csv; the GUI polls the one picked with ?src=.
Frame layout and MQTT settings come from rf_pcb-fw (Core/Src/freertos.c, Core/Inc/telemetry.h).
"""
import argparse, base64, csv, json, math, os, shutil, sys, threading, time, webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

XBEE_PORT, LORA_PORT, BAUD = "COM5", "COM6", 115200          # ground-side radios; override with --xbee/--lora
MQTT_BROKER, MQTT_PORT = "broker.hivemq.com", 1883
MQTT_TOPIC_TLM, MQTT_TOPIC_CMD, MQTT_TOPIC_IMG = "cansat/011/tlm", "cansat/011/cmd", "cansat/011/img"

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
        self.name, self.ser, self.mqtt, self.images, self.count = name, None, None, {}, 0
        self.path = os.path.join(ROOT, f"data_{name}.csv")
        if os.path.exists(self.path) and sum(1 for _ in open(self.path)) > 1:    # keep last session's log
            os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
            shutil.move(self.path, os.path.join(ROOT, "logs", f"data_{name}_{datetime.now():%Y%m%d_%H%M%S}.csv"))
        with open(self.path, "w", newline="") as f:
            csv.writer(f).writerow(HEADERS)

    def feed(self, line):
        line = line.strip()
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


def serial_reader(src, port, baud):
    import serial
    last_err = None
    while True:
        try:
            with serial.Serial(port, baud, timeout=2) as ser:     # LoRa frame comes in 2 chunks, 500 ms apart
                print(f"[{src.name}] {port} open @ {baud}")
                src.ser, last_err = ser, None
                while True:
                    line = ser.readline().decode(errors="ignore")
                    if line:
                        src.feed(line)
        except serial.SerialException as e:
            src.ser = None
            if str(e) != last_err:                                   # say it once, not every 3 s
                print(f"[{src.name}] {port}: {e} (retrying every 3 s until it appears)")
                last_err = str(e)
            time.sleep(3)


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

    def do_GET(self):                                               # /latest -> newest image per link for camera.html
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
        body = json.dumps(latest).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):                                              # {"src": "xbee", "cmd": "CX,ON"}
        if self.path != "/cmd":
            return self.send_error(404)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or b"{}"))
        src, cmd = SOURCES.get(body.get("src")), str(body.get("cmd", "")).strip()
        ok = bool(src and cmd) and src.send(cmd)
        with open(os.path.join(ROOT, "command.csv"), "a", newline="") as f:
            csv.writer(f).writerow([datetime.now().strftime("%H:%M:%S"), body.get("src"), cmd, int(ok)])
        print(f"[{body.get('src')}] cmd {cmd!r} -> {'sent' if ok else 'FAILED (link not open)'}")
        self.send_response(200 if ok else 503)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": ok}).encode())


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xbee", default=XBEE_PORT)
    ap.add_argument("--lora", default=LORA_PORT)
    ap.add_argument("--baud", type=int, default=BAUD)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)                     # log lines show up when piped too

    import serial.tools.list_ports
    print("COM ports present:", [f"{p.device} ({p.description})" for p in serial.tools.list_ports.comports()] or "none")

    for name in ("xbee", "lora", "mqtt"):
        SOURCES[name] = Source(name)
    threading.Thread(target=serial_reader, args=(SOURCES["xbee"], args.xbee, args.baud), daemon=True).start()
    threading.Thread(target=serial_reader, args=(SOURCES["lora"], args.lora, args.baud), daemon=True).start()
    mqtt_reader(SOURCES["mqtt"])

    url = f"http://localhost:{args.port}/index.html?src="
    print(f"GUI: {url}xbee  {url}lora  {url}mqtt   (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url + "xbee")
    try:
        ThreadingHTTPServer(("", args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
