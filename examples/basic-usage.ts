/**
 * Basic usage example (TypeScript/ESM)
 *
 * This example shows how to use proxy-balancer with TypeScript
 * and full type safety.
 */

import { Balancer, type BalancerConfig, type ProxyConfig } from 'proxy-balancer';
import fetch from 'node-fetch';

// Define proxy interface
interface MyProxy {
  url: string;
  username?: string;
  password?: string;
}

// Configure with full type safety
const config: BalancerConfig = {
  fetchProxies: async (): Promise<ProxyConfig[]> => {
    // In production, fetch from your proxy provider
    const proxies: MyProxy[] = [
      { url: 'http://proxy1.example.com:8080' },
      { url: 'http://proxy2.example.com:8080' },
      { url: 'http://proxy3.example.com:8080' },
    ];

    return proxies.map(p => ({ url: p.url }));
  },

  timeout: 5000,
  maxConcurrent: 10,
  minTime: 100,
};

// Create balancer instance
const balancer = new Balancer(config);

// Make requests with type-safe responses
async function main(): Promise<void> {
  try {
    const response = await balancer.request('https://api.ipify.org?format=json');
    const data = await response.json() as { ip: string };

    console.log('Your IP (via proxy):', data.ip);

    // Make multiple requests
    const requests = Array.from({ length: 5 }, async (_, i) => {
      const res = await balancer.request('https://api.ipify.org?format=json');
      const json = await res.json() as { ip: string };
      console.log(`Request ${i + 1}: ${json.ip}`);
    });

    await Promise.all(requests);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    }
  }
}

main();
