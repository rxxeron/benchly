const UPSTREAM = 'https://benchly-api-ewu.azurewebsites.net';

const HEALTH_REDIRECT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="refresh" content="3;url=https://benchly.live" />
  <title>Benchly API — Healthy</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff9f0;color:#1e1b18;font-family:system-ui,-apple-system,sans-serif}
    .card{background:#fff;border:2px solid #1e1b18;border-radius:18px;padding:28px 34px;box-shadow:5px 5px 0 #1e1b18;text-align:center}
    .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:#dcfce7;border:1.5px solid #1e1b18;color:#047857;font-weight:700;font-size:14px}
    .dot{width:9px;height:9px;border-radius:50%;background:#0fb881}
    p{margin:14px 0 0;font-size:13.5px;color:#575049}
    a{color:#0fb881;font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="pill"><span class="dot"></span> Healthy</div>
    <p>Redirecting to <a href="https://benchly.live">benchly.live</a> in <span id="t">3</span>s…</p>
  </div>
  <script>
    let s=3;
    const el=document.getElementById('t');
    const iv=setInterval(()=>{s--;if(el&&s>=0)el.textContent=s;if(s<=0){clearInterval(iv);location.replace('https://benchly.live');}},1000);
  </script>
</body>
</html>`;

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);

    // Root path: show Healthy status & redirect to benchly.live in 3 seconds (hides Express fingerprint)
    if (incomingUrl.pathname === '/' || incomingUrl.pathname === '') {
      const accept = request.headers.get('accept') || '';
      if (accept.includes('application/json') && !accept.includes('text/html')) {
        return new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
        });
      }
      return new Response(HEALTH_REDIRECT_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, UPSTREAM);
    const headers = new Headers(request.headers);
    headers.set('host', new URL(UPSTREAM).host);
    headers.set('x-forwarded-host', incomingUrl.host);
    headers.set('x-forwarded-proto', 'https');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    return fetch(targetUrl.toString(), init);
  }
};
