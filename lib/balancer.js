const Bottleneck = require('bottleneck');
const ProxyAgent = require('simple-proxy-agent');
const fetch = require('node-fetch');
const { RateLimiterMemory } = require('rate-limiter-flexible')

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

const noProxiesAvailable = 'No more proxies available.'
const retryOptions = {
  retrySameIp: 'retry',
  retryNextIp: 'next',
  abort: 'abort',
  abortWithDuration: 'abortduration'
}

const defaultConfig = {
  poolExpired: 1 * 60 * 1000,
  fetchProxies: () => [],
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000,
  requestor: fetch,
  bottleneckOptions: {},
  retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }) => {
    if (retryCount >= 3) {
      return retryOptions.abort
    }
    // if fetch error and not a bad response code retry
    if (error.name && (error.name === "FetchError" || error.name === "AbortError")) {
      return retryOptions.retryNextIp
    }
    return retryOptions.abort
  },
  formatProxy: (proxy) => {
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
    this.config = Object.assign({}, defaultConfig, config);
    this.callstackLimiter = new Bottleneck({
      ...this.config.bottleneckOptions,
      // if null will default to infinity in bottleneck
      maxConcurrent: this.config.maxConcurrent,
      minTime: this.config.minTime
    });
    // sets ipLimiter if callsPerDuration, duration, and postDurationWait
    this.ipLimiter = (config.callsPerDuration && config.duration && config.postDurationWait)
      && new RateLimiterMemory({ points: config.callsPerDuration, duration: config.duration });
    this.fetchingProxies = false;
    this.requestor = this.config.requestor
    this.isNodeFetch = this.requestor === fetch
    this.formatProxy = this.config.formatProxy
    this.agentFn = this.config.agentFn || function ({ proxy, timeout }) {
      return new ProxyAgent(this.formatProxy(proxy), {
        timeout
      })
    }

    // if using older version
    if (this.config.proxiesFn) {
      console.error('proxy-node: proxyFn has been renamed to fetchProxies')
    }
  }

  // gets and refreshes when applicable
  async getProxies(forceRefresh = false) {
    if (this.fetchingProxies) {
      if (this.proxies.length > 0) {
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
      const next = await this.getNext();
      if (typeof this.agentFn !== 'function') throw new Error('agentFn must be a function')
      const agent = await this.agentFn({
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
            const waitInSeconds = this.config.postDurationWait / 1000
            await this.ipLimiter.block(usedProxy, waitInSeconds)
          }
        } catch {
          throw new Error(`Failed to consume: ${noProxiesAvailable}`)
        }
      }
      const res = await this.callstackLimiter.schedule(() => {
        return this.fetch(url, {
          agent: agent,
          ...options
        }, timeout)
      })
      return res;
    } catch (err) {
      const retryChoice = await this.config.retryFn({ error: err, retryCount, timesThisIpRetried, ipsTried })

      if (retryChoice === retryOptions.retryNextIp) {
        // retry new proxy
        return this.request(url, options, timeout, { retryCount: retryCount + 1, timesThisIpRetried: 0, ipsTried: ipsTried + 1 });
      } else if (retryChoice === retryOptions.retrySameIp) {
        // retry same ip
        return this.request(url, options, timeout, { retryCount: retryCount + 1, timesThisIpRetried: timesThisIpRetried + 1, ipsTried });
      } else {
        throw err;
      }
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
      const followingProxy = proxies[this.currentProxy + 1]
      const initialProxy = 0
      return followingProxy ? this.currentProxy + 1 : initialProxy
    }
  }

  async getNext() {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error("Empty proxy list");
    }

    const nextProxyIndex = await this.nextProxyIndex(proxies)
    let nextProxy = proxies[nextProxyIndex];
    if (!nextProxy) {
      throw new Error(noProxiesAvailable)
    }

    this.currentProxy = nextProxyIndex

    return nextProxy;
  }

  async fetch(url, options, timeout = 5) {
    try {
      const res = await this.requestor(url, {
        ...options,
        timeout: timeout * 1000
      })
      if (this.isNodeFetch && !res.ok) {
        const text = await res.text()
        try {
          // parse after text() because json() may fail, text() will not
          const bodyAsJson = JSON.parse(text);
          return Promise.reject(bodyAsJson)
        } catch (e) {
          return Promise.reject({ body: text, type: 'unparsable', message: 'Failed response' });
        }
      }
      return res;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = Balancer

module.exports.retryOptions = retryOptions
