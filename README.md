# proxy-balancer

[![package version](https://img.shields.io/npm/v/proxy-balancer.svg?style=flat-square)](https://npmjs.org/package/proxy-balancer)
[![make a pull request](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

> Proxy Load Balancer

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Contribute](#contribute)
- [License](#license)

## Install

```shell script
npm install proxy-balancer
```

## Usage

```js
const Balancer = require('proxy-balancer');
const fetch = require('node-fetch');

const balancer = new Balancer({
  // Time in milli-seconds, until the proxy list will be updated.
  poolExpired: 1 * 60 * 1000,

  // Max concurrent requests at once.
  maxConcurrent: 15,

  // Minimum time between each request in milli-seconds.
  minTime: 100,

  // Time in milli-seconds, before an request is timed out.
  timeout: 2 * 1000,

  // Function to populate proxy list, in this case we use a simple web request using node-fetch.
  // Proxies should be in this format:
  // [ http://0.0.0.0:8080, https://0.0.0.0:8081, sock4://0.0.0.0:8000 ]
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

balancer.request('https://www.cool-proxy.net')
  .then(res => res.text())
  .then(body => console.log(body))

balancer.request('https://www.cool-proxy.net/proxies.json')
  .then(res => res.json())
  .then(json => console.log(json))
```

## License

MIT
