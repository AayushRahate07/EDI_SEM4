const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

// Configuration
// Set COM_PORT in your environment to match your Arduino port:
//   Windows: COM3, COM4, COM6, etc.
//   macOS:   /dev/tty.usbmodem14101  (run: ls /dev/tty.* to find yours)
//   Linux:   /dev/ttyUSB0 or /dev/ttyACM0
const PORT_NAME = process.env.COM_PORT || 'COM6';
const BAUD_RATE = 9600;
const API_URL = process.env.API_URL || 'http://localhost:3000/api/hardware/scan';

console.log(`Starting NFC Hardware Bridge on ${PORT_NAME}...`);

const port = new SerialPort({ path: PORT_NAME, baudRate: BAUD_RATE }, function (err) {
  if (err) {
    return console.log('Error opening port: ', err.message);
  }
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

// Debounce: track last-sent time per UID to avoid hammering the backend
const lastSentTime = {};
const DEBOUNCE_MS = 2000;

parser.on('data', async (data) => {
  const reading = data.trim();
  console.log(`[Arduino] ${reading}`);

  // Extract the UID (looks for 8 to 14 hex characters)
  const uidMatch = reading.match(/([A-Fa-f0-9]{8,14})/);

  if (uidMatch) {
    const uid = uidMatch[1].toUpperCase();

    // Skip if the same UID was sent within the debounce window
    const now = Date.now();
    if (lastSentTime[uid] && now - lastSentTime[uid] < DEBOUNCE_MS) {
      return;
    }
    lastSentTime[uid] = now;

    console.log(`[Bridge] Tag Detected! Sending UID: ${uid} to cloud...`);

    try {
      const response = await axios.post(API_URL, { uid });
      console.log(`[Cloud Response] Status: ${response.data.status} | Msg: ${response.data.message}`);
    } catch (error) {
      if (error.response) {
        console.error(`[Cloud Error] ${error.response.data.message}`);
      } else {
        console.error(`[Cloud Error] ${error.message}`);
      }
    }
    console.log('--------------------------------------------------');
  }
});
