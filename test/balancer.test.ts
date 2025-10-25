import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Balancer } from '../src/index.js';
import ProxyAgent from 'simple-proxy-agent';
import http from 'node:http';
import { createProxyServer, delay } from './test-utils.js';
import axios from 'axios';
import got from 'got';
import tunnel from 'tunnel';

const ports = [4001, 4002, 4003, 4004];
const fetchProxies = (i?: number) =>
  i ? ['http://127.0.0.1:' + ports[i]] : ports.map((port) => 'http://127.0.0.1:' + port);

const createTestServer = () =>
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-type': 'text/plan' });
      res.write('test');
      res.end();
    })
    .listen(8080);

const createFailureServer = () =>
  http
    .createServer((req, res) => {
      res.statusCode = 500;
      res.write('fail');
      res.end();
    })
    .listen(8080);

describe('Proxy Balancer', () => {
  let servers: http.Server[];
  let singleServer: http.Server | undefined;

  beforeAll(() => {
    servers = ports.map((port) => createProxyServer().listen(port));
  });

  afterAll(() => {
    for (const server of servers) {
      server.close();
    }
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (singleServer) {
      singleServer.close();
      singleServer = undefined;
    }
  });

  describe('fetchProxies(..)', () => {
    it('should populate proxies using fetchProxies', async () => {
      const balancer = new Balancer({
        fetchProxies,
      });

      const proxies = await balancer.getProxies();
      for (const port of ports) {
        expect(proxies).toContainEqual({ url: 'http://127.0.0.1:' + port });
      }
    });

    it('should catch fetchProxies error', async () => {
      const errorMsg = 'Intended error';
      const balancer = new Balancer({
        fetchProxies() {
          throw new Error(errorMsg);
        },
      });

      await expect(balancer.request('http://test.com')).rejects.toThrow(errorMsg);
    });

    it('should catch empty proxy list error', async () => {
      const balancer = new Balancer({
        fetchProxies() {
          return [];
        },
      });

      await expect(balancer.request('http://test.com')).rejects.toThrow('Empty proxy list');
    });

    it('it should force refresh when passed true', async () => {
      let fProxies = fetchProxies();
      const balancer = new Balancer({
        fetchProxies: () => fProxies,
      });

      let proxies = await balancer.getProxies();
      for (const port of ports) {
        expect(proxies).toContainEqual({ url: 'http://127.0.0.1:' + port });
      }

      // set proxies to just 1
      fProxies = fetchProxies().slice(0, 1);

      // should return same proxies
      proxies = await balancer.getProxies();
      for (const port of ports) {
        expect(proxies).toContainEqual({ url: 'http://127.0.0.1:' + port });
      }
      expect(proxies.length).toBe(4);

      proxies = await balancer.getProxies(true);
      expect(proxies.length).toBe(1);
      expect(proxies).toContainEqual({ url: 'http://127.0.0.1:' + ports[0] });
      expect(proxies).not.toContainEqual({ url: 'http://127.0.0.1:' + ports[3] });
    });

    it('should shuffle proxies', async () => {
      const fProxies = fetchProxies();
      const balancer = new Balancer({
        fetchProxies: () => fProxies,
        shuffle: true,
      });

      const proxies = await balancer.getProxies();
      const proxyUrls = proxies.map((proxy) => proxy.url);
      const originalUrls = fetchProxies();

      // There's a small chance they could be in the same order after shuffling,
      // but with 4 items it's unlikely (1/24 = 4.16%)
      // We'll accept this small risk for a simpler test
      expect(proxyUrls).not.toEqual(originalUrls);
    });
  });

  describe('ip limiter', () => {
    it('should limit requests based on callsPerDuration', async () => {
      const duration = 100;
      const postDurationWait = 200;
      const balancer = new Balancer({
        limiter: {
          callsPerDuration: 2,
          duration,
          postDurationWait,
        },
        timeout: 0,
        fetchProxies: () => fetchProxies(1),
      });

      singleServer = createTestServer();

      const call = () => balancer.request('http://127.0.0.1:8080');

      await call();

      let proxies = await balancer.getProxies();
      let next = await balancer.nextProxyIndex(proxies);
      expect(next).toBe(0);

      await call();

      proxies = await balancer.getProxies();
      next = await balancer.nextProxyIndex(proxies);
      expect(next).toBe(null);

      let success = true;
      expect(success).toBe(true);

      let failure = false;
      try {
        await call();
      } catch {
        failure = true;
      }
      expect(failure).toBe(true);

      // wait partial duration and expect failure
      await delay(postDurationWait / 2);

      failure = false;
      try {
        await call();
      } catch {
        failure = true;
      }
      expect(failure).toBe(true);

      // wait full duration and expect success
      await delay(postDurationWait / 2);

      await call();
      expect(success).toBe(true);
    });

    it('goes to next proxy after limit reached', async () => {
      const duration = 100;
      const balancer = new Balancer({
        limiter: {
          callsPerDuration: 2,
          duration,
          postDurationWait: 1000,
        },
        timeout: 0,
        fetchProxies: () => fetchProxies(),
      });

      singleServer = createTestServer();

      const call = () => balancer.request('http://127.0.0.1:8080');

      let proxies = await balancer.getProxies();
      let next = await balancer.nextProxyIndex(proxies);
      expect(next).toBe(1);

      await call();

      proxies = await balancer.getProxies();
      next = await balancer.nextProxyIndex(proxies);
      expect(next).toBe(2);

      await call();

      proxies = await balancer.getProxies();
      next = await balancer.nextProxyIndex(proxies);
      expect(next).toBe(3);

      await call();

      proxies = await balancer.getProxies();
      next = await balancer.nextProxyIndex(proxies);
      // expect to reset to 0
      expect(next).toBe(0);
    });

    it('calls handleNoAvailableProxies when no available proxies', async () => {
      let noProxies = false;
      const duration = 100;
      const balancer = new Balancer({
        limiter: {
          callsPerDuration: 1,
          duration,
          postDurationWait: 1000,
        },
        timeout: 0,
        fetchProxies: () => fetchProxies(1),
        handleNoAvailableProxies: () => {
          noProxies = true;
        },
      });

      singleServer = createTestServer();

      const call = () => balancer.request('http://127.0.0.1:8080');

      await call();

      expect(noProxies).toBe(false);

      let fail = false;
      try {
        await call();
      } catch {
        fail = true;
      }
      expect(fail).toBe(true);

      expect(noProxies).toBe(true);
    });
  });

  describe('base functionalities', () => {
    it('should use new proxy on each request - round robin', async () => {
      const balancer = new Balancer({
        fetchProxies,
      });

      // first starts at index 0, getAndSetNext will increment
      const second = await balancer.getAndSetNext();
      const third = await balancer.getAndSetNext();

      expect(second).toEqual({ url: 'http://127.0.0.1:' + ports[1] });
      expect(third).toEqual({ url: 'http://127.0.0.1:' + ports[2] });
    });

    it('should send request using proxy', async () => {
      const balancer = new Balancer({
        fetchProxies,
      });

      singleServer = createTestServer();

      const res = await balancer.request('http://127.0.0.1:8080');
      const body = await res.text!();
      expect(body).toBe('test');
    });
  });

  describe('different requestors', () => {
    it('should make requests successfully with axios', async () => {
      const balancer = new Balancer({
        requestor: axios as any,
        fetchProxies,
      });

      singleServer = createTestServer();

      const res = await balancer.request('http://127.0.0.1:8080');
      const body = res.data;
      expect(body).toBe('test');
    });

    it('should make requests successfully with got', async () => {
      const balancer = new Balancer({
        requestor: got as any,
        agentFn: ({ proxy, timeout }) => ({
          https: new ProxyAgent(proxy.url, {
            timeout,
          }),
        }),
        fetchProxies,
      });

      singleServer = createTestServer();

      const res = await balancer.request('http://127.0.0.1:8080');
      const body = res.body;
      expect(body).toBe('test');
    });
  });

  describe('different proxy agents', () => {
    it('should make requests successfully with tunnel', async () => {
      const balancer = new Balancer({
        requestor: axios as any,
        agentFn() {
          const agent = tunnel.httpsOverHttp({
            proxy: {
              host: '127.0.0.1',
              port: ports[0]!,
              headers: {
                'User-Agent': 'Node',
              },
            },
          });
          return agent;
        },
        fetchProxies,
      });

      singleServer = createTestServer();

      const res = await balancer.request('http://127.0.0.1:8080');
      const body = res.data;
      expect(body).toBe('test');
    });
  });

  describe('validateFn(..)', () => {
    it('should pass if true', async () => {
      const balancer = new Balancer({
        validateFn: () => {
          return true;
        },
        retryFn: ({}, { abort }) => {
          return abort();
        },
        fetchProxies,
      });

      singleServer = createTestServer();

      const res = await balancer.request('http://127.0.0.1:8080');
      const body = await res.text!();
      expect(body).toBe('test');
    });

    it('should fail if false', async () => {
      let err: Error | undefined;
      const balancer = new Balancer({
        validateFn: () => {
          return false;
        },
        retryFn: ({ error }, { abort }) => {
          err = error;
          return abort();
        },
        fetchProxies,
      });

      singleServer = createTestServer();

      const requestSpy = vi.spyOn(balancer, 'request');

      try {
        await balancer.request('http://127.0.0.1:8080');
      } catch {
        expect(requestSpy).toHaveBeenCalledOnce();
        expect(err?.message).toBe('Response was not valid');
      }
    });

    it('should fail on error', async () => {
      let err: Error | undefined;

      const message = 'test';
      const balancer = new Balancer({
        validateFn: () => {
          throw new Error(message);
        },
        retryFn: ({ error }, { abort }) => {
          err = error;
          return abort();
        },
        fetchProxies,
      });

      singleServer = createTestServer();

      const requestSpy = vi.spyOn(balancer, 'request');

      try {
        await balancer.request('http://127.0.0.1:8080');
      } catch {
        expect(requestSpy).toHaveBeenCalledOnce();
        expect(err?.message).toBe(message);
      }
    });
  });

  describe('retryFn(..)', () => {
    it('aborts and returns error', async () => {
      let err: Error | undefined;
      const balancer = new Balancer({
        retryFn: async ({ error }, { abort }) => {
          err = error;
          return abort();
        },
        fetchProxies,
      });

      singleServer = createFailureServer();

      const requestSpy = vi.spyOn(balancer, 'request');

      try {
        await balancer.request('http://127.0.0.1:8080');
      } catch {
        const message = await (err as any).response.text();
        expect(requestSpy).toHaveBeenCalledOnce();
        expect(message).toBe('fail');
      }
    });

    it('retryNextIp should include retryCount, timesThisIpRetried, and ipsTried correctly', async () => {
      let ipsTriedVal: number | undefined;
      let retryCountVal: number | undefined;
      let timesThisIpRetriedVal: number | undefined;
      const balancer = new Balancer({
        retryFn: ({ retryCount, timesThisIpRetried, ipsTried }, { retryNextIp, abort }) => {
          retryCountVal = retryCount;
          ipsTriedVal = ipsTried;
          timesThisIpRetriedVal = timesThisIpRetried;
          return retryCount >= 2 ? abort() : retryNextIp();
        },
        fetchProxies,
      });

      singleServer = createFailureServer();

      const requestSpy = vi.spyOn(balancer, 'request');

      try {
        await balancer.request('http://127.0.0.1:8080');
      } catch {
        expect(requestSpy).toHaveBeenCalledTimes(3);
        expect(ipsTriedVal).toBe(3);
        expect(retryCountVal).toBe(2);
        expect(timesThisIpRetriedVal).toBe(0);
      }
    });

    it('retrySameIp should include retryCount, timesThisIpRetried, and ipsTried correctly', async () => {
      let ipsTriedVal: number | undefined;
      let retryCountVal: number | undefined;
      let timesThisIpRetriedVal: number | undefined;
      const balancer = new Balancer({
        retryFn: ({ retryCount, timesThisIpRetried, ipsTried }, { retrySameIp, abort }) => {
          retryCountVal = retryCount;
          ipsTriedVal = ipsTried;
          timesThisIpRetriedVal = timesThisIpRetried;
          return retryCount >= 2 ? retrySameIp() : retrySameIp();
        },
        fetchProxies,
      });

      singleServer = createFailureServer();

      const requestSpy = vi.spyOn(balancer, 'request');

      try {
        await balancer.request('http://127.0.0.1:8080');
      } catch {
        expect(requestSpy).toHaveBeenCalledTimes(3);
        expect(ipsTriedVal).toBe(1);
        expect(retryCountVal).toBe(2);
        expect(timesThisIpRetriedVal).toBe(2);
      }
    });
  });
});
