import asyncio
import httpx
import json
from datetime import datetime
import sys
import os

# Add the backend directory to path so we can import models if needed
sys.path.append(os.path.join(os.getcwd(), 'suprwise-backend'))

async def test_blackbuck_fetch():
    PROXY_URL = "http://localhost:3000/api/fetch-blackbuck"
    
    print("\n" + "="*80)
    print("Suprwise — Blackbuck System Integration Test")
    print("="*80)
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Target: {PROXY_URL}")
    print("-"*80)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            print("📡 Requesting data from proxy...")
            response = await client.get(PROXY_URL)
            
            if response.status_code != 200:
                print(f"❌ Error: Proxy returned HTTP {response.status_code}")
                return

            data = response.json()
            if not data.get("success"):
                print(f"❌ Error: Proxy reported failure: {data.get('error')}")
                return

            vehicles = data.get("vehicles", [])
            print(f"✅ Success! Captured {len(vehicles)} vehicles.\n")

            # Table Header
            header = f"{'REGISTRATION':<15} | {'IGN':<4} | {'SPEED':<8} | {'BATTERY':<7} | {'ODOMETER':<10} | {'LAST UPDATE'}"
            print(header)
            print("-" * len(header))

            for v in vehicles:
                reg = v.get('reg', 'N/A')
                ign = v.get('ignition', 'OFF')
                speed = f"{v.get('speed', 0)} km/h"
                batt = f"{v.get('battery')}V" if v.get('battery') else "N/A"
                odo = f"{v.get('odometer')} km" if v.get('odometer') else "N/A"
                time = v.get('lastUpdate', 'N/A')
                
                print(f"{reg:<15} | {ign:<4} | {speed:<8} | {batt:<7} | {odo:<10} | {time}")

            print("-" * len(header))
            print("\n📍 Real-time Location Sample:")
            for v in vehicles[:2]: # Show first two coordinates as sample
                if v.get('lat') and v.get('lng'):
                    print(f"   {v['reg']}: {v['lat']}, {v['lng']} ({v.get('address', 'No address')[:50]}...)")

    except Exception as e:
        print(f"❌ Critical Exception: {str(e)}")
        print("💡 Hint: Ensure 'node manual-login.js' is running on port 3000.")

if __name__ == "__main__":
    asyncio.run(test_blackbuck_fetch())
