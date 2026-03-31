const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TOKEN = process.env.BLACKBUCK_TOKEN;
const URL = "https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200";

async function fetchLiveData() {
    if (!TOKEN) {
        console.error('❌ No BLACKBUCK_TOKEN found in .env');
        process.exit(1);
    }

    try {
        console.log('📡 Fetching live data from Blackbuck API...');
        const response = await axios.get(URL, {
            headers: { 
                'Authorization': TOKEN,
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (response.data && response.data.list) {
            const list = response.data.list;
            console.log(`✅ Successfully fetched ${list.length} vehicles.\n`);
            
            // Format into a table-like structure for the user
            const snapshot = list.slice(0, 10).map(v => ({
                Vehicle: v.truck_no || v.reg_no || 'Unknown',
                Status: v.gps_status || 'Unknown',
                Ignition: v.ignition_status || 'OFF',
                Speed: v.current_speed || 0,
                Battery: v.truck ? v.truck.batteryVoltage : 'N/A',
                LastUpdate: v.last_updated_on_format || 'N/A'
            }));
            
            console.table(snapshot);
        } else {
            console.log('⚠️ API returned no list of vehicles. Response:', response.data);
        }
    } catch (err) {
        console.error('❌ API Fetch failed:', err.response ? `${err.response.status} - ${JSON.stringify(err.response.data)}` : err.message);
    }
}

fetchLiveData();
