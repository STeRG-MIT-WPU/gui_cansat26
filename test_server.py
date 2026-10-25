"""python test_server.py  -- parser self-check against the frame from rf_pcb-fw Tests/test_telemetry.c
and the $IMG line format from cansat26_fw (FC branch) Core/Src/image_link.c."""
import base64
import server
from server import parse_tlm, image_line, nmea_ok

fc = ("$,011,125,42,0.10|-0.20|9.81,1.00|2.00|3.00,10.50|20.50|30.50,1.50|2.50|180.00,"
      "512.30,948.12,27.40,0.30|0.40|-5.20,41400.0,18.520430,73.856743,560.0,9,0.30|0.40,"
      "0.45,7.90,83.0,3,1A,#\r\n")
r = parse_tlm(fc)
assert r["TEAM_ID"] == "011" and r["MISSION_TIME"] == "125" and r["PACKET_COUNT"] == "42"
assert r["AZ"] == "9.81" and r["MZ"] == "30.50" and r["YAW"] == "180.00"
assert r["ALTITUDE"] == "512.30" and r["PRESSURE"] == "948.12" and r["TEMPERATURE"] == "27.40"
assert r["GNSS_LATITUDE"] == "18.520430" and r["GNSS_SATELLITES"] == "9" and r["GNSS_VY"] == "0.40"
assert r["CURRENT"] == "0.45" and r["VOLTAGE"] == "7.90" and r["BATTERY"] == "83.0"
assert r["SOFTWARE_STATE"] == "3" and r["ERROR_FLAGS"] == "1A" and r["VELOCITY"] == "5.22"
assert parse_tlm("$,011,125,42,0.1|0.2,#") is None          # truncated
assert parse_tlm("$IMG,3,0,10,135,AAAA*4F") is None         # image line
assert parse_tlm("STATUS") is None


def fc_line(body):
    """What image_link.c send_line() produces: XOR of chars after '$', two upper hex digits."""
    x = 0
    for c in body[1:]:
        x ^= ord(c)
    return f"{body}*{x:02X}"


# image: 300 raw bytes -> 135 + 135 + 30, as the FC chunks it
raw = bytes(range(256)) + b"cansat26 jpeg tail!!" * 2 + b"ABCD"
assert len(raw) == 300
chunks = [raw[i:i + 135] for i in range(0, 300, 135)]
lines = [fc_line("$IMGSTART,7,300,3")]
for seq, c in enumerate(chunks):
    lines.append(fc_line(f"$IMG,7,{seq},3,{len(c)},{base64.b64encode(c).decode()}"))
lines.append(fc_line("$IMGEND,7,3,300"))
assert all(nmea_ok(l) for l in lines)
assert not nmea_ok(lines[1][:-1] + ("0" if lines[1][-1] != "0" else "1"))

store = {}
assert image_line(store, lines[0]) is None
assert image_line(store, lines[2]) is None                   # out of order is fine
assert image_line(store, lines[1]) is None
assert image_line(store, lines[3]) is None
assert image_line(store, lines[4]) == ("7", raw, 0)

store = {}                                                   # MQTT dropped a line -> partial image, 1 missing
image_line(store, lines[0]); image_line(store, lines[1]); image_line(store, lines[3])
assert image_line(store, lines[4]) == ("7", chunks[0] + chunks[2], 1)

try:
    image_line({}, "$IMGSTART,7,300,3*00")                   # corrupted line is rejected
    assert False
except ValueError:
    pass

# serial_reader follows src.port: opens the port picked in the GUI, closes it when the pick changes
import sys, threading, time, types


class FakeSerial:
    opened = []

    def __init__(self, port, baud, timeout):
        if port == "COM_MISSING":
            raise FakeSerial.exc("no such port")
        self.port = port
        FakeSerial.opened.append(port)

    def __enter__(self): return self
    def __exit__(self, *a): FakeSerial.opened.remove(self.port)
    def readline(self): time.sleep(0.05); return b"$,bad,#\r\n" if self.port == "COM_A" else b""


FakeSerial.exc = type("SerialException", (Exception,), {})
sys.modules["serial"] = types.SimpleNamespace(Serial=FakeSerial, SerialException=FakeSerial.exc)
time.sleep, real_sleep = (lambda s: real_sleep(min(s, 0.05))), time.sleep      # speed up the 1 s / 3 s waits


class Src:
    name, port, ser, fed = "xbee", None, None, []
    def feed(self, line): self.fed.append(line)


src = Src()
threading.Thread(target=server.serial_reader, args=(src, 115200), daemon=True).start()
real_sleep(0.3); assert FakeSerial.opened == [] and src.ser is None             # nothing picked yet
src.port = "COM_A"; real_sleep(0.3); assert FakeSerial.opened == ["COM_A"] and src.ser and src.fed
src.port = "COM_B"; real_sleep(0.3); assert FakeSerial.opened == ["COM_B"]       # switched, COM_A released
src.port = "COM_MISSING"; real_sleep(0.3); assert FakeSerial.opened == [] and src.ser is None   # retrying
src.port = None; real_sleep(0.3); assert FakeSerial.opened == []

# each link keeps its own frames; module chatter is ignored
server.SOURCES.clear()
server.SOURCES.update(xbee=server.Source("xbee"), lora=server.Source("lora"))
x, lo = server.SOURCES["xbee"], server.SOURCES["lora"]
x.feed(fc); x.feed("+++OK\r\n"); lo.feed("[LORA] " + fc); lo.feed(fc)    # ground radio tag is stripped
assert (x.count, lo.count) == (1, 2)
assert sum(1 for _ in open(x.path)) == 2 and sum(1 for _ in open(lo.path)) == 3

# telecommand gate (FC/GUI_HANDOFF.md section 2/3): exact strings pass, ranges are enforced, nothing else goes out
ok = lambda c: server.check_cmd(c)[1] is None
for c in ("ENABLE", "TIME 12 30 0", "STATE 3", "SERVO 1500", "BURN", "BURN 250", "BURN OFF", "PROP HEADING -90.5",
          "PROP ALL 2000", "IMG TX 7", "CAM AUTO ON", "PERSIST CLEAR"):
    assert ok(c), c
for c in ("", "STATE 5", "TIME 24 0 0", "SERVO 999", "BURN 0", "BURN 10001", "PROP HEADING 361", "SIM ENABLE",
          "DIAG", "HELP", "TLM USB ON", "$,011,1,#", "ENABLE\t", "X" * 128, "state 1"):
    assert not ok(c), c
assert server.check_cmd("RESET")[0][3] == 1 and server.check_cmd("BUZZ ON")[0][3] == 0     # confirm flags

# command routing: each screen sends on its own link only
class FakeMqtt:
    sent = []
    def publish(self, topic, cmd): FakeMqtt.sent.append((topic, cmd)); return type("I", (), {"rc": 0})()
class FakeSer:
    sent = []
    def write(self, b): FakeSer.sent.append(b)
server.SOURCES["mqtt"] = server.Source("mqtt"); server.SOURCES["mqtt"].mqtt = FakeMqtt(); x.ser = FakeSer()
assert server.SOURCES["mqtt"].send("BUZZ ON") and FakeMqtt.sent == [(server.MQTT_TOPIC_CMD, "BUZZ ON")] and not FakeSer.sent
assert x.send("BUZZ OFF") and FakeSer.sent == [b"BUZZ OFF\r\n"]
assert not lo.send("BUZZ OFF") and FakeSer.sent == [b"BUZZ OFF\r\n"]   # LoRa port closed -> fails, never borrows XBee's
print("server ok")
