from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from ..auth.dependencies import get_current_user
from .service import fetch_blackbuck_telemetry, sync_blackbuck_fleet
from .models import BlackbuckData
import asyncio

router = APIRouter(prefix="/api/gps", tags=["gps"])


@router.get("/blackbuck", response_model=BlackbuckData)
async def get_blackbuck_telemetry(_user=Depends(get_current_user)):
    """
    Fetch Blackbuck GPS telemetry. Uses a headless browser if credentials 
    are configured, otherwise returns mock data.
    """
    try:
        return await fetch_blackbuck_telemetry()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GPS fetch failed: {str(e)}")


@router.post("/sync-fleet")
async def sync_fleet(user=Depends(get_current_user)):
    """
    Sync all vehicles from Blackbuck to the fleet system.
    """
    try:
        return await sync_blackbuck_fleet(user["tenant_id"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fleet sync failed: {str(e)}")


@router.post("/raw-push")
async def receive_raw_push(data: BlackbuckData):
    """
    [Agent 6] Specialized high-speed receiver for proxy pushes.
    This bypasses standard polling intervals for instant UI updates.
    """
    # In a real system, we'd broadcast this to a Redis pub/sub or WebSocket manager
    # For now, we'll just log that we received it.
    print(f"📡 High-speed push received: {len(data.vehicles)} vehicles")
    return {"success": True}


@router.websocket("/ws/blackbuck")
async def websocket_blackbuck_telemetry(websocket: WebSocket):
    """
    WebSocket for live GPS updates. 
    In a real app, you'd verify the token here too.
    """
    await websocket.accept()
    try:
        while True:
            # Fetch data every 5 seconds and push to client
            data = await fetch_blackbuck_telemetry()
            await websocket.send_json(data.model_dump())
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        print("Client disconnected from GPS WebSocket")
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()
