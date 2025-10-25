import Bottleneck from 'bottleneck';
import ProxyAgent from 'simple-proxy-agent';
import fetch from 'node-fetch';
import type {
  BalancerConfig,
  ProxyConfig,
  RequestParams,
  RequestOptions,
  Response,
  RetryParams,
  RetryOptions,
  Requestor,
} from '../types/index.js';
import { ResponseError } from '../errors/ResponseError.js';
import { ProxyPool } from './ProxyPool.js';
import { RateLimiter } from './RateLimiter.js';

/**
 * Default validation function that checks for 2xx status codes
 */
function defaultValidateFn(res: Response): void {
  const status = res.status ?? res.statusCode;
  if (status && !(status >= 200 && status < 300)) {
    throw new ResponseError(
      'Server responded with a status code that falls out of the range of 2xx',
      res
    );
  }
}

/**
 * Default agent function that creates a ProxyAgent
 */
function defaultAgentFn(
  this: Balancer,
  { proxy, timeout }: { proxy: ProxyConfig; timeout: number }
): ProxyAgent {
  return new ProxyAgent(this.formatProxy(proxy), {
    timeout,
  });
}

/**
 * Default retry function with basic retry logic
 */
async function defaultRetryFn(
  { error, retryCount }: RetryParams,
  { retryNextIp, abort }: RetryOptions
): Promise<Response> {
  if (retryCount >= 3) {
    return abort();
  }

  // If fetch error and not a bad response code, retry
  if (error.name && (error.name === 'FetchError' || error.name === 'AbortError')) {
    return retryNextIp();
  }

  return abort();
}

/**
 * Default proxy formatting function
 */
function defaultFormatProxy(proxy: ProxyConfig): string {
  if (proxy.url) {
    return proxy.url;
  } else {
    // If you use unique objects, construct URL from parts
    const protocol = String(proxy.protocol || 'http:');
    const hostname = String(proxy.hostname || proxy.host || 'localhost');
    const port = String(proxy.port || '80');
    return `${protocol}//${hostname}:${port}`;
  }
}

/**
 * Default configuration values
 */
const defaultConfig: Partial<BalancerConfig> = {
  poolExpired: 1 * 60 * 1000,
  maxConcurrent: 15,
  minTime: 100,
  timeout: 3 * 1000,
  proxyTimeout: 2 * 1000,
  requestor: fetch as unknown as Requestor,
  bottleneck: {},
  shuffle: false,
  validateFn: defaultValidateFn,
  agentFn: defaultAgentFn,
  retryFn: defaultRetryFn,
  formatProxy: defaultFormatProxy,
};

/**
 * Main proxy load balancer class
 */
export class Balancer {
  private config: Required<BalancerConfig>;
  private proxyPool: ProxyPool;
  private rateLimiter?: RateLimiter;
  private callstackLimiter: Bottleneck;
  private currentProxy = 0;
  public readonly formatProxy: (proxy: ProxyConfig) => string;

  constructor(config: BalancerConfig) {
    // Merge with defaults
    this.config = { ...defaultConfig, ...config } as Required<BalancerConfig>;

    // Setup proxy pool
    this.proxyPool = new ProxyPool({
      fetchProxies: this.config.fetchProxies,
      poolExpired: this.config.poolExpired,
      shuffle: this.config.shuffle,
    });

    // Setup callstack limiter (bottleneck)
    this.callstackLimiter = new Bottleneck({
      maxConcurrent: this.config.maxConcurrent,
      minTime: this.config.minTime,
      ...this.config.bottleneck,
    });

    // Setup rate limiter if configured
    if (this.config.limiter) {
      this.rateLimiter = new RateLimiter(this.config.limiter);
    }

    // Bind format proxy function
    this.formatProxy = this.config.formatProxy.bind(this);
  }

  /**
   * Gets the current proxy list
   * @param forceRefresh Force a refresh of the proxy list
   * @returns Array of proxy configurations
   */
  async getProxies(forceRefresh = false): Promise<ProxyConfig[]> {
    return this.proxyPool.getProxies(forceRefresh);
  }

  /**
   * Finds the next available proxy index
   * @param proxies Array of proxies
   * @returns Next proxy index
   */
  async nextProxyIndex(proxies: ProxyConfig[]): Promise<number | null> {
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
  async getAndSetNext(): Promise<ProxyConfig> {
    const proxies = await this.getProxies();
    if (proxies.length === 0) {
      throw new Error('Empty proxy list');
    }

    const nextProxyIndex = await this.nextProxyIndex(proxies);
    const nextProxy = nextProxyIndex !== null ? proxies[nextProxyIndex] : null;

    if (!nextProxy) {
      throw new Error('No more proxies available.');
    }

    // Set current proxy for usage
    this.currentProxy = nextProxyIndex!;

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
  async request(
    url: string,
    options?: RequestOptions,
    timeout: number = this.config.timeout / 1000,
    params: RequestParams = {}
  ): Promise<Response> {
    const { retryCount = 0, timesThisIpRetried = 0, ipsTried = 1 } = params;

    try {
      const next = await this.getAndSetNext();

      if (typeof this.config.agentFn !== 'function') {
        throw new Error('agentFn must be a function');
      }

      const agent = await this.config.agentFn.call(this, {
        proxy: next,
        timeout: this.config.proxyTimeout,
      });

      // Handle rate limiting
      if (this.rateLimiter) {
        const proxies = await this.getProxies();
        const usedProxy = this.formatProxy(proxies[this.currentProxy]!);
        await this.rateLimiter.consume(usedProxy);
      }

      // Make the request through bottleneck
      const res = await this.callstackLimiter.schedule(() => {
        return this.fetch(url, { agent, ...options }, timeout);
      });

      // Validate response
      if (typeof this.config.validateFn !== 'function') {
        throw new Error('validateFn must be a function');
      }

      const valid = await this.config.validateFn(res);
      if (valid !== undefined && !valid) {
        throw new Error('Response was not valid');
      }

      return res;
    } catch (err) {
      if (typeof this.config.retryFn !== 'function') {
        throw new Error('retryFn must be a function');
      }

      const retryParams: RetryParams = {
        error: err as Error,
        retryCount,
        timesThisIpRetried,
        ipsTried,
      };

      const retryOptions: RetryOptions = {
        retryNextIp: () => {
          return this.request(url, options, timeout, {
            retryCount: retryCount + 1,
            timesThisIpRetried: 0,
            ipsTried: ipsTried + 1,
          });
        },
        retrySameIp: () => {
          return this.request(url, options, timeout, {
            retryCount: retryCount + 1,
            timesThisIpRetried: timesThisIpRetried + 1,
            ipsTried,
          });
        },
        abort: () => {
          return Promise.reject(err);
        },
      };

      const retryChoice = await this.config.retryFn(retryParams, retryOptions);

      if (retryChoice === undefined) {
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
  private async fetch(
    url: string,
    options?: RequestOptions,
    timeout = 5
  ): Promise<Response> {
    const res = await this.config.requestor(url, {
      ...options,
      timeout: timeout * 1000,
    });

    return res;
  }
}
