import type { ProxyConfig } from '../types/index.js';
import { formatProxy } from '../utils/formatProxy.js';
import { shuffle } from '../utils/shuffle.js';
import { delay } from '../utils/delay.js';

export interface ProxyPoolConfig {
  fetchProxies: () => Promise<string[] | ProxyConfig[]> | string[] | ProxyConfig[];
  poolExpired: number;
  shuffle: boolean;
}

/**
 * Manages the proxy pool with automatic refreshing
 */
export class ProxyPool {
  private proxies: ProxyConfig[] = [];
  private lastUpdate?: number;
  private fetchingProxies = false;

  constructor(private config: ProxyPoolConfig) {}

  /**
   * Gets the current proxy list, refreshing if necessary
   * @param forceRefresh Force a refresh regardless of expiration
   * @returns Array of proxy configurations
   */
  async getProxies(forceRefresh = false): Promise<ProxyConfig[]> {
    if (this.fetchingProxies) {
      if (this.proxies.length > 0) {
        // Return potentially stale proxies
        return this.proxies;
      }
      // Wait for proxies to arrive in 200ms intervals
      await delay(200);
      return this.getProxies();
    }

    const shouldRefresh =
      forceRefresh ||
      !this.lastUpdate ||
      this.proxies.length === 0 ||
      Date.now() > this.lastUpdate + this.config.poolExpired;

    if (shouldRefresh) {
      this.fetchingProxies = true;
      try {
        const proxies = await this.config.fetchProxies();
        if (!Array.isArray(proxies)) {
          throw new Error('Proxies must be an array');
        }
        if (this.config.shuffle) {
          shuffle(proxies as Array<string | ProxyConfig>);
        }
        const formattedProxies = proxies.map(formatProxy);
        this.proxies = formattedProxies || [];
      } catch (err) {
        this.proxies = [];
        throw err;
      } finally {
        this.lastUpdate = Date.now();
        this.fetchingProxies = false;
      }
    }

    return this.proxies;
  }

  /**
   * Gets the current proxy count
   */
  getProxyCount(): number {
    return this.proxies.length;
  }
}
