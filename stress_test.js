const fetch = require('node-fetch');
const Balancer = require('./lib/balancer.js');

const balancer = new Balancer({
  poolExpired: 1 * 60 * 1000,
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000,
  proxyFn() {
    return fetch('https://www.cool-proxy.net/proxies.json')
      .then(res => res.json())
      .then(proxies => {
        return proxies
          .filter(proxy => proxy.working_average > 70)
          .map(proxy => `http://${proxy.ip}:${proxy.port}`)
      })
  }
});

let promises = [];
for (let i = 0; i < 100; i++) {
  promises.push(balancer.request('https://ipv4.icanhazip.com')
    .then(res => res.text())
    .then(body => {
      body = body.trim();
      console.log(`completed: ${i}, ip: ${body}`);
      return body;
    })
    .catch(err => {
      console.error(err)
    })
  );
}

Promise.all(promises).then(result => {
  console.log(result);
})