const fs = require('fs');
const http = require('http');

/**
 * ═══════════════════════════════════════════════════════════════
 *  Suprwise — Fleet Sync Logic
 * ═══════════════════════════════════════════════════════════════
 *  Fetches current vehicles from the Blackbuck Proxy and
 *  syncs them to our local fleet database (fleet.json).
 * ═══════════════════════════════════════════════════════════════
 */

const PROXY_URL = 'http://localhost:3000/api/fetch-blackbuck';
const FLEET_FILE = './fleet.json';

function fetchVehicles() {
  return new Promise((resolve, reject) => {
    http.get(PROXY_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success) resolve(parsed.vehicles);
          else reject(new Error(parsed.error || 'Failed to fetch vehicles'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function syncFleet() {
  console.log('🔄 Starting Fleet Sync from Blackbuck GPS…');
  
  try {
    const vehicles = await fetchVehicles();
    
    // Filter out invalid registrations
    const validVehicles = vehicles.filter(v => v.reg && v.reg !== 'OBJECTOBJECT');
    
    // Load existing fleet if any
    let fleet = [];
    if (fs.existsSync(FLEET_FILE)) {
      try {
        fleet = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
      } catch (e) {
        console.warn('⚠️ Could not read existing fleet.json, starting fresh.');
      }
    }

    const initialCount = fleet.length;
    let addedCount = 0;
    let updatedCount = 0;

    validVehicles.forEach(v => {
      const existingIndex = fleet.findIndex(f => f.reg === v.reg);
      
      if (existingIndex !== -1) {
        // Update existing vehicle data
        fleet[existingIndex] = {
          ...fleet[existingIndex],
          ...v,
          lastSync: new Date().toISOString()
        };
        updatedCount++;
      } else {
        // Add new vehicle to fleet
        fleet.push({
          ...v,
          addedAt: new Date().toISOString(),
          lastSync: new Date().toISOString(),
          status: 'Active'
        });
        addedCount++;
      }
    });

    // Write back to fleet.json
    fs.writeFileSync(FLEET_FILE, JSON.stringify(fleet, null, 2));

    console.log('\n✅ Sync Complete!');
    console.log(`   Total in fleet: ${fleet.length}`);
    console.log(`   Newly added:    ${addedCount}`);
    console.log(`   Updated:        ${updatedCount}`);
    console.log(`   Data saved to:  ${FLEET_FILE}\n`);

    // Output summary
    fleet.forEach(v => {
      console.log(`   [${v.reg}] Status: ${v.ignition} | Last Update: ${v.lastUpdate || 'N/A'}`);
    });

  } catch (error) {
    console.error('\n❌ Sync Failed:', error.message);
    console.log('   Ensure the proxy server (node manual-login.js) is running.\n');
  }
}

syncFleet();
