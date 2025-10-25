/**
 * Custom retry logic example
 *
 * This example shows how to implement custom retry strategies
 * for different types of errors.
 */

const { Balancer, ResponseError } = require('proxy-balancer');

const balancer = new Balancer({
  fetchProxies: async () => {
    return [
      'http://proxy1.example.com:8080',
      'http://proxy2.example.com:8080',
      'http://proxy3.example.com:8080',
    ];
  },

  // Custom retry logic
  retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }, { retrySameIp, retryNextIp, abort }) => {
    console.log(`Retry attempt ${retryCount + 1}: ${error.message}`);
    console.log(`  - Times this IP retried: ${timesThisIpRetried}`);
    console.log(`  - Total IPs tried: ${ipsTried}`);

    // Max 5 retries total
    if (retryCount >= 5) {
      console.log('  → Aborting after 5 retries');
      return abort();
    }

    // Network errors: try next proxy
    if (error.name === 'FetchError' || error.name === 'AbortError') {
      console.log('  → Network error, trying next proxy');
      return retryNextIp();
    }

    // Timeout errors: try same proxy once more, then switch
    if (error.name === 'TimeoutError') {
      if (timesThisIpRetried < 1) {
        console.log('  → Timeout, retrying same proxy');
        return retrySameIp();
      } else {
        console.log('  → Timeout again, switching proxy');
        return retryNextIp();
      }
    }

    // 5xx errors: try next proxy
    if (error instanceof ResponseError && error.response.status >= 500) {
      console.log('  → Server error, trying next proxy');
      return retryNextIp();
    }

    // 429 Too Many Requests: switch proxy immediately
    if (error instanceof ResponseError && error.response.status === 429) {
      console.log('  → Rate limited, switching proxy');
      return retryNextIp();
    }

    // 4xx errors (except 429): don't retry
    if (error instanceof ResponseError && error.response.status >= 400 && error.response.status < 500) {
      console.log('  → Client error, not retrying');
      return abort();
    }

    // Unknown error: abort
    console.log('  → Unknown error, aborting');
    return abort();
  },

  // Custom validation
  validateFn: (res) => {
    // Example: validate response contains expected data
    if (res.status === 200) {
      return true;
    }

    // Throw error for non-200 status
    throw new ResponseError(`Unexpected status: ${res.status}`, res);
  },

  timeout: 5000,
  maxConcurrent: 5,
});

async function main() {
  try {
    console.log('Making request with custom retry logic...\n');

    const response = await balancer.request('https://api.ipify.org?format=json');
    const data = await response.json();

    console.log('\n✓ Success! IP:', data.ip);
  } catch (error) {
    console.error('\n✗ Failed after all retries:', error.message);
  }
}

main();
