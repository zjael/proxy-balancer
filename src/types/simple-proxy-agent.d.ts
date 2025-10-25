declare module 'simple-proxy-agent' {
  interface ProxyAgentOptions {
    timeout?: number;
    [key: string]: unknown;
  }

  class ProxyAgent {
    constructor(proxy: string, options?: ProxyAgentOptions);
  }

  export = ProxyAgent;
}
