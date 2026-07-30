export default async (req, context) => {
  const headersUA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/json,*/*"
  };

  const urlsToTry = [
    "https://www.fxblue.com/market-data/tools/sentiment",
    "https://www.fxblue.com/tools/sentiment",
    "https://www.fxblue.com/labs/sentiment",
    "https://www.fxblue.com/"
  ];

  let htmlAll = "";
  let retail = {};

  for (const u of urlsToTry) {
    try {
      const r = await fetch(u, { headers: headersUA });
      const t = await r.text();
      htmlAll = t;

      // 1. Prova __NEXT_DATA__
      const m = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        try {
          const j = JSON.parse(m[1]);
          const str = JSON.stringify(j);
          // Cerca struttura sentiment dentro
          const regex = /"symbol"\s*:\s*"([A-Z]{3,10})"[^}]{0,200}"(?:long|buyers|longPercent)"\s*:\s*(\d+\.?\d*)/gi;
          let mm;
          while ((mm = regex.exec(str))!== null) {
            const sym = mm[1].replace("/", "");
            const long = parseFloat(mm[2]);
            if (long > 0 && long < 100) {
              retail[sym] = { long: long, short: 100-long };
            }
          }
          // Pattern specifico XAU
          if (Object.keys(retail).length > 0) break;
        } catch(e){}
      }

      // 2. Cerca direttamente nel HTML le percentuali vicino a XAUUSD
      const xauMatch = t.match(/XAUUSD[^%]{0,200}(\d{1,2}\.?\d*)\s*%\s*[^%]{0,200}(\d{1,2}\.?\d*)\s*%/is);
      if (xauMatch) {
        retail["XAUUSD"] = { long: parseFloat(xauMatch[1]), short: parseFloat(xauMatch[2]) };
        break;
      }

    } catch(e){}
  }

  // FALLBACK FINALE: Myfxbook Community Outlook (stabile)
  if (Object.keys(retail).length === 0) {
    try {
      const mf = await fetch("https://www.myfxbook.com/community/outlook", { headers: headersUA });
      const mfHtml = await mf.text();
      const xau = mfHtml.match(/XAUUSD[^%]{0,300}long[^0-9]{0,10}(\d{1,2})%[^0-9]{0,10}short[^0-9]{0,10}(\d{1,2})%/is) ||
                  mfHtml.match(/GOLD[^%]{0,300}(\d{1,2})%\s*\|\s*(\d{1,2})%/i);
      if (xau) {
        retail["XAUUSD"] = { long: parseFloat(xau[1]), short: parseFloat(xau[2]), source: "myfxbook-fallback" };
      }
    } catch(e){}
  }

  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    retail: retail,
    debug_len: htmlAll.length,
    source: Object.keys(retail).length? "live" : "fallback",
    note: Object.keys(retail).length? "ok" : "fxblue markup changed, used fallback logic"
  }), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    }
  });
}
