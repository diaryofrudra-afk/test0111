#!/bin/bash
# ═══════════════════════════════════════════════
#  Test the proxy endpoint (run while server.js is running)
# ═══════════════════════════════════════════════

echo ""
echo "═══ Testing Blackbuck Proxy ═══"
echo ""

# Health check
echo "1. Health check…"
HEALTH=$(curl -s http://localhost:3000/api/health 2>&1)
if echo "$HEALTH" | grep -q "running"; then
    echo "   ✅ Server is running"
    echo "   $HEALTH" | python3 -m json.tool 2>/dev/null || echo "   $HEALTH"
else
    echo "   ❌ Server not responding. Is it running? (npm start)"
    exit 1
fi
echo ""

# Fetch vehicles
echo "2. Fetching vehicles from Blackbuck…"
echo "   (This may take 15-30 seconds on first fetch)"
echo ""

RESPONSE=$(curl -s --max-time 60 http://localhost:3000/api/fetch-blackbuck 2>&1)

if echo "$RESPONSE" | grep -q '"success":true'; then
    COUNT=$(echo "$RESPONSE" | grep -o '"vehicles":\[' | wc -l)
    echo "   ✅ SUCCESS!"
    echo ""
    echo "   Response (first 500 chars):"
    echo "   ${RESPONSE:0:500}"
    echo ""
    
    # Pretty print if python available
    echo "   Full response:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    
    echo ""
    echo "═══════════════════════════════════════════════"
    echo "✅ Proxy is working! Open your Suprwise dashboard"
    echo "   and click 'Sync Telemetry' on the GPS page."
    echo "═══════════════════════════════════════════════"
else
    echo "   ❌ Fetch failed"
    echo "   Response: $RESPONSE"
    echo ""
    echo "   Troubleshooting:"
    echo "   1. Check the server terminal for error details"
    echo "   2. Look for debug-login.png or debug-dashboard.png"
    echo "   3. Try HEADLESS=false to see the browser"
    echo "   4. Verify credentials: login manually at fleet.blackbuck.com"
fi
echo ""
