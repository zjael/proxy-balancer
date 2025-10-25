import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { LimiterConfig, ProxyConfig } from '../types/index.js';

/**
 * Manages per-proxy rate limiting
 */
export class RateLimiter {
  private limiter: RateLimiterMemory;

  constructor(private config: LimiterConfig) {
    this.limiter = new RateLimiterMemory({
      points: config.callsPerDuration,
      duration: config.duration / 1000, // Convert to seconds
    });
  }

  /**
   * Consumes a point for the given proxy URL
   * @param proxyUrl Proxy URL to consume for
   * @throws Error if consumption fails
   */
  async consume(proxyUrl: string): Promise<void> {
    try {
      await this.limiter.consume(proxyUrl);

      // If no points remaining, delay the proxy
      const limit = await this.limiter.get(proxyUrl);
      if (limit && limit.remainingPoints === 0) {
        // Block calls for duration
        const waitInSeconds = this.config.postDurationWait / 1000;
        await this.limiter.block(proxyUrl, waitInSeconds);
      }
    } catch {
      throw new Error('Failed to consume, this may mean no remaining proxies are available.');
    }
  }

  /**
   * Checks if a proxy has remaining calls
   * @param proxyUrl Proxy URL to check
   * @returns true if proxy has remaining calls
   */
  async hasCallsRemaining(proxyUrl: string): Promise<boolean> {
    const limit = await this.limiter.get(proxyUrl);
    return !limit || (limit && limit.remainingPoints > 0);
  }

  /**
   * Finds the next available proxy index from a list
   * @param proxies Array of proxies
   * @param currentIndex Current proxy index
   * @param formatProxyFn Function to format proxy to URL
   * @param handleNoAvailableProxies Optional handler when no proxies available
   * @returns Next available proxy index or null
   */
  async findNextAvailableProxy(
    proxies: ProxyConfig[],
    currentIndex: number,
    formatProxyFn: (proxy: ProxyConfig) => string,
    handleNoAvailableProxies?: () => void | Promise<void>
  ): Promise<number | null> {
    // Find next available in line
    const offset = currentIndex + 1;

    // Search forward from current position
    for (let i = offset; i < proxies.length; i++) {
      const url = formatProxyFn(proxies[i]!);
      if (await this.hasCallsRemaining(url)) {
        return i;
      }
    }

    // Search from beginning to current position
    for (let i = 0; i < currentIndex; i++) {
      const url = formatProxyFn(proxies[i]!);
      if (await this.hasCallsRemaining(url)) {
        return i;
      }
    }

    // Check if we can reuse the same proxy since none left
    const url = formatProxyFn(proxies[currentIndex]!);
    if (await this.hasCallsRemaining(url)) {
      return currentIndex;
    }

    if (handleNoAvailableProxies) {
      // Optional handler to request more proxies
      await handleNoAvailableProxies();
    }

    // No proxies available
    return null;
  }
}
