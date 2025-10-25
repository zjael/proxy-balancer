import http from 'node:http';

function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const options: http.RequestOptions = {
    method: req.method,
    headers: req.headers,
  };

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  const data = http
    .request(req.url!, options, (response) => {
      response.setEncoding('utf8');
      res.writeHead(response.statusCode!, response.headers);

      response.on('data', (chunk) => {
        res.write(chunk);
      });
      response.on('close', () => {
        res.end();
      });
      response.on('end', () => {
        res.end();
      });
    })
    .on('error', () => {
      res.writeHead(500);
      res.end();
    });

  req.on('end', () => {
    data.write(body);
    data.end();
  });
}

export function createProxyServer(): http.Server {
  return http.createServer(onRequest);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
