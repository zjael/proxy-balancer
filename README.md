# proxy-balancer

[![Build status](https://github.com/zjael/proxy-balancer/workflows/CI/badge.svg)](https://github.com/zjael/proxy-balancer/actions)
[![Package version](https://img.shields.io/npm/v/proxy-balancer.svg)](https://npmjs.org/package/proxy-balancer)
[![NPM downloads](https://img.shields.io/npm/dm/proxy-balancer)](https://npmjs.org/package/proxy-balancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](https://opensource.org/licenses/MIT)

> Modern TypeScript proxy load balancer with automatic failover and rate limiting

## Features

- ✨ **TypeScript** - Full type safety and IntelliSense support
- 🔄 **Round Robin** - Automatic proxy rotation
- 🛡️ **Automatic Failover** - Seamlessly switches to next proxy on failure
- ⏱️ **Rate Limiting** - Per-proxy rate limiting with configurable limits
- 🎯 **Retry Logic** - Customizable retry strategies
- 🔌 **Flexible** - Works with any HTTP client (fetch, axios, got, etc.)
- 📦 **Dual Package** - ESM and CommonJS support
- 🎲 **Shuffling** - Optional proxy shuffling using Fisher-Yates algorithm

## Table of Contents

- [Install](#install)
- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [TypeScript Example](#typescript-example)
  - [Advanced Configuration](#advanced-configuration)
- [API](#api)
- [Migration from v2](#migration-from-v2)
- [License](#license)

## Install

```bash
npm install proxy-balancer
```

**Requirements:** Node.js 18+

## Usage

### Basic Example

```typescript
import { Balancer } from 'proxy-balancer';
import fetch from 'node-fetch';

const balancer = new Balancer({
  // Required: function to populate proxy list
  fetchProxies: async () => {
    const res = await fetch('https://api.example.com/proxies.json');
    const proxies = await res.json();
    return proxies
      .filter(proxy => proxy.working_average > 70)
      .map(proxy => `http://${proxy.ip}:${proxy.port}`);
  }
});

// Each request uses a fresh proxy via round robin
const response = await balancer.request('https://api.example.com/data');
const data = await response.json();
console.log(data);
```

### TypeScript Example

```typescript
import { Balancer, type BalancerConfig, type ProxyConfig } from 'proxy-balancer';

interface MyProxy {
  ip: string;
  port: number;
  protocol: 'http' | 'https';
}

const config: BalancerConfig = {
  fetchProxies: async (): Promise<ProxyConfig[]> => {
    const proxies: MyProxy[] = await getProxiesFromAPI();
    return proxies.map(p => ({
      url: `${p.protocol}://${p.ip}:${p.port}`
    }));
  },
  timeout: 5000,
  maxConcurrent: 10,
};

const balancer = new Balancer(config);
```

### Advanced Configuration

```typescript
import { Balancer } from 'proxy-balancer';
import axios from 'axios';

const balancer = new Balancer({
  // ===== REQUIRED =====

  /**
   * Function to fetch proxy list
   * Returns array of proxy URLs or proxy objects
   */
  fetchProxies: async () => {
    return ['http://proxy1.com:8080', 'http://proxy2.com:8080'];
  },

  // ===== OPTIONAL =====

  /**
   * Time in milliseconds until proxy list will be refreshed
   * @default 60000 (1 minute)
   */
  poolExpired: 1 * 60 * 1000,

  /**
   * Maximum concurrent requests. Set to null for infinite
   * @default 15
   */
  maxConcurrent: 15,

  /**
   * Minimum time between each request in milliseconds
   * @default 100
   */
  minTime: 100,

  /**
   * Request timeout in milliseconds
   * @default 3000 (3 seconds)
   */
  timeout: 3 * 1000,

  /**
   * Proxy connection timeout in milliseconds
   * @default 2000 (2 seconds)
   */
  proxyTimeout: 2 * 1000,

  /**
   * HTTP client to use (fetch, axios, got, etc.)
   * @default node-fetch
   */
  requestor: axios,

  /**
   * Shuffle fetched proxies using Fisher-Yates algorithm
   * @default false
   */
  shuffle: true,

  /**
   * Custom proxy agent function
   * Allows you to use different proxy agents or add authentication
   */
  agentFn: ({ proxy, timeout }) => {
    return new ProxyAgent(proxy.url, {
      timeout,
      // Add custom headers, auth, etc.
    });
  },

  /**
   * Response validation function
   * Return false or throw error to trigger retry
   */
  validateFn: (res) => {
    if (res.status && !(res.status >= 200 && res.status < 300)) {
      throw new Error('Invalid status code');
    }
  },

  /**
   * Custom retry logic
   * Control when and how to retry failed requests
   */
  retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }, { retrySameIp, retryNextIp, abort }) => {
    // Max 3 retries
    if (retryCount >= 3) {
      return abort();
    }

    // Retry with next IP for network errors
    if (error.name === 'FetchError' || error.name === 'AbortError') {
      return retryNextIp();
    }

    // Abort on other errors
    return abort();
  },

  /**
   * Per-proxy rate limiting
   * Limits requests per proxy over a time window
   */
  limiter: {
    callsPerDuration: 5,           // Max 5 calls
    duration: 60 * 1000,            // Per 60 seconds
    postDurationWait: 5 * 60 * 1000 // Wait 5 minutes after limit
  },

  /**
   * Handler called when no proxies are available
   * Useful for requesting more proxies or logging
   */
  handleNoAvailableProxies: () => {
    console.log('No proxies available, fetching more...');
  },

  /**
   * Custom proxy formatting function
   * For non-standard proxy object structures
   */
  formatProxy: (proxy) => {
    return proxy.url || `http://${proxy.host}:${proxy.port}`;
  },

  /**
   * Additional bottleneck options
   * See: https://github.com/SGrondin/bottleneck
   */
  bottleneck: {
    // Custom bottleneck options
  }
});
```

## API

### `new Balancer(config)`

Creates a new proxy balancer instance.

#### Config Options

See [Advanced Configuration](#advanced-configuration) for all options.

### `balancer.request(url, options?, timeout?)`

Makes an HTTP request through a proxy.

**Parameters:**
- `url` (string) - URL to request
- `options` (object, optional) - Request options passed to requestor
- `timeout` (number, optional) - Timeout in seconds (overrides config.timeout)

**Returns:** `Promise<Response>` - Response from requestor

**Example:**
```typescript
const response = await balancer.request('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' })
});
```

### `balancer.getProxies(forceRefresh?)`

Gets the current proxy list.

**Parameters:**
- `forceRefresh` (boolean, optional) - Force refresh regardless of expiration

**Returns:** `Promise<ProxyConfig[]>` - Array of proxy configurations

### `balancer.getAndSetNext()`

Gets and sets the next proxy for use.

**Returns:** `Promise<ProxyConfig>` - Next proxy configuration

## Migration from v2

Version 3.0.0 is a complete rewrite in TypeScript with breaking changes. See [MIGRATION.md](./MIGRATION.md) for detailed migration guide.

### Key Changes

1. **ES Modules** - Package is now ESM-first with CJS support
2. **TypeScript** - Full type definitions included
3. **Node.js 18+** - Dropped support for Node.js <18
4. **Removed dependencies** - `shuffle-array` and `url` packages removed
5. **Import changes**:

```typescript
// v2.x (CommonJS)
const Balancer = require('proxy-balancer');

// v3.x (ESM)
import { Balancer } from 'proxy-balancer';

// v3.x (CommonJS)
const { Balancer } = require('proxy-balancer');
```

## License

MIT © Jakob Sjælland
