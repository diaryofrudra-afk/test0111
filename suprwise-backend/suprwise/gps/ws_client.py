import asyncio
import json
import logging
import httpx
import websockets
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("GPS-Workers")

BLACKBUCK_API_URL = "http://localhost:3000/api/fetch-blackbuck"

TRAKNTELL_WS_URL = "wss://ws.postman-echo.com/raw" 
# Example replacing trakntell with dummy echo for testing until user provides real endpoint
TRAKNTELL_COOKIE = "your_trakntell_cookie_here"

async def blackbuck_http_poller():
    """
    Continuous async HTTP polling loop for Blackbuck.
    Uses the local Node proxy to fetch the data securely to bypass the WAF.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            try:
                # Polling the local proxy which handles the actual WAF bypass and session persistence
                response = await client.get(BLACKBUCK_API_URL)
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get("success"):
                        vehicles = data.get("vehicles", [])
                        num_moving = sum(1 for v in vehicles if v.get("speed", 0) > 0)
                        logger.info(f"[Blackbuck API] Successfully fetched {len(vehicles)} vehicles. {num_moving} moving.")
                    else:
                        logger.warning(f"[Blackbuck API] Proxy returned error: {data.get('error')}")
                else:
                    logger.error(f"[Blackbuck API] Returned status {response.status_code}")
                
            except httpx.RequestError as e:
                logger.error(f"Blackbuck network error: {e}")
            except Exception as e:
                logger.error(f"Blackbuck unexpected error: {e}")
            
            # Poll every 1 second as specified
            await asyncio.sleep(1)

async def trakntell_client():
    """
    WebSocket client for the secondary service (e.g. Trak N Tell).
    """
    uri = TRAKNTELL_WS_URL
    
    while True:
        try:
            logger.info(f"Connecting to Secondary WebSocket: {uri}")
            async with websockets.connect(uri) as websocket:
                logger.info("Connected to Secondary WebSocket")
                
                # Example: Sending keep-alive / receiving event data
                count = 1
                while True:
                    await websocket.send(f"Keep-alive {count}")
                    message = await websocket.recv()
                    logger.info(f"[Secondary WS] Received: {message}")
                    count += 1
                    
                    # Wait for next streaming interval
                    await asyncio.sleep(5)
                    
        except websockets.exceptions.ConnectionClosed as e:
            logger.error(f"Secondary connection closed: {e}. Reconnecting in 5s...")
        except Exception as e:
            logger.error(f"Secondary connection error: {e}. Reconnecting in 5s...")
            
        await asyncio.sleep(5)

async def main():
    """
    Run the Blackbuck HTTP poller and the secondary WebSocket client concurrently.
    """
    logger.info("Starting concurrent background GPS data services...")
    await asyncio.gather(
        blackbuck_http_poller(),
        trakntell_client()
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Service stopped by user")
