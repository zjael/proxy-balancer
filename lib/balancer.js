const request = require('./request.js');
const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const utils = require('./utils.js');

const defaultOptions = {
  poolExpired: 1 * 60 * 1000,
  proxyFn: () => [],
  maxConcurrent: 15,
  minTime: 100,
  timeout: 2 * 1000
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
  }

  async getProxies() {
    if(this.fetching) {
      if(this.proxies.length > 0) {
        return this.proxies;
      }
      await utils.delay(200);
      return this.getProxies();
    }

    if(!this.lastUpdate || this.proxies.length === 0 || Date.now() > this.lastUpdate + this.options.poolExpired) {
      this.fetching = true;
      const proxies = await this.options.proxyFn();
      this.proxies = proxies || [];
      this.lastUpdate = Date.now();
      this.fetching = false;
    }

    return this.proxies;
  }

  async request(url, options, timeout = this.options.timeout / 1000) {
    try {
      const next = await this.getNext();
      const agent = new ProxyAgent(next);
      const res = await this.limiter.schedule(() => {
        return request(url, {
          agent: agent,
          ...options
        }, timeout)
      })
      return res;
    } catch (err) {
      // Retry if proxy error
      return this.request(url, options, timeout);
    }
  }

  async getNext() {
    const proxies = await this.getProxies();
    if(proxies.length === 0) {
      throw new Error("Empty proxy list");
    }
    const proxy = proxies[this.next];
    if(proxy) {
      this.next = this.next + 1;
      return proxy;
    }
    this.next = 0;
    return proxies[0];
  }
}

module.exports = Balancer