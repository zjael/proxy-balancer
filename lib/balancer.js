const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const fetch = require('node-fetch');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const defaultConfig = {
  poolExpired: 1 * 60 * 1000,
  proxyFn: () => [],
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000,
  requestor: fetch,
  bottleneckOptions: {}
}

class Balancer {
  constructor(config) {
    this.lastUpdate;
    this.proxies = [];
    this.next = 0;
    this.config = Object.assign({}, defaultConfig, config);
    this.limiter = new Bottleneck({
      ...this.config.bottleneckOptions,
      // if null will default to infinity in bottleneck
      maxConcurrent: this.config.maxConcurrent,
      minTime: this.config.minTime
    });
    this.fetching = false;
    this.requestor = this.config.requestor
  }

  async getProxies() {
    if (this.fetching) {
      if (this.proxies.length > 0) {
        return this.proxies;
      }
      await delay(200);
      return this.getProxies();
    }

    if (!this.lastUpdate || this.proxies.length === 0 || Date.now() > this.lastUpdate + this.config.poolExpired) {
      this.fetching = true;
      try {
        const proxies = await this.config.proxyFn();
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

  async handleRequest(url, options, timeout = this.config.timeout / 1000) {
    try {
      const next = await this.getNext();
      const agent = new ProxyAgent(next, {
        timeout: this.config.proxyTimeout
      });
      const res = await this.limiter.schedule(() => {
        return this.request(url, {
          agent: agent,
          ...options
        }, timeout)
      })
      return res;
    } catch (err) {
      // Retry if proxy error
      if (err.name && (err.name === "FetchError" || err.name === "AbortError")) {
        return this.handleRequest(url, options, timeout);
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

  async request(url, options, timeout = 5) {
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
