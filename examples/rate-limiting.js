/**
 * Rate limiting example
 *
 * This example shows how to use per-proxy rate limiting
 * to avoid getting blocked by rate limits.
 */

const { Balancer } = require('proxy-balancer');

const balancer = new Balancer({
  fetchProxies: async () => {
    return [
      'http://proxy1.example.com:8080',
      'http://proxy2.example.com:8080',
      'http://proxy3.example.com:8080',
      'http://proxy4.example.com:8080',
    ];
  },

  // Rate limiter configuration
  limiter: {
    callsPerDuration: 5,              // Max 5 calls
    duration: 60 * 1000,               // Per 60 seconds (1 minute)
    postDurationWait: 5 * 60 * 1000,   // Wait 5 minutes after limit reached
  },

  // Global request limits
  maxConcurrent: 10,
  minTime: 200,  // Min 200ms between requests

  timeout: 5000,
});

async function main() {
  console.log('Starting rate-limited requests...\n');

  // Make 25 requests (will use all 4 proxies with rate limiting)
  const promises = Array.from({ length: 25 }, async (_, i) => {
    try {
      const startTime = Date.now();
      const response = await balancer.request('https://api.ipify.org?format=json');
      const data = await response.json();
      const duration = Date.now() - startTime;

      console.log(`Request ${i + 1}: IP=${data.ip}, Duration=${duration}ms`);
      return data;
    } catch (error) {
      console.error(`Request ${i + 1} failed:`, error.message);
      throw error;
    }
  });

  try {
    const results = await Promise.all(promises);
    console.log(`\nCompleted ${results.length} requests successfully`);

    // Count unique IPs (proxies used)
    const uniqueIPs = new Set(results.map(r => r.ip));
    console.log(`Used ${uniqueIPs.size} different proxies`);
  } catch (error) {
    console.error('Some requests failed:', error.message);
  }
}

main();
