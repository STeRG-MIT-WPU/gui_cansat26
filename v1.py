import paho.mqtt.client as mqtt

# MQTT Broker details
BROKER = "0.tcp.in.ngrok.io"
PORT = 18608
TOPIC = "stm32/hello"
CSV_FILE = "data.csv"

# Callback when connected to broker
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("✅ Connected to MQTT Broker!")
        client.subscribe(TOPIC)
        print(f"📡 Subscribed to topic: {TOPIC}")
    else:
        print(f"❌ Connection failed with code {rc}")

# Callback when a message is received
def on_message(client, userdata, msg):
    message = msg.payload.decode('utf-8')
    print(f"📥 Received: {message}")
    with open(CSV_FILE, 'a', newline='') as file:
        file.write(message)

# Create MQTT client and assign callbacks
client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

# Connect and loop forever
print("🔌 Connecting to broker...")
client.connect(BROKER, PORT, 60)
client.loop_forever()
