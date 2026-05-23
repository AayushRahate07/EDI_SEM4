const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

const PORT_NAME = process.env.COM_PORT || 'COM3';
const BAUD_RATE = 9600;
const API_URL = process.env.API_URL || 'http://localhost:3000/api/hardware/scan';
const RECONNECT_DELAY_MS = 3000;

// Debounce: track last-sent time per UID to avoid hammering the backend
const lastSentTime = {};
const DEBOUNCE_MS = 2000;

let port = null;
let parser = null;
let reconnectTimer = null;
let isConnected = false;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log(`[Bridge] Connecting to ${PORT_NAME} at ${BAUD_RATE} baud...`);

  port = new SerialPort({ path: PORT_NAME, baudRate: BAUD_RATE }, function (err) {
    if (err) {
      console.error(`[Bridge] Failed to open port: ${err.message}`);
      scheduleReconnect();
      return;
    }

    isConnected = true;
    console.log(`[Bridge] ✓ Connected to Arduino on ${PORT_NAME}`);

    // Enable DTR and RTS for stable transmission
    port.set({ dtr: true, rts: true }, function (err) {
      if (err) console.error(`[Bridge] DTR/RTS error: ${err.message}`);
    });
  });

  parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', async (data) => {
    const reading = data.trim();
    if (!reading) return;
    console.log(`[Arduino] ${reading}`);

    // Extract the UID (8 to 14 hex characters)
    const uidMatch = reading.match(/([A-Fa-f0-9]{8,14})/);
    if (!uidMatch) return;

    const uid = uidMatch[1].toUpperCase();

    // Debounce: skip if same UID was sent within the window
    const now = Date.now();
    if (lastSentTime[uid] && now - lastSentTime[uid] < DEBOUNCE_MS) return;
    lastSentTime[uid] = now;

    console.log(`[Bridge] Tag Detected! UID: ${uid} → sending to backend...`);

    try {
      const response = await axios.post(API_URL, { uid }, { timeout: 5000 });
      const { status, message } = response.data;
      const icon = status === 'ACTIVE' ? '✓' : status === 'UNREGISTERED' ? '⚠' : '✕';
      console.log(`[Cloud] ${icon} ${status} | ${message}`);
    } catch (error) {
      if (error.response) {
        console.error(`[Cloud Error] ${error.response.status} — ${JSON.stringify(error.response.data)}`);
      } else {
        console.error(`[Cloud Error] ${error.message} (is sop-engine running on port 3000?)`);
      }
    }
    console.log('-'.repeat(50));
  });

  port.on('close', () => {
    isConnected = false;
    console.warn(`[Bridge] ⚠ Port ${PORT_NAME} closed. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    scheduleReconnect();
  });

  port.on('error', (err) => {
    isConnected = false;
    console.error(`[Bridge] Serial error: ${err.message}. Reconnecting...`);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return; // already scheduled
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`╔══════════════════════════════════════════╗`);
console.log(`║   NFC Hardware Bridge — Auto-Reconnect   ║`);
console.log(`╚══════════════════════════════════════════╝`);
console.log(`   Port    : ${PORT_NAME}`);
console.log(`   Baud    : ${BAUD_RATE}`);
console.log(`   Backend : ${API_URL}`);
console.log('');

connect();

// Keep the process alive forever
process.on('uncaughtException', (err) => {
  console.error(`[Bridge] Uncaught exception: ${err.message}`);
  scheduleReconnect();
});
