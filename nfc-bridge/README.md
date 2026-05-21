# nfc-bridge — Arduino NFC Hardware Bridge

A lightweight Node.js script that acts as a bridge between an Arduino-based NFC reader (MFRC522) and the `sop-engine` REST API.

**Only needed on the machine that has the Arduino physically plugged in.**

---

## How It Works

```
NFC Tag
   │  (tap)
   ▼
Arduino (MFRC522 module)
   │  Serial output: "UID:7F29BBDD\n"  (9600 baud)
   ▼
index.js  (reads serial line via serialport)
   │  Extracts hex UID using regex /([A-Fa-f0-9]{8,14})/
   │  Applies 2-second debounce per UID to avoid duplicate POSTs
   ▼
POST http://localhost:3000/api/hardware/scan
   │  Body: { "uid": "7F29BBDD" }
   ▼
sop-engine
   │  Stores UID in memory (lastScan)
   │  Looks up item in SQLite database
   ▼
Console log: "[Cloud Response] Status: ACTIVE | Msg: Item verified."
```

Simultaneously, the `/admin/inventory` page polls `GET /api/hardware/last-scan` every 1.5 seconds. When a new scan is detected, the NFC UID field auto-fills — even before the item is registered.

---

## Setup

```bash
npm install
```

> **Note:** `serialport` includes native C++ bindings compiled for your specific OS and Node.js version. Always run `npm install` after cloning — you cannot copy `node_modules` from another machine.

---

## Running

Find your Arduino's serial port first:

| OS | How to find it | Example |
|----|----------------|---------|
| **Windows** | Device Manager → Ports (COM & LPT) | `COM6` |
| **macOS** | `ls /dev/tty.*` in terminal | `/dev/tty.usbmodem14101` |
| **Linux** | `ls /dev/ttyUSB* /dev/ttyACM*` | `/dev/ttyUSB0` |

Then start the bridge:

```bash
# Windows
set COM_PORT=COM6 && npm start

# macOS / Linux
COM_PORT=/dev/tty.usbmodem14101 npm start
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COM_PORT` | `COM6` | Serial port where Arduino is connected |
| `API_URL` | `http://localhost:3000/api/hardware/scan` | Backend endpoint to POST scanned UIDs to |

---

## Expected Arduino Serial Output

The script looks for any line containing an 8–14 character hexadecimal string:

```
System Ready: Tap a tag to scan...
UID:7F29BBDD
UID:6FDAABDD
```

The regex `/([A-Fa-f0-9]{8,14})/` will extract `7F29BBDD` from any of these formats:
- `UID:7F29BBDD`
- `Card UID: 7F 29 BB DD` ← won't work (spaces break the hex string length)
- `7F29BBDD` ← works

> If your Arduino sketch outputs the UID with spaces between bytes, concatenate them before printing.

---

## Console Output

```
Starting NFC Hardware Bridge on COM6...
[Arduino] System Ready: Tap a tag to scan...
[Arduino] UID:7F29BBDD
[Bridge] Tag Detected! Sending UID: 7F29BBDD to cloud...
[Cloud Response] Status: ACTIVE | Msg: Item verified.
--------------------------------------------------
[Arduino] UID:6FDAABDD
[Bridge] Tag Detected! Sending UID: 6FDAABDD to cloud...
[Cloud Error] Item not found in inventory
--------------------------------------------------
```

`"Item not found in inventory"` is **expected** for unregistered tags. Register them first at `http://localhost:3001/admin/inventory`.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `serialport` | Reads data from Arduino over USB-Serial |
| `@serialport/parser-readline` | Parses incoming bytes into newline-delimited strings |
| `axios` | Makes HTTP POST requests to the backend |
