import type { ProxyConfig } from '../types/index.js';

/**
 * Formats a proxy URL or object into a standardized ProxyConfig
 * @param proxy Proxy string or object
 * @returns Formatted proxy configuration
 */
export function formatProxy(proxy: string | ProxyConfig): ProxyConfig {
  if (typeof proxy === 'string') {
    return { url: proxy };
  } else if (typeof proxy === 'object' && proxy !== null) {
    // should have url or hostname
    return proxy;
  } else {
    return { url: '' };
  }
}
