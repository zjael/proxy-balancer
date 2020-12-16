const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const fetch = require('node-fetch');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function formatProxy(proxy) {
  if (typeof proxy === 'string') {
    return { url: proxy }
  } else if (typeof proxy === 'object') {
    // should have url or hostname
    return proxy
  } else {
    return {}
  }
}

const defaultConfig = {
  poolExpired: 1 * 60 * 1000,
  fetchProxies: () => [],
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000,
  requestor: fetch,
  agentFn: ({ proxy, timeout }) => new ProxyAgent(proxy.url, {
    timeout
  }),
  bottleneckOptions: {}
}

class Balancer {
  constructor(config) {
    this.lastUpdate;
    this.proxies = [];
    this.next = 0;
    this.config = Object.assign({}, defaultConfig, config);
    this.callstackLimiter = new Bottleneck({
      ...this.config.bottleneckOptions,
      // if null will default to infinity in bottleneck
      maxConcurrent: this.config.maxConcurrent,
      minTime: this.config.minTime
    });
    this.fetchingProxies = false;
    this.requestor = this.config.requestor
    this.isNodeFetch = this.requestor === fetch
    this.agentFn = this.config.agentFn
  }

  // gets and refreshes when applicable
  async getProxies(forceRefresh = false) {
    if (this.fetchingProxies) {
      if (this.proxies.length > 0) {
        return this.proxies;
      }
      await delay(200);
      return this.getProxies();
    }

    if (forceRefresh || !this.lastUpdate || this.proxies.length === 0 || Date.now() > this.lastUpdate + this.config.poolExpired) {
      this.fetchingProxies = true;
      try {
        const proxies = await this.config.fetchProxies();
        if (!Array.isArray(proxies)) {
          throw new Error('Proxies must be an array')
        }
        const formattedProxies = proxies.map(formatProxy)
        this.proxies = formattedProxies || [];
      } catch (err) {
        this.proxies = [];
        throw err;
      } finally {
        this.lastUpdate = Date.now();
        this.fetchingProxies = false;
      }
    }

    return this.proxies;
  }

  async request(url, options, timeout = this.config.timeout / 1000) {
    try {
      const next = await this.getNext();
      if (typeof this.agentFn !== 'function') throw new Error('agentFn must be a function')
      const agent = this.agentFn({
        proxy: next,
        timeout: this.config.proxyTimeout
      });
      const res = await this.callstackLimiter.schedule(() => {
        return this.fetch(url, {
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
      if (this.isNodeFetch && !res.ok) {
        throw new Error('Invalid Response');
      }
      return res;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = Balancer
