/**
 * Proxy configuration types
 */
export interface ProxyConfig {
  url: string;
  [key: string]: unknown;
}

/**
 * Retry function parameters
 */
export interface RetryParams {
  error: Error;
  retryCount: number;
  timesThisIpRetried: number;
  ipsTried: number;
}

/**
 * Retry function options
 */
export interface RetryOptions {
  retrySameIp: () => Promise<Response>;
  retryNextIp: () => Promise<Response>;
  abort: () => Promise<never>;
}

/**
 * Agent function parameters
 */
export interface AgentParams {
  proxy: ProxyConfig;
  timeout: number;
}

/**
 * Rate limiter configuration
 */
export interface LimiterConfig {
  callsPerDuration: number;
  duration: number;
  postDurationWait: number;
}

/**
 * Bottleneck configuration options
 */
export interface BottleneckConfig {
  maxConcurrent?: number | null;
  minTime?: number;
  [key: string]: unknown;
}

/**
 * Main balancer configuration
 */
export interface BalancerConfig {
  /**
   * Function to fetch proxy list
   * @returns Array of proxy URLs or proxy objects
   */
  fetchProxies: () => Promise<string[] | ProxyConfig[]> | string[] | ProxyConfig[];

  /**
   * Time in milliseconds until the proxy list will be refreshed
   * @default 60000 (1 minute)
   */
  poolExpired?: number;

  /**
   * Maximum concurrent requests. Set to null for infinite
   * @default 15
   */
  maxConcurrent?: number | null;

  /**
   * Minimum time between each request in milliseconds
   * @default 100
   */
  minTime?: number;

  /**
   * Request timeout in milliseconds
   * @default 3000 (3 seconds)
   */
  timeout?: number;

  /**
   * Proxy connection timeout in milliseconds
   * @default 2000 (2 seconds)
   */
  proxyTimeout?: number;

  /**
   * HTTP client to use for requests
   * @default fetch
   */
  requestor?: Requestor;

  /**
   * Additional bottleneck configuration
   */
  bottleneck?: BottleneckConfig;

  /**
   * Shuffle fetched proxies using Fisher-Yates algorithm
   * @default false
   */
  shuffle?: boolean;

  /**
   * Validation function to check response validity
   * @param res Response object
   * @returns true if valid, false otherwise, or throws error
   */
  validateFn?: (res: Response) => boolean | void | Promise<boolean | void>;

  /**
   * Function to create proxy agent
   * @param params Agent parameters
   * @returns Agent object
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  agentFn?: (params: AgentParams) => unknown | Promise<unknown>;

  /**
   * Retry logic function
   * @param params Retry parameters
   * @param options Retry options
   * @returns Result of retry choice
   */
  retryFn?: (
    params: RetryParams,
    options: RetryOptions
  ) => Promise<Response> | Promise<never> | void;

  /**
   * Rate limiter configuration
   */
  limiter?: LimiterConfig;

  /**
   * Handler called when no proxies are available
   */
  handleNoAvailableProxies?: () => void | Promise<void>;

  /**
   * Function to format proxy objects to URL strings
   * @param proxy Proxy object
   * @returns Formatted proxy URL
   */
  formatProxy?: (proxy: ProxyConfig) => string;
}

/**
 * Internal request parameters for retry tracking
 */
export interface RequestParams {
  retryCount?: number;
  timesThisIpRetried?: number;
  ipsTried?: number;
}

/**
 * Generic requestor interface compatible with fetch, axios, got, etc.
 */
export type Requestor = (url: string, options?: RequestOptions) => Promise<Response>;

/**
 * Generic request options
 */
export interface RequestOptions {
  agent?: unknown;
  timeout?: number;
  [key: string]: unknown;
}

/**
 * Generic response interface
 */
export interface Response {
  status?: number;
  statusCode?: number;
  data?: unknown;
  body?: unknown;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
  [key: string]: unknown;
}
