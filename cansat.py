import serial
import csv
import threading
import time
    
# ==============================
# CONFIGURATION
# ==============================
TEAM_ID = "035"   # Change to "035" for CanSat
PORT = "COM4"    # Update with your COM port
BAUDRATE = 115200

# CSV files
TELEMETRY_CSV = "data.csv"
TELECOMMAND_CSV = "command.csv"

# Telemetry headers (Rocketry version)
TELEMETRY_HEADERS = [
    "TEAM_ID", "MISSION_TIME", "PACKET_COUNT", "ALTITUDE", "PRESSURE",
    "TEMPERATURE", "VOLTAGE", "GNSS_TIME", "GNSS_LATITUDE", "GNSS_LONGITUDE",
    "GNSS_ALTITUDE", "GNSS_SATELLITES", "AX", "AY", "AZ", "GX", "GY", "GZ",
    "SOFTWARE_STATE","HUMIDITY","CURRENT","MX","MY","MZ","ERROR_FLAGS","CHECKSUM","ACK"
]

TELECOMMAND_HEADERS = ["TIME", "COMMAND"]

# ==============================
# FUNCTIONS
# ==============================

def calculate_checksum(data: str) -> int:
    """Simple checksum = sum of ASCII values mod 256"""
    # return sum(ord(c) for c in data) % 256
    return 0;  # Disable checksum for CanSat

def send_ack(ser, pkt_count, ack_bit):
    """Send 1-bit ACK (1 = ACK, 0 = NACK)."""
    payload = f"{TEAM_ID},{pkt_count},{ack_bit}"
    checksum = calculate_checksum(payload)
    packet = f"#{payload},{checksum}$\r\n"
    ser.write(packet.encode())
    print(f"Sent ACK={ack_bit} for packet {pkt_count}")

def init_csv():
    """Create CSVs with headers if not present."""
    try:
        with open(TELEMETRY_CSV, "x", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(TELEMETRY_HEADERS)
    except FileExistsError:
        pass

    try:
        with open(TELECOMMAND_CSV, "x", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(TELECOMMAND_HEADERS)
    except FileExistsError:
        pass

def telemetry_task(ser):
    """Continuously read and process telemetry packets."""
    while True:
        try:
            line = ser.readline().decode(errors="ignore").strip()
            if not line.startswith("#") or not line.endswith("$"):
                continue  # invalid packet format

            packet = line[1:-1]  # strip '#' and '$'
            fields = packet.split(",")

            # Sanity check
            if (len(fields)-2) != len(TELEMETRY_HEADERS):
                print("Receieved :", len(fields), "Expected : ",len(TELEMETRY_HEADERS))
                print("[WARNING] Invalid packet length:", line)
                continue

            # Extract TEAM_ID and PKT_COUNT
            pkt_team_id = fields[1]
            pkt_count = fields[3]

            # TEAM_ID check
            if pkt_team_id != TEAM_ID:
                print("[WARNING] Wrong TEAM_ID:", pkt_team_id)
                print("Expected :", TEAM_ID, "Received :", pkt_team_id)
                send_ack(ser, pkt_count, 0)
                continue

            # Checksum validation
            received_checksum = fields[-3]
            # calculated_checksum = str(calculate_checksum(",".join(fields[:-1]))) # Disable checksum for CanSat
            if received_checksum != "00":  # Disable checksum for CanSat
                print("[WARNING] Checksum mismatch:", line)
                print("Received :", received_checksum, "Calculated : 00")
                send_ack(ser, pkt_count, 0)
                continue

            # Write valid data to CSV
            with open(TELEMETRY_CSV, "a", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(fields)

            print("[SUCCESS] Telemetry logged:", fields)
            send_ack(ser, pkt_count, 1)

        except Exception as e:
            print("[ERROR] Telemetry error:", e)

def telecommand_task(ser):
    """Continuously check for telecommands to send."""
    while True:
        try:
            with open(TELECOMMAND_CSV, "r") as f:
                reader = list(csv.reader(f))
                if len(reader) > 1:  # skip header row
                    last_cmd = reader[-1][1]
                    pkt_count = str(int(time.time()) % 10000)  # simple counter
                    payload = f"{TEAM_ID},{pkt_count},{last_cmd}"
                    checksum = calculate_checksum(payload)
                    packet = f"#{payload},{checksum}$\r\n"
                    ser.write(packet.encode())
                    print("[SUCCESS] Telecommand sent:", last_cmd)
        except Exception as e:
            print("[ERROR] Telecommand error:", e)

        time.sleep(0.25)  # check every 2s

# ==============================
# MAIN
# ==============================
if __name__ == "__main__":
    init_csv()
    ser = serial.Serial(PORT, BAUDRATE, bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE, timeout=1,)

    # Run telemetry + telecommand in parallel
    t1 = threading.Thread(target=telemetry_task, args=(ser,))
    t2 = threading.Thread(target=telecommand_task, args=(ser,))
    t1.start()
    t2.start()

    t1.join()
    t2.join()