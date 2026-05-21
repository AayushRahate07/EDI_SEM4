const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

// Configuration
const PORT_NAME = 'COM6'; 
const BAUD_RATE = 9600;
const API_URL = 'http://localhost:3000/api/hardware/scan';

console.log(`Starting NFC Hardware Bridge on ${PORT_NAME}...`);

const port = new SerialPort({ path: PORT_NAME, baudRate: BAUD_RATE }, function (err) {
  if (err) {
    return console.log('Error opening port: ', err.message);
  }
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', async (data) => {
  const reading = data.trim();
  console.log(`[Arduino] ${reading}`);

  // Extract the UID (looks for 8 to 14 hex characters)
  const uidMatch = reading.match(/([A-Fa-f0-9]{8,14})/);

  if (uidMatch) {
    const uid = uidMatch[1].toUpperCase();
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
