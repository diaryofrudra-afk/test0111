from __future__ import annotations

import httpx
import json
from datetime import datetime
from typing import List

from ..config import settings
from .models import BlackbuckData, BlackbuckVehicle

import uuid
from ..database import get_db

async def fetch_blackbuck_telemetry() -> BlackbuckData:
    """
    Fetch live telemetry from the local Blackbuck Proxy server.
    The proxy handles Puppeteer login and API interception.
    """
    PROXY_URL = "http://localhost:3000/api/fetch-blackbuck"
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(PROXY_URL)
            if response.status_code != 200:
                return BlackbuckData(error=f"Proxy error: HTTP {response.status_code}")
            
            data = response.json()
            if not data.get("success"):
                return BlackbuckData(error=f"Proxy failed: {data.get('error', 'Unknown error')}")
            
            proxy_vehicles = data.get("vehicles", [])
            vehicles = []
            
            for v in proxy_vehicles:
                # Map proxy fields to our model
                ignition = v.get("ignition", "OFF")
                speed = float(v.get("speed") or 0.0)
                
                # Determine status string
                status = "stopped"
                if ignition == "ON":
                    status = "moving" if speed > 0 else "idling"
                
                vehicles.append(
                    BlackbuckVehicle(
                        registration_number=v.get("reg", "UNKNOWN"),
                        status=status,
                        ignition=ignition,
                        latitude=v.get("lat") or 0.0,
                        longitude=v.get("lng") or 0.0,
                        speed=speed,
                        odometer=v.get("odometer"),
                        battery=v.get("battery"),
                        address=v.get("address"),
                        last_updated=v.get("lastUpdate") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    )
                )
            
            return BlackbuckData(vehicles=vehicles)
            
    except Exception as e:
        print(f"Fetch error: {e}")
        return BlackbuckData(error=f"Connection to proxy failed: {str(e)}")

async def sync_blackbuck_fleet(tenant_id: str) -> dict:
    """
    Fetch from proxy and ensure all vehicles exist in the system.
    """
    data = await fetch_blackbuck_telemetry()
    if data.error:
        return {"success": False, "error": data.error}
    
    db = await get_db()
    synced_count = 0
    
    for v in data.vehicles:
        reg = v.registration_number
        
        # 1. Ensure vehicle exists in 'cranes' table
        cursor = await db.execute(
            "SELECT id FROM cranes WHERE reg = ? AND tenant_id = ?",
            (reg, tenant_id)
        )
        row = await cursor.fetchone()
        
        if not row:
            # Create new asset if missing
            crane_id = str(uuid.uuid4())
            await db.execute(
                """INSERT INTO cranes (id, reg, type, tenant_id, status) 
                   VALUES (?, ?, ?, ?, ?)""",
                (crane_id, reg, "Truck", tenant_id, v.status)
            )
        else:
            # Update existing status
            await db.execute(
                "UPDATE cranes SET status = ? WHERE reg = ? AND tenant_id = ?",
                (v.status, reg, tenant_id)
            )
            
        # 2. Update diagnostics with latest snapshot
        snapshot = {
            "latitude": v.latitude,
            "longitude": v.longitude,
            "speed": v.speed,
            "ignition": v.ignition,
            "odometer": v.odometer,
            "battery": v.battery,
            "address": v.address,
            "last_updated": v.last_updated
        }
        
        await db.execute(
            """INSERT INTO diagnostics (id, crane_reg, health, snapshot, tenant_id, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(crane_reg, tenant_id) DO UPDATE SET
               health = excluded.health,
               snapshot = excluded.snapshot,
               updated_at = excluded.updated_at""",
            (str(uuid.uuid4()), reg, v.status, json.dumps(snapshot), tenant_id)
        )
        
        synced_count += 1
    
    await db.commit()
    
    return {
        "success": True, 
        "count": synced_count,
        "message": f"Successfully synced {synced_count} vehicles from Blackbuck"
    }
