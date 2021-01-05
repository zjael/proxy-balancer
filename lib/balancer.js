const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const fetch = require('node-fetch');
const Url = require('url')
const { RateLimiterMemory } = require('rate-limiter-flexible')

class ResponseError extends Error {
  constructor(message = "", response) {
    super(message, response);
    this.name = "ResponseError";
    this.message = message;
    this.response = response;
  }
}

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
  bottleneck: {},
  validateFn(res) {
    if (res.status && !(res.status >= 200 && res.status < 300)) {
      throw new ResponseError('Server responded with a status code that falls out of the range of 2xx', res);
    }
  },
  agentFn({ proxy, timeout }) {
    return new ProxyAgent(this.formatProxy(proxy), {
      timeout
    })
  },
  retryFn({ error, retryCount, timesThisIpRetried, ipsTried }, { retrySameIp, retryNextIp, abort }) {
    if (retryCount >= 3) {
      return abort();
    }

    // if fetch error and not a bad response code retry
    if (error.name && (error.name === "FetchError" || error.name === "AbortError")) {
      return retryNextIp();
    }

    return abort();
  },
  formatProxy(proxy) {
    if (proxy.url) {
      // default will return proxy.url
      return proxy.url
    } else {
      // if you use unique objects, it expects it to resemble a URL object
      return Url.format(proxy)
    }
  }
}

class Balancer {
  constructor(config) {
    this.lastUpdate;
    this.proxies = [];
    this.currentProxy = 0;
    this.config = Object.assign(defaultConfig, config);
    this.callstackLimiter = new Bottleneck(Object.assign({
      // if null will default to infinity in bottleneck
      maxConcurrent: this.config.maxConcurrent,
      minTime: this.config.minTime
    }, this.config.bottleneck));
    // sets ipLimiter if callsPerDuration, duration, and postDurationWait (then converted to seconds)
    this.ipLimiter = (config.limiter && config.limiter.callsPerDuration && config.limiter.duration && config.limiter.postDurationWait)
      && new RateLimiterMemory({ points: config.limiter.callsPerDuration, duration: config.limiter.duration / 1000 });
    this.fetchingProxies = false;
    this.requestor = this.config.requestor
    this.formatProxy = this.config.formatProxy
  }

  // gets and refreshes when applicable
  async getProxies(forceRefresh = false) {
    if (this.fetchingProxies) {
      if (this.proxies.length > 0) {
        // return potentially stale proxies
        return this.proxies;
      }
      // delay next check to see if proxies have arrived in 200ms intervals
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

  async request(url, options, timeout = this.config.timeout / 1000, { retryCount = 0, timesThisIpRetried = 0, ipsTried = 1 } = {}) {
    try {
      const next = await this.getAndSetNext();
      if (typeof this.config.agentFn !== 'function') throw new Error('agentFn must be a function')
      const agent = await this.config.agentFn({
        proxy: next,
        timeout: this.config.proxyTimeout
      });
      if (this.ipLimiter) {
        const proxies = await this.getProxies()
        const usedProxy = this.formatProxy(proxies[this.currentProxy])
        try {
          await this.ipLimiter.consume(usedProxy)

          // if no points remaining, delay the proxy
          const limit = await this.ipLimiter.get(usedProxy)
          if (limit && limit.remainingPoints === 0) {
            // block calls for duration
            const waitInSeconds = this.config.limiter.postDurationWait / 1000
            await this.ipLimiter.block(usedProxy, waitInSeconds)
          }
        } catch {
          throw new Error('Failed to consume, this may mean no remaining proxies are available.')
        }
      }
      const res = await this.callstackLimiter.schedule(() => {
        return this.fetch(url, {
          agent: agent,
          ...options
        }, timeout)
      })

      if (typeof this.config.validateFn !== 'function') throw new Error('validateFn must be a function')
      const valid = await this.config.validateFn(res);
      if (valid !== undefined && !valid) {
        throw new Error("Response was not valid");
      }

      return res;
    } catch (err) {
      if (typeof this.config.retryFn !== 'function') throw new Error('retryFn must be a function')
      const retryChoice = await this.config.retryFn({ error: err, retryCount, timesThisIpRetried, ipsTried }, {
        retryNextIp: () => { return this.request(url, options, timeout, { retryCount: retryCount + 1, timesThisIpRetried: 0, ipsTried: ipsTried + 1 }) },
        retrySameIp: () => { return this.request(url, options, timeout, { retryCount: retryCount + 1, timesThisIpRetried: timesThisIpRetried + 1, ipsTried }) },
        abort: () => { return Promise.reject(err) }
      })
      if (retryChoice === undefined) throw err;
      return retryChoice;
    }
  }

  async nextProxyIndex(proxies) {
    if (this.ipLimiter) {
      const hasCallsRemaining = (limit) => !limit || (limit && limit.remainingPoints > 0)
      // find next available in line
      const offset = this.currentProxy + 1
      const nextProxyAvailable = proxies.slice(offset, proxies.length).findIndex(async ip => {
        const url = this.formatProxy(ip)
        const limit = await this.ipLimiter.get(url)
        return hasCallsRemaining(limit)
      })
      if (nextProxyAvailable > -1) {
        return nextProxyAvailable + offset
      } else {
        // find next available starting from begining
        const previousProxyAvailable = proxies.slice(0, this.currentProxy).findIndex(async ip => {
          const url = this.formatProxy(ip)
          const limit = await this.ipLimiter.get(url)
          return hasCallsRemaining(limit)
        })
        if (previousProxyAvailable > -1) {
          return previousProxyAvailable
        } else {
          // check if we can reuse the same proxy since none left
          const url = this.formatProxy(proxies[this.currentProxy])
          const thisProxyLimit = await this.ipLimiter.get(url)
          if (hasCallsRemaining(thisProxyLimit)) {
            return this.currentProxy
          }

          if (typeof this.config.handleNoAvailableProxies === 'function') {
            // optional handler to request more proxies
            this.config.handleNoAvailableProxies()
          }
          // no proxies available!
          return null
        }
      }
    } else {
      const nextIndex = this.currentProxy + 1
      const nextProxyInArr = proxies[nextIndex]
      const initialProxy = 0
      return nextProxyInArr ? nextIndex : initialProxy
    }
  }

  async getAndSetNext() {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error("Empty proxy list");
    }

    const nextProxyIndex = await this.nextProxyIndex(proxies)
    const nextProxy = proxies[nextProxyIndex];
    if (!nextProxy) {
      throw new Error('No more proxies available.')
    }

    // set current proxy for usage
    this.currentProxy = nextProxyIndex

    return nextProxy;
  }

  async fetch(url, options, timeout = 5) {
    try {
      const res = await this.requestor(url, {
        ...options,
        timeout: timeout * 1000
      })

      return res;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = Balancer