const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const fetch = require('node-fetch');
const { RateLimiterMemory } = require('rate-limiter-flexible')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const defaultConfig = {
  poolExpired: 1 * 60 * 1000,
  fetchProxies: () => [],
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000,
  requestor: fetch,
  agentFn: ({ url, timeout }) => new ProxyAgent(url, {
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
    // sets ipLimiter if callsPerDuration, duration, and postDurationWait
    this.ipLimiter = (config.callsPerDuration && config.duration && config.postDurationWait) && new RateLimiterMemory({ points: config.callsPerDuration, duration: config.duration });
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
        this.proxies = proxies || [];
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
      const nextUrl = await this.getNext();
      if (typeof this.agentFn !== 'function') throw new Error('agentFn must be a function')
      const agent = this.agentFn({
        url: nextUrl,
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

  setNextProxy(proxies) {
    if (this.ipLimiter) {
      // find next available in line
      const nextProxyAvailable = proxies.splice(this.next, proxies.length).findIndex(ip => {
        const limit = this.ipLimiter.get(ip)
        if (limit && limit.remainingPoints > 0) {
          if (limit.remainingPoints) this.ipLimiter.block(ip, this.config.postDurationWait)
          return true
        }
      })
      if (nextProxyAvailable > -1) {
        this.next = nextProxyAvailable
      } else {
        // find next available starting from begining
        const previousProxyAvailable = proxies.splice(0, this.next).findIndex(ip => {
          const limit = this.ipLimiter.get(ip)
          if (limit && limit.remainingPoints > 0) {
            if (limit.remainingPoints) this.ipLimiter.block(ip, this.config.postDurationWait)
            return true
          }
        })
        if (previousProxyAvailable > -1) {
          this.next = previousProxyAvailable
        } else {
          // no proxies available!
          throw new Error('No more proxies available.')
        }
      }
    } else {
      this.next = this.next + 1;
    }
  }

  async getNext() {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error("Empty proxy list");
    }
    const proxy = proxies[this.next];
    if (proxy) {
      this.setNextProxy(proxies)
      return proxy;
    }

    // begin again
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
