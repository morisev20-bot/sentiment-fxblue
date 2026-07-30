export default async (req, context) => {
  try {
    const url = "https://www.fxblue.com/";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    const html = await res.text();

    // Cerca il JSON di Next.js
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    let dataStr = match? match[1] : "";

    let retail = {};

    if (dataStr) {
      try {
        const json = JSON.parse(dataStr);
        const fullStr = JSON.stringify(json);
        // Cerca pattern tipo XAUUSD + long/short percent
        const symbols = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "XAGUSD"];
        for (const sym of symbols) {
           const re = new RegExp(sym + `[^\\d]{0,100}(\\d{1,2}\\.?\\d?)%[^\\d]{0,30}(\\d{1,2}\\.?\\d?)%`, "i");
           const m = fullStr.match(re);
           if (m) {
             retail[sym] = { long: parseFloat(m[1]), short: parseFloat(m[2]) };
           }
        }
        // Fallback: cerca struttura sentiment
        if (Object.keys(retail).length === 0) {
           // cerca tutti i numeri vicini a longShort
           const hits = [...fullStr.matchAll(/"symbol":"([A-Z]{6,10})".*?"long":(\d+\.?\d*).*?"short":(\d+\.?\d*)/gi)];
           for (const h of hits) {
             retail[h[1]] = { long: parseFloat(h[2]), short: parseFloat(h[3]) };
           }
        }
      } catch(e){}
    }

    // Se ancora vuoto, prova scraping vecchio HTML per compatibilità
    if (Object.keys(retail).length === 0) {
        const symRe = /XAUUSD|GOLD/gi;
        if (html.includes("XAU")) {
           // prova a estrarre percentuali dalla tabella sentiment
           const perc = [...html.matchAll(/(\d{1,2}\.?\d*)\s*%\s*<\/[^>]*>\s*[^<]*\s*(\d{1,2}\.?\d*)\s*%/gi)];
           if (perc[0]) retail["XAUUSD"] = { long: parseFloat(perc[0][1]), short: parseFloat(perc[0][2]) };
        }
    }

    // SE ANCORA FALLISCE, usa fallback Myfxbook-style o demo LIVE ma con timestamp
    if (Object.keys(retail).length === 0) {
        // Ultimo tentativo: fetch diretto API non ufficiale FXBlue labs
        try {
          const apiRes = await fetch("https://www.fxblue.com/labs/api/sentiment", { headers: {"User-Agent":"Mozilla/5.0"}});
          if (apiRes.ok) {
            const apiJson = await apiRes.json();
            retail = apiJson;
          }
        } catch(e){}
    }

    if (Object.keys(retail).length === 0) {
        return new Response(JSON.stringify({
            error: "FXBlue markup ancora cambiato - mando fallback temporaneo",
            hint: "Controlla __NEXT_DATA__",
            retail: { "XAUUSD": { long: 58.2, short: 41.8, source: "fallback" } },
            debug_html_len: html.length,
            snippet: html.substring(0, 800),
            timestamp: new Date().toISOString()
        }), { status: 200, headers: {"Access-Control-Allow-Origin":"*","Content-Type":"application/json"} });
    }

    return new Response(JSON.stringify({
        timestamp: new Date().toISOString(),
        retail: retail,
        source: "fxblue.com"
    }), { headers: {"Access-Control-Allow-Origin":"*","Content-Type":"application/json"} });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: {"Access-Control-Allow-Origin":"*"} });
  }
}
