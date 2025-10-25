# Migration Guide: v2.x to v3.0

This guide will help you migrate from proxy-balancer v2.x to v3.0.

## Breaking Changes Overview

1. **Node.js Version** - Minimum Node.js 18+ (was 10+)
2. **ES Modules** - Package is now ESM-first
3. **TypeScript** - Rewritten in TypeScript
4. **Import Syntax** - Changed from default to named imports
5. **Dependencies** - Removed `shuffle-array` and `url` packages

## Step-by-Step Migration

### 1. Update Node.js

Ensure you're running Node.js 18 or higher:

```bash
node --version  # Should be >= 18.0.0
```

### 2. Update Package Version

```bash
npm install proxy-balancer@3
```

### 3. Update Import Syntax

#### For ES Modules (Recommended)

**Before (v2.x):**
```javascript
const Balancer = require('proxy-balancer');
```

**After (v3.x):**
```typescript
import { Balancer } from 'proxy-balancer';
```

#### For CommonJS

**Before (v2.x):**
```javascript
const Balancer = require('proxy-balancer');
```

**After (v3.x):**
```javascript
const { Balancer } = require('proxy-balancer');
```

### 4. Update TypeScript Projects

Add type imports if using TypeScript:

```typescript
import { Balancer, type BalancerConfig, type ProxyConfig } from 'proxy-balancer';

const config: BalancerConfig = {
  fetchProxies: async (): Promise<ProxyConfig[]> => {
    // Your implementation
  }
};

const balancer = new Balancer(config);
```

### 5. Configuration Changes

The configuration API remains largely the same, but with better type safety:

**Before (v2.x):**
```javascript
const balancer = new Balancer({
  fetchProxies: () => {
    return fetch('https://api.example.com/proxies.json')
      .then(res => res.json())
      .then(proxies => proxies.map(p => `http://${p.ip}:${p.port}`))
  },
  timeout: 3000,
  maxConcurrent: 15
});
```

**After (v3.x):**
```typescript
const balancer = new Balancer({
  fetchProxies: async () => {
    const res = await fetch('https://api.example.com/proxies.json');
    const proxies = await res.json();
    return proxies.map(p => `http://${p.ip}:${p.port}`);
  },
  timeout: 3000,
  maxConcurrent: 15
});
```

## API Changes

### No Breaking API Changes

The public API remains the same:

- `balancer.request(url, options?, timeout?)` - **No changes**
- `balancer.getProxies(forceRefresh?)` - **No changes**
- `balancer.getAndSetNext()` - **No changes**

### Configuration Options

All configuration options remain the same with improved type definitions:

| Option | v2.x | v3.x | Notes |
|--------|------|------|-------|
| `fetchProxies` | Required | Required | Now with TypeScript types |
| `poolExpired` | Optional | Optional | Same default (60000ms) |
| `maxConcurrent` | Optional | Optional | Same default (15) |
| `minTime` | Optional | Optional | Same default (100ms) |
| `timeout` | Optional | Optional | Same default (3000ms) |
| `proxyTimeout` | Optional | Optional | Same default (2000ms) |
| `requestor` | Optional | Optional | Now defaults to node-fetch |
| `shuffle` | Optional | Optional | Same default (false) |
| `validateFn` | Optional | Optional | No changes |
| `agentFn` | Optional | Optional | No changes |
| `retryFn` | Optional | Optional | No changes |
| `limiter` | Optional | Optional | No changes |
| `handleNoAvailableProxies` | Optional | Optional | No changes |
| `formatProxy` | Optional | Optional | No changes |
| `bottleneck` | Optional | Optional | No changes |

## Removed Dependencies

### shuffle-array

The `shuffle-array` dependency has been removed and replaced with a built-in Fisher-Yates shuffle implementation. No changes needed in your code.

### url

The deprecated `url` package has been removed. The built-in `URL` class is now used internally. No changes needed in your code.

## TypeScript Support

v3.x includes full TypeScript support with comprehensive type definitions:

```typescript
import {
  Balancer,
  type BalancerConfig,
  type ProxyConfig,
  type RetryParams,
  type RetryOptions,
  type Response,
  type Requestor
} from 'proxy-balancer';
```

## Package.json Updates

If you're using `"type": "module"` in your package.json:

```json
{
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## Testing Your Migration

After migrating, test your code:

```bash
# Run your tests
npm test

# Or manually test
node your-app.js
```

## Common Issues

### Issue: `require() of ES Module not supported`

**Solution:** Either:
1. Switch to ES modules (add `"type": "module"` to package.json)
2. Use dynamic import: `const { Balancer } = await import('proxy-balancer');`
3. Use the CommonJS syntax: `const { Balancer } = require('proxy-balancer');`

### Issue: TypeScript errors

**Solution:** Ensure you have the latest TypeScript version:

```bash
npm install -D typescript@latest
```

### Issue: `SyntaxError: Cannot use import statement outside a module`

**Solution:** Add `"type": "module"` to your package.json or use `.mjs` file extension.

## Need Help?

If you encounter issues during migration:

1. Check the [examples](./examples) directory
2. Review the [API documentation](./README.md#api)
3. Open an issue on [GitHub](https://github.com/zjael/proxy-balancer/issues)

## Rollback

If you need to rollback to v2.x:

```bash
npm install proxy-balancer@2
```

## Benefits of Upgrading

- 🎯 **Type Safety** - Catch errors at compile time
- 📦 **Modern Tooling** - Better tree-shaking and bundling
- ⚡ **Performance** - Optimized for modern JavaScript engines
- 🛡️ **Security** - No deprecated dependencies
- 📚 **Better DX** - IntelliSense and autocomplete support
