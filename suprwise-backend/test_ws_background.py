import asyncio
import json
import websockets
import logging
import httpx
import time

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("WS-Test")

BLACKBUCK_WS_URL = "wss://api-fms.blackbuck.com/fmsiot/ws/gps"
# Using a public echo server for the second client to prove concurrency works
SECOND_CLIENT_WS_URL = "wss://ws.postman-echo.com/raw" 

async def fetch_blackbuck_token():
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://localhost:3000/api/debug/token")
            resp.raise_for_status()
            data = resp.json()
            return data.get("token")
    except Exception as e:
        logger.error(f"Failed to fetch blackbuck token: {e}")
        return None

async def blackbuck_client():
    uri = BLACKBUCK_WS_URL
    while True:
        token = await fetch_blackbuck_token()
        if not token:
            logger.warning("No Blackbuck token found. Retrying in 5s...")
            await asyncio.sleep(5)
            continue
            
        headers = {
            "Authorization": token
        }
        
        try:
            logger.info(f"Connecting to Blackbuck WS: {uri} with token {token[:15]}...")
            # We use ping_interval=None to see if it receives anything without keeping alive directly, 
            # but usually websockets handle standard pings.
            async with websockets.connect(uri, extra_headers=headers, ping_interval=20, ping_timeout=20) as websocket:
                logger.info("✅ Connected to Blackbuck WebSocket!")
                while True:
                    message = await websocket.recv()
                    logger.info(f"[Blackbuck] Received data: {message[:100]}")
        except websockets.exceptions.ConnectionClosed as e:
            logger.error(f"Blackbuck connection closed: {e}. Reconnecting in 5s...")
        except Exception as e:
            logger.error(f"Blackbuck connection error: {e}. Reconnecting in 5s...")
            
        await asyncio.sleep(5)

async def secondary_client():
    uri = SECOND_CLIENT_WS_URL
    while True:
        try:
            logger.info(f"Connecting to Secondary WS Client (Echo): {uri}")
            async with websockets.connect(uri) as websocket:
                logger.info("✅ Connected to Secondary WebSocket!")
                
                # Send a ping message every 5 seconds to test
                count = 1
                while True:
                    await websocket.send(f"Ping {count}")
                    message = await websocket.recv()
                    logger.info(f"[Secondary] Received data: {message}")
                    count += 1
                    await asyncio.sleep(5)
        except websockets.exceptions.ConnectionClosed as e:
            logger.error(f"Secondary connection closed: {e}. Reconnecting in 5s...")
        except Exception as e:
            logger.error(f"Secondary connection error: {e}. Reconnecting in 5s...")
            
        await asyncio.sleep(5)

async def main():
    logger.info("Starting concurrent WebSocket background service test...")
    await asyncio.gather(
        blackbuck_client(),
        secondary_client()
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Test stopped by user")
