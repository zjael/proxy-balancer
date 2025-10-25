/**
 * Basic usage example (CommonJS)
 *
 * This example shows the simplest way to use proxy-balancer
 * with node-fetch in a CommonJS environment.
 */

const { Balancer } = require('proxy-balancer');
const fetch = require('node-fetch');

// Create a balancer instance
const balancer = new Balancer({
  // Required: function to fetch your proxy list
  fetchProxies: async () => {
    // In production, fetch from your proxy provider
    // For this example, we'll use a mock list
    return [
      'http://proxy1.example.com:8080',
      'http://proxy2.example.com:8080',
      'http://proxy3.example.com:8080',
    ];
  },

  // Optional: configuration
  timeout: 5000,        // 5 second request timeout
  maxConcurrent: 10,    // Max 10 concurrent requests
  minTime: 100,         // Min 100ms between requests
});

// Make requests
async function main() {
  try {
    // Each request automatically uses the next proxy (round-robin)
    const response = await balancer.request('https://api.ipify.org?format=json');
    const data = await response.json();

    console.log('Your IP (via proxy):', data.ip);

    // Make multiple requests
    const promises = Array.from({ length: 5 }, (_, i) =>
      balancer.request('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => console.log(`Request ${i + 1}: ${data.ip}`))
    );

    await Promise.all(promises);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
