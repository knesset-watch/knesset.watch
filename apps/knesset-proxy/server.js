const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
  const targetUrl = `https://knesset.gov.il${req.url}`;

  const options = {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
    }
  };

  https.get(targetUrl, options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', (err) => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
}).listen(PORT, () => {
  console.log(`Knesset proxy listening on port ${PORT}`);
});
