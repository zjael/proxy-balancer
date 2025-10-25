interface ProxyConfig {
    url: string;
    [key: string]: unknown;
}
interface RetryParams {
    error: Error;
    retryCount: number;
    timesThisIpRetried: number;
    ipsTried: number;
}
interface RetryOptions {
    retrySameIp: () => Promise<Response>;
    retryNextIp: () => Promise<Response>;
    abort: () => Promise<never>;
}
interface AgentParams {
    proxy: ProxyConfig;
    timeout: number;
}
interface LimiterConfig {
    callsPerDuration: number;
    duration: number;
    postDurationWait: number;
}
interface BottleneckConfig {
    maxConcurrent?: number | null;
    minTime?: number;
    [key: string]: unknown;
}
interface BalancerConfig {
    fetchProxies: () => Promise<string[] | ProxyConfig[]> | string[] | ProxyConfig[];
    poolExpired?: number;
    maxConcurrent?: number | null;
    minTime?: number;
    timeout?: number;
    proxyTimeout?: number;
    requestor?: Requestor;
    bottleneck?: BottleneckConfig;
    shuffle?: boolean;
    validateFn?: (res: Response) => boolean | void | Promise<boolean | void>;
    agentFn?: (params: AgentParams) => unknown | Promise<unknown>;
    retryFn?: (params: RetryParams, options: RetryOptions) => Promise<Response> | Promise<never> | void;
    limiter?: LimiterConfig;
    handleNoAvailableProxies?: () => void | Promise<void>;
    formatProxy?: (proxy: ProxyConfig) => string;
}
interface RequestParams {
    retryCount?: number;
    timesThisIpRetried?: number;
    ipsTried?: number;
}
type Requestor = (url: string, options?: RequestOptions) => Promise<Response>;
interface RequestOptions {
    agent?: unknown;
    timeout?: number;
    [key: string]: unknown;
}
interface Response {
    status?: number;
    statusCode?: number;
    data?: unknown;
    body?: unknown;
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
    [key: string]: unknown;
}

declare class Balancer {
    private config;
    private proxyPool;
    private rateLimiter?;
    private callstackLimiter;
    private currentProxy;
    readonly formatProxy: (proxy: ProxyConfig) => string;
    constructor(config: BalancerConfig);
    getProxies(forceRefresh?: boolean): Promise<ProxyConfig[]>;
    nextProxyIndex(proxies: ProxyConfig[]): Promise<number | null>;
    getAndSetNext(): Promise<ProxyConfig>;
    request(url: string, options?: RequestOptions, timeout?: number, params?: RequestParams): Promise<Response>;
    private fetch;
}

interface ProxyPoolConfig {
    fetchProxies: () => Promise<string[] | ProxyConfig[]> | string[] | ProxyConfig[];
    poolExpired: number;
    shuffle: boolean;
}
declare class ProxyPool {
    private config;
    private proxies;
    private lastUpdate?;
    private fetchingProxies;
    constructor(config: ProxyPoolConfig);
    getProxies(forceRefresh?: boolean): Promise<ProxyConfig[]>;
    getProxyCount(): number;
}

declare class RateLimiter {
    private config;
    private limiter;
    constructor(config: LimiterConfig);
    consume(proxyUrl: string): Promise<void>;
    hasCallsRemaining(proxyUrl: string): Promise<boolean>;
    findNextAvailableProxy(proxies: ProxyConfig[], currentIndex: number, formatProxyFn: (proxy: ProxyConfig) => string, handleNoAvailableProxies?: () => void | Promise<void>): Promise<number | null>;
}

declare class ResponseError extends Error {
    readonly response: Response;
    constructor(message: string | undefined, response: Response);
}

declare function delay(ms: number): Promise<void>;

declare function formatProxy(proxy: string | ProxyConfig): ProxyConfig;

declare function shuffle<T>(array: T[]): T[];

export { type AgentParams, Balancer, type BalancerConfig, type BottleneckConfig, type LimiterConfig, type ProxyConfig, ProxyPool, RateLimiter, type RequestOptions, type RequestParams, type Requestor, type Response, ResponseError, type RetryOptions, type RetryParams, Balancer as default, delay, formatProxy, shuffle };
