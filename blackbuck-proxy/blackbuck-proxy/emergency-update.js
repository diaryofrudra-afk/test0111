const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// This script bypasses the proxy and updates the database directly to test the UI
async function emergencyUpdate() {
    console.log('🛠 Starting emergency data update...');
    
    const ENV_PATH = path.join(__dirname, '../.env');
    const dbPath = path.join(__dirname, '../../suprwise-backend/suprwise.db');
    
    if (!fs.existsSync(ENV_PATH)) {
        console.error('❌ .env not found');
        return;
    }

    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    const tokenMatch = envContent.match(/BLACKBUCK_TOKEN=(.*)/);
    if (!tokenMatch) {
        console.error('❌ BLACKBUCK_TOKEN not found in .env');
        return;
    }
    const token = tokenMatch[1].trim();
    const authToken = token.startsWith('Token ') ? token : `Token ${token}`;

    console.log('📡 Fetching live data from Blackbuck...');
    const url = "https://api-fms.blackbuck.com/fmsiot/api/v2/gps/tracking/details?page_number=0&page_size=200&fleet_owner_id=5599426";
    
    try {
        const res = await fetch(url, {
            headers: { 
                "Authorization": authToken, 
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        if (!res.ok) {
            console.error(`❌ Blackbuck API error: ${res.status} ${res.statusText}`);
            return;
        }
        
        const data = await res.json();
        const vehicles = data.list || [];
        console.log(`✅ Received ${vehicles.length} vehicles.`);

        // Now we need to update the SQLite database directly
        // Since I don't have a sqlite3 node driver installed, I'll generate a shell script
        let sqlCommands = [];
        const tenantId = '0f23afb4-4332-44ca-84db-68fdea926004';

        vehicles.forEach(v => {
            const reg = v.truck_no || v.reg_no;
            const snapshot = JSON.stringify({
                latitude: v.latitude,
                longitude: v.longitude,
                speed: v.current_speed || 0,
                ignition: v.ignition_status || 'OFF',
                odometer: v.travelled_today,
                address: v.address,
                last_updated: new Date().toISOString()
            });

            sqlCommands.push(`INSERT INTO diagnostics (id, crane_reg, health, snapshot, tenant_id, updated_at) VALUES ('${Math.random()}', '${reg}', 'online', '${snapshot}', '${tenantId}', datetime('now')) ON CONFLICT(crane_reg, tenant_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at;`);
        });

        fs.writeFileSync('update_db.sql', sqlCommands.join('\n'));
        console.log('💾 SQL commands written to update_db.sql');
        
    } catch (e) {
        console.error(`❌ Update failed: ${e.message}`);
    }
}

emergencyUpdate();
