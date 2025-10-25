# proxy-balancer Examples

This directory contains practical examples showing how to use proxy-balancer in different scenarios.

## Examples

### Basic Usage

- **[basic-usage.js](./basic-usage.js)** - CommonJS example with node-fetch
- **[basic-usage.ts](./basic-usage.ts)** - TypeScript/ESM example with full type safety

Start here if you're new to proxy-balancer!

### Different HTTP Clients

- **[axios-example.js](./axios-example.js)** - Using axios instead of node-fetch

Shows how to use different HTTP clients with proxy-balancer.

### Advanced Features

- **[rate-limiting.js](./rate-limiting.js)** - Per-proxy rate limiting configuration
- **[custom-retry.js](./custom-retry.js)** - Custom retry logic and error handling

## Running the Examples

### Prerequisites

```bash
# Install proxy-balancer
npm install proxy-balancer

# For specific examples, install additional dependencies:
npm install node-fetch  # For basic-usage.js
npm install axios       # For axios-example.js
```

### Run an Example

```bash
# CommonJS examples
node examples/basic-usage.js
node examples/axios-example.js
node examples/rate-limiting.js
node examples/custom-retry.js

# TypeScript example
npx ts-node examples/basic-usage.ts
# or compile first
npx tsc examples/basic-usage.ts && node examples/basic-usage.js
```

## Note About Proxies

These examples use placeholder proxy URLs (`proxy1.example.com`, etc.).

**In production**, replace the `fetchProxies` function with code that fetches real proxies from your provider:

```javascript
const balancer = new Balancer({
  fetchProxies: async () => {
    // Fetch from your proxy provider API
    const response = await fetch('https://your-proxy-provider.com/api/proxies');
    const proxies = await response.json();

    return proxies.map(p => `http://${p.ip}:${p.port}`);
  }
});
```

## More Examples

For more examples and detailed documentation, see:
- [Main README](../README.md)
- [Migration Guide](../MIGRATION.md)
- [API Documentation](../README.md#api)

## Contributing

Have a useful example? Feel free to contribute by opening a PR!
