'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var Bottleneck = require('bottleneck');
var ProxyAgent = require('simple-proxy-agent');
var fetch = require('node-fetch');
var rateLimiterFlexible = require('rate-limiter-flexible');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var Bottleneck__default = /*#__PURE__*/_interopDefault(Bottleneck);
var ProxyAgent__default = /*#__PURE__*/_interopDefault(ProxyAgent);
var fetch__default = /*#__PURE__*/_interopDefault(fetch);

// src/core/Balancer.ts

// src/errors/ResponseError.ts
var ResponseError = class _ResponseError extends Error {
  response;
  constructor(message = "", response) {
    super(message);
    this.name = "ResponseError";
    this.message = message;
    this.response = response;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _ResponseError);
    }
  }
};

// src/utils/formatProxy.ts
function formatProxy(proxy) {
  if (typeof proxy === "string") {
    return { url: proxy };
  } else if (typeof proxy === "object" && proxy !== null) {
    return proxy;
  } else {
    return { url: "" };
  }
}

// src/utils/shuffle.ts
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// src/utils/delay.ts
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/core/ProxyPool.ts
var ProxyPool = class {
  constructor(config) {
    this.config = config;
  }
  proxies = [];
  lastUpdate;
  fetchingProxies = false;
  /**
   * Gets the current proxy list, refreshing if necessary
   * @param forceRefresh Force a refresh regardless of expiration
   * @returns Array of proxy configurations
   */
  async getProxies(forceRefresh = false) {
    if (this.fetchingProxies) {
      if (this.proxies.length > 0) {
        return this.proxies;
      }
      await delay(200);
      return this.getProxies();
    }
    const shouldRefresh = forceRefresh || !this.lastUpdate || this.proxies.length === 0 || Date.now() > this.lastUpdate + this.config.poolExpired;
    if (shouldRefresh) {
      this.fetchingProxies = true;
      try {
        const proxies = await this.config.fetchProxies();
        if (!Array.isArray(proxies)) {
          throw new Error("Proxies must be an array");
        }
        if (this.config.shuffle) {
          shuffle(proxies);
        }
        const formattedProxies = proxies.map(formatProxy);
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
  /**
   * Gets the current proxy count
   */
  getProxyCount() {
    return this.proxies.length;
  }
};
var RateLimiter = class {
  constructor(config) {
    this.config = config;
    this.limiter = new rateLimiterFlexible.RateLimiterMemory({
      points: config.callsPerDuration,
      duration: config.duration / 1e3
      // Convert to seconds
    });
  }
  limiter;
  /**
   * Consumes a point for the given proxy URL
   * @param proxyUrl Proxy URL to consume for
   * @throws Error if consumption fails
   */
  async consume(proxyUrl) {
    try {
      await this.limiter.consume(proxyUrl);
      const limit = await this.limiter.get(proxyUrl);
      if (limit && limit.remainingPoints === 0) {
        const waitInSeconds = this.config.postDurationWait / 1e3;
        await this.limiter.block(proxyUrl, waitInSeconds);
      }
    } catch {
      throw new Error("Failed to consume, this may mean no remaining proxies are available.");
    }
  }
  /**
   * Checks if a proxy has remaining calls
   * @param proxyUrl Proxy URL to check
   * @returns true if proxy has remaining calls
   */
  async hasCallsRemaining(proxyUrl) {
    const limit = await this.limiter.get(proxyUrl);
    return !limit || limit && limit.remainingPoints > 0;
  }
  /**
   * Finds the next available proxy index from a list
   * @param proxies Array of proxies
   * @param currentIndex Current proxy index
   * @param formatProxyFn Function to format proxy to URL
   * @param handleNoAvailableProxies Optional handler when no proxies available
   * @returns Next available proxy index or null
   */
  async findNextAvailableProxy(proxies, currentIndex, formatProxyFn, handleNoAvailableProxies) {
    const offset = currentIndex + 1;
    for (let i = offset; i < proxies.length; i++) {
      const url2 = formatProxyFn(proxies[i]);
      if (await this.hasCallsRemaining(url2)) {
        return i;
      }
    }
    for (let i = 0; i < currentIndex; i++) {
      const url2 = formatProxyFn(proxies[i]);
      if (await this.hasCallsRemaining(url2)) {
        return i;
      }
    }
    const url = formatProxyFn(proxies[currentIndex]);
    if (await this.hasCallsRemaining(url)) {
      return currentIndex;
    }
    if (handleNoAvailableProxies) {
      await handleNoAvailableProxies();
    }
    return null;
  }
};

// src/core/Balancer.ts
function defaultValidateFn(res) {
  const status = res.status ?? res.statusCode;
  if (status && !(status >= 200 && status < 300)) {
    throw new ResponseError(
      "Server responded with a status code that falls out of the range of 2xx",
      res
    );
  }
}
function defaultAgentFn({ proxy, timeout }) {
  return new ProxyAgent__default.default(this.formatProxy(proxy), {
    timeout
  });
}
async function defaultRetryFn({ error, retryCount }, { retryNextIp, abort }) {
  if (retryCount >= 3) {
    return abort();
  }
  if (error.name && (error.name === "FetchError" || error.name === "AbortError")) {
    return retryNextIp();
  }
  return abort();
}
function defaultFormatProxy(proxy) {
  if (proxy.url) {
    return proxy.url;
  } else {
    const protocol = String(proxy.protocol || "http:");
    const hostname = String(proxy.hostname || proxy.host || "localhost");
    const port = String(proxy.port || "80");
    return `${protocol}//${hostname}:${port}`;
  }
}
var defaultConfig = {
  poolExpired: 1 * 60 * 1e3,
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1e3,
  proxyTimeout: 2 * 1e3,
  requestor: fetch__default.default,
  bottleneck: {},
  shuffle: false,
  validateFn: defaultValidateFn,
  agentFn: defaultAgentFn,
  retryFn: defaultRetryFn,
  formatProxy: defaultFormatProxy
};
var Balancer = class {
  config;
  proxyPool;
  rateLimiter;
  callstackLimiter;
  currentProxy = 0;
  formatProxy;
  constructor(config) {
    this.config = { ...defaultConfig, ...config };
    this.proxyPool = new ProxyPool({
      fetchProxies: this.config.fetchProxies,
      poolExpired: this.config.poolExpired,
      shuffle: this.config.shuffle
    });
    this.callstackLimiter = new Bottleneck__default.default({
      maxConcurrent: this.config.maxConcurrent,
      minTime: this.config.minTime,
      ...this.config.bottleneck
    });
    if (this.config.limiter) {
      this.rateLimiter = new RateLimiter(this.config.limiter);
    }
    this.formatProxy = this.config.formatProxy.bind(this);
  }
  /**
   * Gets the current proxy list
   * @param forceRefresh Force a refresh of the proxy list
   * @returns Array of proxy configurations
   */
  async getProxies(forceRefresh = false) {
    return this.proxyPool.getProxies(forceRefresh);
  }
  /**
   * Finds the next available proxy index
   * @param proxies Array of proxies
   * @returns Next proxy index
   */
  async nextProxyIndex(proxies) {
    if (this.rateLimiter) {
      return this.rateLimiter.findNextAvailableProxy(
        proxies,
        this.currentProxy,
        this.formatProxy,
        this.config.handleNoAvailableProxies
      );
    } else {
      const nextIndex = this.currentProxy + 1;
      const nextProxyInArr = proxies[nextIndex];
      const initialProxy = 0;
      return nextProxyInArr ? nextIndex : initialProxy;
    }
  }
  /**
   * Gets and sets the next proxy for use
   * @returns Next proxy configuration
   * @throws Error if no proxies available
   */
  async getAndSetNext() {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error("Empty proxy list");
    }
    const nextProxyIndex = await this.nextProxyIndex(proxies);
    const nextProxy = nextProxyIndex !== null ? proxies[nextProxyIndex] : null;
    if (!nextProxy) {
      throw new Error("No more proxies available.");
    }
    this.currentProxy = nextProxyIndex;
    return nextProxy;
  }
  /**
   * Makes an HTTP request using a proxy
   * @param url URL to request
   * @param options Request options
   * @param timeout Timeout in seconds
   * @param params Internal retry parameters
   * @returns Response object
   */
  async request(url, options, timeout = this.config.timeout / 1e3, params = {}) {
    const { retryCount = 0, timesThisIpRetried = 0, ipsTried = 1 } = params;
    try {
      const next = await this.getAndSetNext();
      if (typeof this.config.agentFn !== "function") {
        throw new Error("agentFn must be a function");
      }
      const agent = await this.config.agentFn.call(this, {
        proxy: next,
        timeout: this.config.proxyTimeout
      });
      if (this.rateLimiter) {
        const proxies = await this.getProxies();
        const usedProxy = this.formatProxy(proxies[this.currentProxy]);
        await this.rateLimiter.consume(usedProxy);
      }
      const res = await this.callstackLimiter.schedule(() => {
        return this.fetch(url, { agent, ...options }, timeout);
      });
      if (typeof this.config.validateFn !== "function") {
        throw new Error("validateFn must be a function");
      }
      const valid = await this.config.validateFn(res);
      if (valid !== void 0 && !valid) {
        throw new Error("Response was not valid");
      }
      return res;
    } catch (err) {
      if (typeof this.config.retryFn !== "function") {
        throw new Error("retryFn must be a function");
      }
      const retryParams = {
        error: err,
        retryCount,
        timesThisIpRetried,
        ipsTried
      };
      const retryOptions = {
        retryNextIp: () => {
          return this.request(url, options, timeout, {
            retryCount: retryCount + 1,
            timesThisIpRetried: 0,
            ipsTried: ipsTried + 1
          });
        },
        retrySameIp: () => {
          return this.request(url, options, timeout, {
            retryCount: retryCount + 1,
            timesThisIpRetried: timesThisIpRetried + 1,
            ipsTried
          });
        },
        abort: () => {
          return Promise.reject(err);
        }
      };
      const retryChoice = await this.config.retryFn(retryParams, retryOptions);
      if (retryChoice === void 0) {
        throw err;
      }
      return retryChoice;
    }
  }
  /**
   * Internal fetch method
   * @param url URL to fetch
   * @param options Fetch options
   * @param timeout Timeout in seconds
   * @returns Response object
   */
  async fetch(url, options, timeout = 5) {
    const res = await this.config.requestor(url, {
      ...options,
      timeout: timeout * 1e3
    });
    return res;
  }
};

exports.Balancer = Balancer;
exports.ProxyPool = ProxyPool;
exports.RateLimiter = RateLimiter;
exports.ResponseError = ResponseError;
exports.default = Balancer;
exports.delay = delay;
exports.formatProxy = formatProxy;
exports.shuffle = shuffle;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map