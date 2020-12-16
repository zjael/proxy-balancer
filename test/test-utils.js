const http = require('http');

function onRequest(req, res) {
  const options = {
    method: req.method,
    headers: req.headers
  };

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  const data = http.request(req.url, options, (response) => {
    response.setEncoding('utf8');
    res.writeHead(response.statusCode, response.headers);

    response.on('data', (chunk) => {
      res.write(chunk);
    });
    response.on('close', () => {
      res.end();
    });
    response.on('end', () => {
      res.end();
    });
  }).on('error', (err) => {
    res.writeHead(500);
    res.end();
  });

  req.on('end', () => {
    data.write(body);
    data.end();
  })
}

function createProxyServer() {
  return http.createServer(onRequest);
}

module.exports = {
  createProxyServer
}