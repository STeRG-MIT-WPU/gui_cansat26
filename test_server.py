"""python test_server.py  -- parser self-check against the frame from rf_pcb-fw Tests/test_telemetry.c
and the $IMG line format from cansat26_fw (FC branch) Core/Src/image_link.c."""
import base64
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
print("server ok")
