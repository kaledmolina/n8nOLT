const axios = require('axios');
const API_KEY = '3332756bd57545ba99a55b54fa666c18';
const TARGET_HOST = 'intalnet.vortex-m2.com';

const axiosConfig = {
  headers: {
    'X-Token': API_KEY,
    'X-API-Key': API_KEY,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0'
  },
  timeout: 15000
};

async function test() {
  try {
    const res = await axios.get(`https://${TARGET_HOST}/api/system/get_olts`, axiosConfig);
    console.log("OLT List:");
    console.log(JSON.stringify(res.data, null, 2));
    
    // Also check for Board 16 for OLT 7
    console.log("\nSearching for ONUs on OLT 7 Board 16 Port 7...");
    // get_all_onus_details filtered to board 16
    const resOnus = await axios.get(`https://${TARGET_HOST}/api/onu/get_all_onus_details?olt_id=7&board=16`, axiosConfig);
    console.log("ONUs found on OLT 7, Board 16:");
    console.log(JSON.stringify(resOnus.data, null, 2));
    
    // Also check get_onus_signals which is lighter
    const resSignals = await axios.get(`https://${TARGET_HOST}/api/onu/get_onus_signals?olt_id=7&board=16`, axiosConfig);
    console.log("Signals found on OLT 7, Board 16:");
    console.log(JSON.stringify(resSignals.data, null, 2));

  } catch (err) {
    console.error(err.message);
    if (err.response) console.error(err.response.data);
  }
}

test();
