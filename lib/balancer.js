const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const fetch = require('node-fetch');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const defaultOptions = {
  poolExpired: 1 * 60 * 1000,
  proxyFn: () => [],
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000
}

class Balancer {
  constructor(options) {
    this.lastUpdate;
    this.proxies = [];
    this.next = 0;
    this.options = Object.assign({}, defaultOptions, options);
    this.limiter = new Bottleneck({
      maxConcurrent: options.maxConcurrent || defaultOptions.maxConcurrent,
      minTime: options.minTime || defaultOptions.minTime
    });
    this.fetching = false;
    this.requestor = fetch
  }

  async getProxies() {
    if (this.fetching) {
      if (this.proxies.length > 0) {
        return this.proxies;
      }
      await delay(200);
      return this.getProxies();
    }

    if (!this.lastUpdate || this.proxies.length === 0 || Date.now() > this.lastUpdate + this.options.poolExpired) {
      this.fetching = true;
      try {
        const proxies = await this.options.proxyFn();
        this.proxies = proxies || [];
      } catch (err) {
        this.proxies = [];
        throw err;
      } finally {
        this.lastUpdate = Date.now();
        this.fetching = false;
      }
    }

    return this.proxies;
  }

  async request(url, options, timeout = this.options.timeout / 1000) {
    try {
      const next = await this.getNext();
      const agent = new ProxyAgent(next, {
        timeout: this.options.proxyTimeout
      });
      const res = await this.limiter.schedule(() => {
        return fetch(url, {
          agent: agent,
          ...options
        }, timeout)
      })
      return res;
    } catch (err) {
      // Retry if proxy error
      if (err.name && (err.name === "FetchError" || err.name === "AbortError")) {
        return this.request(url, options, timeout);
      }
      throw err;
    }
  }

  async getNext() {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error("Empty proxy list");
    }
    const proxy = proxies[this.next];
    if (proxy) {
      this.next = this.next + 1;
      return proxy;
    }
    this.next = 0;
    return proxies[0];
  }

  async fetch(url, options, timeout = 5) {
    try {
      const res = await this.requestor(url, {
        ...options,
        timeout: timeout * 1000
      })
      if (!res.ok) {
        throw new Error('Invalid Response');
      }
      return res;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = Balancer
