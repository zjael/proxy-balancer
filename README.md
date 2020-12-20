# proxy-balancer

[![Build status](https://github.com/zjael/proxy-balancer/workflows/Node%20CI/badge.svg)](https://github.com/zjael/proxy-balancer/actions)
[![Package version](https://img.shields.io/npm/v/proxy-balancer.svg)](https://npmjs.org/package/proxy-balancer)
[![NPM downloads](https://img.shields.io/npm/dm/proxy-balancer)](https://npmjs.org/package/proxy-balancer)
[![Make a pull request](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](https://opensource.org/licenses/MIT)

> Proxy Load Balancer

## Table of Contents

- [Install](#install)
- [Usage](#usage)
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
  // Required function to populate proxy list, in this case we use a simple web request using node-fetch.
  // Proxies should be in this format:
  // [ http://0.0.0.0:8080, https://0.0.0.0:8081, socks4://0.0.0.0:8000 ]
  fetchProxies: () => {
    return fetch('https://www.cool-proxy.net/proxies.json')
      .then(res => res.json())
      .then(proxies => {
        return proxies
          .filter(proxy => proxy.working_average > 70)
          .map(proxy => `http://${proxy.ip}:${proxy.port}`)
      })
  },

  /* 
   * * * Optional Configs * * * 
   */

  // Time in milli-seconds, until the proxy list will be updated.
  poolExpired: 1 * 60 * 1000,

  // Max concurrent requests at once. Set to null for infinite
  maxConcurrent: 15,

  // Minimum time between each request in milli-seconds.
  minTime: 100,

  // Time in milli-seconds, to wait for request response.
  timeout: 3 * 1000,

  // Time in milli-seconds, to wait for proxy connection to establish.
  proxyTimeout: 2 * 1000,

  // optionally specify a request adgent of your choosing, default is node-fetch
  requestor: axios,

  // optional agent function to use other proxy agents (i.e. tunnel) 
  // or you can add proxy agent auth settings or 
  // return a unique agent object (supports async/await)
  agentFn: ({ url, timeout }) => new ProxyAgent(url, {
    timeout
  }),

  // optional configs for bottleneck package
  bottleneckOptions: {},

  // optional retry function logic (supports async/await)
  // es6: import Balancer, { retryOptions } from 'proxy-balancer'
  // es5: const retryOptions = Balancer.retryOptions
  retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }) => {
    if (retryCount >= 3) {
      return retryOptions.abort
    }
    if (error.name && (error.name === "FetchError" || error.name === "AbortError")) {
      return retryOptions.retryNextIp
    }
    return retryOptions.abort
  },

  // optional limiter to fine tune timeouts
  callsPerDuration: 5, // required
  duration: 60 * 1000, // required
  postDurationWait: 5 * 60 * 1000, // required
  handleNoAvailableProxies: () => { // optional
    // optionally handle no available proxies, i.e. request more proxies
  }

  // optional proxy formatting function if you're using unique proxy objects
  formatProxy: (proxy) => {
    if (proxy.url) {
      // default will return proxy.url
      return proxy.url
    } else {
      // if you use unique objects, it expects it to resemble a URL object
      // Url is the node-url package https://www.npmjs.com/package/url
      return Url.format(proxy)
    }
  }
});

// Each request will use a fresh proxy, using round robin.
// If a proxy fails or times out, next available proxy in list will be used.
balancer.request('https://www.cool-proxy.net')
  .then(res => res.text())
  .then(body => console.log(body))
  .catch(err => console.error(err))

balancer.request('https://www.cool-proxy.net/proxies.json')
  .then(res => res.json())
  .then(json => console.log(json))
  .catch(err => console.error(err))
```

## License

MIT
