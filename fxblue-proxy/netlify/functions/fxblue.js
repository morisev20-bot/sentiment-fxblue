// netlify/functions/fxblue.js
// Node 18 native fetch - bypass Cloudflare via server-side request
// Returns: {symbol:"XAUUSD", long:63.5, short:36.5, source:"FXBlue", timestamp:"..."}

exports.handler = async (event, context) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const TARGET = "https://www.fxblue.com/market-data/tools/sentiment";
  const start = Date.now();

  try {
    const res = await fetch(TARGET, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.fxblue.com/",
        "Cache-Control": "no-cache"
      },
      // @ts-ignore - Node 18 supports this via undici
      redirect: "follow"
    });

    if (!res.ok) throw new Error(`FXBlue HTTP ${res.status}`);

    const html = await res.text();
    
    let longPct = null;
    let method = "none";

    // ---- PATTERN 1: Look for XAUUSD/GOLD row with % near "long" ----
    // Handles: <tr><td>XAUUSD</td><td>63.5% long</td> or XAUUSD 63.5% ... Long
    // We search 500 chars window after XAUUSD mention
    const upper = html.toUpperCase();
    const keywords = ["XAUUSD", "GOLD", "XAU/USD"];
    
    for (const kw of keywords) {
      const idx = upper.indexOf(kw);
      if (idx === -1) continue;
      const window = html.slice(idx, idx + 800);
      // Pattern 1a: 63.5% ... long
      let m = window.match(/(\d{1,2}(?:\.\d+)?)\s*%[^<]{0,60}?long/i) || 
              window.match(/long[^\d]{0,30}?(\d{1,2}(?:\.\d+)?)\s*%/i);
      if (m) {
        longPct = parseFloat(m[1]);
        if (longPct >= 0 && longPct <= 100) { method = `kw:${kw}_p1_window`; break; }
      }
    }

    // ---- PATTERN 2 (FALLBACK): Global table scan for XAUUSD row ----
    // Scans for XAUUSD followed anywhere within 200 chars by a percentage
    if (longPct === null) {
      // e.g. XAUUSD ... data-long="63.5" or >63.5%<
      const p2a = html.match(/XAUUSD[\s\S]{0,200}?(\d{1,2}(?:\.\d+)?)\s*%/i);
      const p2b = html.match(/GOLD[\s\S]{0,200}?(\d{1,2}(?:\.\d+)?)\s*%\s*long/i);
      const p2c = html.match(/data-long=["'](\d+(?:\.\d+)?)["'][^>]*>\s*XAU/i);
      const m = p2a || p2b || p2c;
      if (m) {
        longPct = parseFloat(m[1]);
        method = "fallback_global";
      }
    }

    // ---- PATTERN 3: JSON-LD / script embedded data ----
    if (longPct === null) {
      const jsonMatch = html.match(/"symbol"\s*:\s*"XAUUSD"[^}]*"long"\s*:\s*(\d+(?:\.\d+)?)/i) ||
                        html.match(/XAUUSD[\s\S]{0,300}?"longPct"\s*:\s*(\d+(?:\.\d+)?)/i);
      if (jsonMatch) {
        longPct = parseFloat(jsonMatch[1]);
        method = "fallback_json";
      }
    }

    // Final fallback - if parsing fails, return error with debug hint
    if (longPct === null || isNaN(longPct)) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          error: "XAUUSD not parsed",
          hint: "FXBlue changed markup - check html snippet",
          debug_html_len: html.length,
          snippet: html.slice(0, 1000),
          timestamp: new Date().toISOString()
        })
      };
    }

    // Clamp
    longPct = Math.max(0, Math.min(100, longPct));
    const shortPct = +(100 - longPct).toFixed(1);

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        "Cache-Control": "public, max-age=0, s-maxage=120",
        "X-Parse-Method": method,
        "X-Fetch-Ms": String(Date.now() - start)
      },
      body: JSON.stringify({
        symbol: "XAUUSD",
        long: +longPct.toFixed(1),
        short: shortPct,
        source: "FXBlue",
        method,
        timestamp: new Date().toISOString()
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "fetch_failed",
        message: err.message,
        symbol: "XAUUSD",
        long: null,
        short: null,
        source: "FXBlue",
        timestamp: new Date().toISOString()
      })
    };
  }
};
