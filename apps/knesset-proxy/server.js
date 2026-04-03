const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
const TARGET = 'https://knesset.gov.il';

const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
};

function proxyRequest(targetUrl, res, depth) {
  if (depth > 5) {
    res.writeHead(508);
    res.end(JSON.stringify({ error: 'Too many redirects' }));
    return;
  }

  https.get(targetUrl, { headers: HEADERS }, (proxyRes) => {
    const { statusCode, headers } = proxyRes;

    // Follow redirects internally so callers always get a final 2xx/4xx/5xx
    if (statusCode >= 300 && statusCode < 400 && headers.location) {
      const next = headers.location.startsWith('http')
        ? headers.location
        : TARGET + headers.location;
      proxyRes.resume(); // drain and discard
      proxyRequest(next, res, depth + 1);
      return;
    }

    res.writeHead(statusCode, {
      'Content-Type': headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', (err) => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
}

http.createServer((req, res) => {
  proxyRequest(TARGET + req.url, res, 0);
}).listen(PORT, () => {
  console.log(`Knesset proxy listening on port ${PORT}`);
});
