# Connecting a Real MQTT Broker

This guide covers connecting the digital twin to a real MQTT broker for production use.

---

## Topic structure

The adapter subscribes to a single wildcard topic. All sensors arrive in a single JSON message per publication — one topic, one snapshot, all sensors.

```
Topic: wtp/plant/{plantId}/sensors
Example: wtp/plant/plant-01/sensors
```

`plantId` is configurable from the dashboard settings panel (default: `plant-01`). This allows multiple users of the starter kit to connect different plants to the same demo broker without topic collisions.

---

## Payload format

```json
{
  "timestamp": 1234567890123,
  "readings": {
    "inlet_flow": 142.3,
    "raw_turbidity": 4.2,
    "coag_ph": 7.1,
    "filter_1_dp": 98.0,
    "filter_2_dp": 102.5,
    "filtered_turbidity": 0.28,
    "chlorine_dose": 1.8,
    "residual_chlorine": 0.45,
    "tank_level": 67.0,
    "outlet_pressure": 4.2
  }
}
```

- `timestamp` — Unix milliseconds (`int(time.time() * 1000)` in Python)
- `readings` — object with all sensor IDs as keys, numeric values

You don't need to publish all 10 sensors in every message. Missing keys are ignored gracefully. But publishing all of them ensures the rule engine can evaluate correlation rules correctly.

---

## Configuring the broker from the dashboard

No code editing required. Click **`⚙ Settings`** in the top bar and fill in:

| Field | Example |
|---|---|
| Broker URL | `wss://your-cluster.hivemq.cloud:8884/mqtt` |
| Username | `your-username` |
| Password | `your-password` |
| Plant ID | `plant-01` |

Click **`Test & Connect →`** — the dashboard connects live and shows the result. If successful, the configuration is saved in `localStorage` and restored automatically on every page reload.

> **Note:** The dashboard only supports `ws://` and `wss://` (WebSocket). For installations with mutual TLS (client certificates), you need an intermediate proxy — see the TLS section below.

---

## Publishing from Python (paho-mqtt)

```bash
pip install paho-mqtt
```

### Minimal example

```python
import paho.mqtt.client as mqtt
import json
import time

BROKER = "broker.emqx.io"
PORT   = 1883
PLANT  = "plant-01"
TOPIC  = f"wtp/plant/{PLANT}/sensors"

client = mqtt.Client()
client.connect(BROKER, PORT, keepalive=60)

while True:
    payload = {
        "timestamp": int(time.time() * 1000),
        "readings": {
            "inlet_flow":         142.3,
            "raw_turbidity":       4.2,
            "coag_ph":             7.1,
            "filter_1_dp":        98.0,
            "filter_2_dp":       102.5,
            "filtered_turbidity":  0.28,
            "chlorine_dose":       1.8,
            "residual_chlorine":   0.45,
            "tank_level":         67.0,
            "outlet_pressure":     4.2,
        }
    }
    client.publish(TOPIC, json.dumps(payload))
    time.sleep(0.5)  # 500ms interval — matches the simulator tick rate
```

### With authentication

```python
client = mqtt.Client()
client.username_pw_set("your-username", "your-password")
client.connect(BROKER, PORT)
```

### With TLS (wss://)

```python
import ssl

client = mqtt.Client(transport="websockets")
client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
client.connect("your-broker.com", 8884)
```

> **Note on mutual TLS:** Browsers cannot perform mutual TLS (client certificates) over WebSocket. If your installation requires mutual TLS, you need an intermediate proxy (e.g. nginx with `proxy_pass` to the broker's internal endpoint). The proxy handles the client certificate; the browser connects to the proxy over standard `wss://`.

---

## Brokers for testing

| Broker | URL | Notes |
|---|---|---|
| EMQX public | `ws://broker.emqx.io:8083/mqtt` | Free, no auth, shared |
| EMQX public (TLS) | `wss://broker.emqx.io:8084/mqtt` | Free, no auth, shared |
| Mosquitto (local) | `ws://localhost:9001/mqtt` | Requires WebSocket listener configured |
| HiveMQ Cloud | `wss://your-cluster.s1.eu.hivemq.cloud:8884/mqtt` | Free tier available, auth required |
| HiveMQ public | `wss://broker.hivemq.com:8884/mqtt` | Free, no auth, shared |

For local Mosquitto, add this to `mosquitto.conf`:

```
listener 9001
protocol websockets
```

---

## Reading from a PLC or SCADA system

If your plant already has a SCADA system or PLC publishing to MQTT, you may need a thin adapter to transform the existing topic/payload structure into the format above.

A minimal Node.js bridge:

```js
// bridge.js — subscribes to existing PLC topics, republishes in WTP Twin format
import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://your-plc-broker:1883');

client.on('connect', () => {
  client.subscribe('plc/sensors/#');
});

const readings = {};

client.on('message', (topic, message) => {
  // Map your existing topic structure to sensor IDs
  const sensorMap = {
    'plc/sensors/flow1':    'inlet_flow',
    'plc/sensors/turb_raw': 'raw_turbidity',
    // ... add your mappings
  };

  const sensorId = sensorMap[topic];
  if (sensorId) {
    readings[sensorId] = parseFloat(message.toString());
  }
});

// Publish a complete snapshot every 500ms
setInterval(() => {
  if (Object.keys(readings).length > 0) {
    client.publish('wtp/plant/plant-01/sensors', JSON.stringify({
      timestamp: Date.now(),
      readings: { ...readings },
    }));
  }
}, 500);
```