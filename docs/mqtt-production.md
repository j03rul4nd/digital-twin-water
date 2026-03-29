# Connecting a Real MQTT Broker

This guide covers connecting the digital twin to a real MQTT broker, including standard MQTT, Sparkplug B, and custom payload formats.

---

## Configuring the broker from the dashboard

No code editing required. Click **`Configure & Connect →`** in the MQTT panel and fill in:

| Field | Example |
|---|---|
| Broker URL | `wss://your-cluster.hivemq.cloud:8884/mqtt` |
| Username | `your-username` |
| Password | `your-password` |
| Plant ID | `plant-01` |

Click **`Test & Connect →`** — the dashboard connects live and shows the result. Config is saved in `localStorage` and restored on every page reload.

> **Note:** The dashboard only supports `ws://` and `wss://` (WebSocket). For installations with mutual TLS (client certificates), you need an intermediate proxy — see the TLS section below.

---

## Standard MQTT format

### Topic structure

```
wtp/plant/{plantId}/sensors
```

Example: `wtp/plant/plant-01/sensors`

### Payload format

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
- `readings` — object with sensor IDs as keys, numeric values

You don't need to include all 10 sensors. Missing keys are ignored. But publishing all of them ensures correlation rules in the RuleEngine evaluate correctly.

---

## Sparkplug B support

If your devices use **Sparkplug B** (Ignition, Cirrus Link, Opto 22, modern PLCs), the adapter detects it automatically.

**No configuration needed.** The adapter checks the topic pattern:

```
spBv1.0/{groupId}/DDATA/{edgeNodeId}/{deviceId}
spBv1.0/{groupId}/DBIRTH/{edgeNodeId}/{deviceId}
```

When a Sparkplug B topic is detected, the payload is decoded using the built-in Protobuf parser (`src/utils/SparkplugParser.js`). Metric names are extracted and cleaned automatically:

- `WTP/InletFlow` → `wtpinletflow`
- `inlet_flow` → `inlet_flow`
- `Process/Filter1/DP` → `dp`

If the metric names from your device don't match the expected sensor IDs (`inlet_flow`, `filter_1_dp`, etc.), use the **`⇄ Payload`** custom mapper to define explicit field mappings after the Sparkplug decode.

**Supported Sparkplug B data types:**
Int8, Int16, Int32, Int64, UInt8, UInt16, UInt32, UInt64, Float, Double, Boolean → converted to numeric

---

## Custom payload formats

If your broker publishes a format different from the standard `{ timestamp, readings }`, click **`⇄ Payload`** in the topbar.

### Auto-detect mode (default)

Handles automatically:
- Native format: `{ readings: { flow: 142.3 } }`
- Sparkplug-like arrays: `{ metrics: [{ name: "flow", value: 142.3 }] }`
- Sensor arrays: `{ sensors: [{ id: "flow", value: 142.3 }] }`
- Nested data: `{ data: { process: { flow: 142.3 } } }`
- Flat fields: `{ flow: 142.3, ph: 7.1, ts: 1234567890 }`

### Flat mode

All numeric fields at the root level become sensor readings. Non-numeric fields and common metadata keys (`timestamp`, `id`, `device`, etc.) are skipped.

### Custom mapping mode

Define explicit field mappings using dot notation:

| From (your payload) | To (sensor ID) |
|---|---|
| `data.process.flow` | `inlet_flow` |
| `sensors[0].value` | `raw_turbidity` |
| `ph` | `coag_ph` |

Paste a sample message in the **Analyze** section and the panel suggests mappings automatically.

---

## Publishing from Python (paho-mqtt)

```bash
pip install paho-mqtt
```

### Standard format

```python
import paho.mqtt.client as mqtt
import json
import time

BROKER = "your-cluster.hivemq.cloud"
PORT   = 8883
USER   = "your-username"
PASS   = "your-password"
PLANT  = "plant-01"
TOPIC  = f"wtp/plant/{PLANT}/sensors"

client = mqtt.Client()
client.username_pw_set(USER, PASS)
client.tls_set()  # for wss:// / mqtts://
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
    time.sleep(0.5)
```

### With flat format (using ⇄ Payload auto-detect)

```python
payload = {
    "ts":           int(time.time() * 1000),
    "inlet_flow":   142.3,
    "filter_1_dp":  98.0,
    "chlorine":     1.8,
    "tank":         67.0,
}
client.publish(TOPIC, json.dumps(payload))
```

Configure `⇄ Payload` → Flat mode, and set timestamp field to `ts`.

---

## Brokers for testing

| Broker | URL | Notes |
|---|---|---|
| EMQX public | `ws://broker.emqx.io:8083/mqtt` | Free, no auth, shared |
| EMQX public (TLS) | `wss://broker.emqx.io:8084/mqtt` | Free, no auth, shared |
| HiveMQ Cloud | `wss://your-cluster.s1.eu.hivemq.cloud:8884/mqtt` | Free tier, auth required |
| HiveMQ public | `wss://broker.hivemq.com:8884/mqtt` | Free, no auth, shared |
| Mosquitto (local) | `ws://localhost:9001/mqtt` | Requires WebSocket listener |

For local Mosquitto, add to `mosquitto.conf`:

```
listener 9001
protocol websockets
```

---

## Mutual TLS (client certificates)

Browsers cannot perform mutual TLS (client certificates) over WebSocket. If your installation requires it, use an nginx proxy:

```nginx
server {
    listen 8884 ssl;
    ssl_certificate     /path/to/server.crt;
    ssl_certificate_key /path/to/server.key;
    ssl_client_certificate /path/to/ca.crt;
    ssl_verify_client on;

    location / {
        proxy_pass          http://your-internal-broker:1883;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade $http_upgrade;
        proxy_set_header    Connection "Upgrade";
    }
}
```

The browser connects to nginx over standard `wss://`. nginx handles the mutual TLS with the broker using the client certificate.

---

## Node.js bridge for PLC/SCADA systems

If your plant has an existing SCADA system or PLC publishing to MQTT on a different topic/format, use a thin Node.js bridge to adapt:

```js
// bridge.js — reads from existing PLC topics, republishes in WTP format
import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://your-plc-broker:1883');

client.on('connect', () => {
  client.subscribe('plc/sensors/#');
});

const readings = {};

client.on('message', (topic, message) => {
  const sensorMap = {
    'plc/sensors/flow1':    'inlet_flow',
    'plc/sensors/turb_raw': 'raw_turbidity',
    'plc/sensors/ph':       'coag_ph',
    'plc/sensors/dp_f1':    'filter_1_dp',
    // ... add your mappings
  };

  const sensorId = sensorMap[topic];
  if (sensorId) readings[sensorId] = parseFloat(message.toString());
});

// Publish complete snapshot every 500ms
setInterval(() => {
  if (Object.keys(readings).length > 0) {
    client.publish('wtp/plant/plant-01/sensors', JSON.stringify({
      timestamp: Date.now(),
      readings: { ...readings },
    }));
  }
}, 500);
```

Alternatively, use the **`⇄ Payload`** custom mapper in the dashboard to handle the format transformation without any bridge code.

---

## Testing with the included server.js

The repo includes `server.js` — a Node.js MQTT publisher that simulates a real plant publishing to HiveMQ Cloud:

```bash
# In a separate folder from the dashboard
npm install  # install express and mqtt
node server.js
```

Visit `http://localhost:3000` for a control panel with buttons to:
- Force **Filter #1 Clog** (DP → 180 mbar, triggers warning)
- Force **Filter #1 Critical** (DP → 205 mbar, triggers danger)
- **Reset** to normal values

Configure `server.js` with your HiveMQ credentials at the top of the file, then click **`Configure & Connect →`** in the dashboard with the same broker URL and credentials.