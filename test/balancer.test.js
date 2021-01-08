const Balancer = require('../lib/balancer');
const chai = require('chai');
const ProxyAgent = require('simple-proxy-agent');
const chaiAsPromised = require('chai-as-promised');
const http = require('http');
const { createProxyServer, delay } = require('./test-utils');
const axios = require('axios')
const got = require('got')
const tunnel = require('tunnel')
const sinon = require('sinon')

const expect = chai.expect;
chai.use(chaiAsPromised);

const ports = [
  4001,
  4002,
  4003,
  4004
]
const fetchProxies = (i) => (i ? ['http://127.0.0.1:' + ports[i]] : ports.map(port => 'http://127.0.0.1:' + port))
const createTestServer = () => http.createServer((req, res) => {
  res.writeHead(200, { 'Content-type': 'text/plan' });
  res.write('test');
  res.end();
}).listen(8080);
const createFailureServer = () => http.createServer((req, res) => {
  res.statusCode = 500
  res.write('fail');
  res.end();
}).listen(8080);

describe('Proxy Balancer', () => {
  let servers;
  let singleServer;

  before(done => {
    servers = ports.map(port => createProxyServer().listen(port));
    done();
  });

  after(done => {
    for (const server of servers) {
      server.close();
    }
    sinon.restore();
    done();
  })

  afterEach(done => {
    if (singleServer) singleServer.close()
    done();
  })

  context('fetchProxies(..)', () => {
    it('should populate proxies using fetchProxies', (done) => {
      const balancer = new Balancer({
        fetchProxies
      });

      balancer.getProxies().then(proxies => {
        for (const port of ports) {
          expect(proxies).to.deep.include({ url: 'http://127.0.0.1:' + port });
        }
        done();
      });
    });

    it('should catch fetchProxies error', async () => {
      const errorMsg = "Intended error";
      const balancer = new Balancer({
        fetchProxies() {
          throw new Error(errorMsg);
        }
      });

      await expect(balancer.request()).to.be.rejectedWith(errorMsg);
    });

    it('should catch empty proxy list error', async () => {
      const balancer = new Balancer({
        fetchProxies() {
          return [];
        }
      });

      await expect(balancer.request()).to.be.rejectedWith("Empty proxy list");
    });

    it('it should force refresh when passed true', async () => {
      let fProxies = fetchProxies()
      const balancer = new Balancer({
        fetchProxies: () => fProxies
      });

      let proxies = await balancer.getProxies()
      for (const port of ports) {
        expect(proxies).to.deep.include({ url: 'http://127.0.0.1:' + port });
      }

      // set proxies to just 1
      fProxies = fetchProxies().slice(0, 1)

      // should return same proxies
      proxies = await balancer.getProxies()
      for (const port of ports) {
        expect(proxies).to.deep.include({ url: 'http://127.0.0.1:' + port });
      }
      expect(proxies.length).to.equal(4)

      proxies = await balancer.getProxies(true)
      expect(proxies.length).to.equal(1)
      expect(proxies).to.deep.include({ url: 'http://127.0.0.1:' + ports[0] });
      expect(proxies).to.not.deep.include({ url: 'http://127.0.0.1:' + ports[4] });
    });

    it('should shuffle proxies', async () => {
      const fProxies = fetchProxies()
      const balancer = new Balancer({
        fetchProxies: () => fProxies,
        shuffle: true
      });

      const proxies = await balancer.getProxies();
      expect(proxies.map(proxy => proxy.url)).to.not.have.deep.ordered.members(fetchProxies());
    });
  })

  context('ip limiter', () => {
    it('should limit requests based on callsPerDuration', async () => {
      let next, proxies
      const duration = 100
      const postDurationWait = 200
      const balancer = new Balancer({
        limiter: {
          callsPerDuration: 2,
          duration,
          postDurationWait
        },
        timeout: 0,
        fetchProxies: () => fetchProxies(1)
      });

      singleServer = createTestServer()

      const call = () => balancer.request('http://127.0.0.1:8080')

      await call()

      proxies = await balancer.getProxies()
      next = await balancer.nextProxyIndex(proxies)
      expect(next).to.equal(0)

      await call()

      proxies = await balancer.getProxies()
      next = await balancer.nextProxyIndex(proxies)
      expect(next).to.equal(null)

      const success = true
      expect(success).to.be.true

      failure = false
      try {
        await call()
      } catch (err) {
        failure = true
      }
      expect(failure).to.be.true

      // wait partial duration and expect failure
      await delay(postDurationWait / 2)

      failure = false
      try {
        await call()
      } catch {
        failure = true
      }
      expect(failure).to.be.true

      // wait full duration and expect success
      await delay(postDurationWait / 2)

      await call()
      expect(success).to.be.true
    })

    it('goes to next proxy after limit reached', async () => {
      let next, proxies
      const duration = 100
      const balancer = new Balancer({
        callsPerDuration: 2,
        duration,
        timeout: 0,
        postDurationWait: 1000,
        fetchProxies: () => fetchProxies()
      });

      singleServer = createTestServer()

      const call = () => balancer.request('http://127.0.0.1:8080')

      proxies = await balancer.getProxies()
      next = await balancer.nextProxyIndex(proxies)
      expect(next).to.equal(1)

      await call()

      proxies = await balancer.getProxies()
      next = await balancer.nextProxyIndex(proxies)
      expect(next).to.equal(2)


      await call()

      proxies = await balancer.getProxies()
      next = await balancer.nextProxyIndex(proxies)
      expect(next).to.equal(3)

      await call()

      proxies = await balancer.getProxies()
      next = await balancer.nextProxyIndex(proxies)
      // expect to reset to 0
      expect(next).to.equal(0)
    })

    it('calls handleNoAvailableProxies when no available proxies', async () => {
      let noProxies
      const duration = 100
      const balancer = new Balancer({
        limiter: {
          callsPerDuration: 1,
          duration,
          postDurationWait: 1000,
        },
        timeout: 0,
        fetchProxies: () => fetchProxies(1),
        handleNoAvailableProxies: () => {
          noProxies = true
        }
      });

      singleServer = createTestServer()

      const call = () => balancer.request('http://127.0.0.1:8080')

      await call()

      expect(!noProxies).to.be.true

      let fail = false
      try {
        await call()
      } catch {
        fail = true
      }
      expect(fail).to.be.true

      expect(noProxies).to.be.true
    })
  })

  context('base functionalities', () => {
    it('should use new proxy on each request - round robin', async () => {
      const balancer = new Balancer({
        fetchProxies
      });

      // first starts at index 0, getAndSetNext will increment
      const second = await balancer.getAndSetNext();
      const third = await balancer.getAndSetNext();

      expect(second).to.deep.equal({ url: 'http://127.0.0.1:' + ports[1] });
      expect(third).to.deep.equal({ url: 'http://127.0.0.1:' + ports[2] });
    });

    it('should send request using proxy', (done) => {
      const balancer = new Balancer({
        fetchProxies
      });

      singleServer = createTestServer()

      balancer.request('http://127.0.0.1:8080')
        .then(res => res.text())
        .then(body => {
          expect(body).to.equal('test')
          done();
        })
    });
  })

  context('different requestors', () => {
    it('should make requests successfully with axios', (done) => {
      const balancer = new Balancer({
        requestor: axios,
        fetchProxies
      });

      singleServer = createTestServer()

      balancer.request('http://127.0.0.1:8080')
        .then(res => res.data)
        .then(body => {
          expect(body).to.equal('test')
          done();
        })
    });

    it('should make requests successfully with got', (done) => {
      const balancer = new Balancer({
        requestor: got,
        agentFn: ({ proxy, timeout }) => ({
          https: new ProxyAgent(proxy.url, {
            timeout
          })
        }),
        fetchProxies
      });

      singleServer = createTestServer()

      balancer.request('http://127.0.0.1:8080')
        .then(res => res.body)
        .then(body => {
          expect(body).to.equal('test')
          done();
        })
    });
  })

  context('different proxy agents', () => {
    it('should make requests successfully with tunnel', (done) => {
      const balancer = new Balancer({
        requestor: axios,
        agentFn() {
          const agent = tunnel.httpsOverHttp({
            proxy: {
              host: '127.0.0.1',
              port: ports[0],
              headers: {
                'User-Agent': 'Node'
              }
            }
          })
          return agent
        },
        fetchProxies
      });

      singleServer = createTestServer()

      balancer.request('http://127.0.0.1:8080')
        .then(res => res.data)
        .then(body => {
          expect(body).to.equal('test')
          done();
        })
    });
  })

  context('validateFn(..)', () => {
    it('should pass if true', (done) => {
      const balancer = new Balancer({
        validateFn: (res) => {
          return true;
        },
        retryFn: ({ }, { abort }) => {
          return abort();
        },
        fetchProxies
      });

      singleServer = createTestServer()

      balancer.request('http://127.0.0.1:8080')
        .then(res => res.text())
        .then(body => {
          expect(body).to.equal('test')
          done();
        })
    });

    it('should fail if false', async () => {
      let err
      const balancer = new Balancer({
        validateFn: (res) => {
          return false;
        },
        retryFn: ({ error }, { abort }) => {
          err = error;
          return abort();
        },
        fetchProxies
      });

      singleServer = createTestServer()

      // creates function wrapper
      sinon.spy(balancer, 'request')

      try {
        await balancer.request('http://127.0.0.1:8080')
      } catch {
        expect(balancer.request.calledOnce).to.be.true
        expect(err.message).to.equal('Response was not valid')
      }
    })

    it('should fail on error', async () => {
      let err

      const message = "test";
      const balancer = new Balancer({
        validateFn: (res) => {
          throw new Error(message);
        },
        retryFn: ({ error }, { abort }) => {
          err = error;
          return abort();
        },
        fetchProxies
      });

      singleServer = createTestServer()

      // creates function wrapper
      sinon.spy(balancer, 'request')

      try {
        await balancer.request('http://127.0.0.1:8080')
      } catch {
        expect(balancer.request.calledOnce).to.be.true
        expect(err.message).to.equal(message)
      }
    })
  })

  context('retryFn(..)', () => {
    it('aborts and returns error', async () => {
      let err
      const balancer = new Balancer({
        retryFn: async ({ error, retryCount, timesThisIpRetried, ipsTried }, { abort }) => {
          err = error
          return abort();
        },
        fetchProxies
      });

      singleServer = createFailureServer()

      // creates function wrapper
      sinon.spy(balancer, 'request')

      try {
        await balancer.request('http://127.0.0.1:8080')
      } catch {
        const message = await err.response.text();
        expect(balancer.request.calledOnce).to.be.true
        expect(message).to.equal('fail')
      }
    });

    it('retryNextIp should include retryCount, timesThisIpRetried, and ipsTried correctly', async () => {
      let ipsTriedVal
      let retryCountVal
      let timesThisIpRetriedVal
      const balancer = new Balancer({
        retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }, { retryNextIp, abort }) => {
          retryCountVal = retryCount
          ipsTriedVal = ipsTried
          timesThisIpRetriedVal = timesThisIpRetried
          return retryCount >= 2 ? abort() : retryNextIp()
        },
        fetchProxies
      });

      singleServer = createFailureServer()

      // creates function wrapper
      sinon.spy(balancer, 'request')

      try {
        await balancer.request('http://127.0.0.1:8080')
      } catch {
        expect(balancer.request.calledThrice).to.be.true
        expect(ipsTriedVal).to.equal(3)
        expect(retryCountVal).to.equal(2)
        expect(timesThisIpRetriedVal).to.equal(0)
      }
    });

    it('retrySameIp should include retryCount, timesThisIpRetried, and ipsTried correctly', async () => {
      let ipsTriedVal
      let retryCountVal
      let timesThisIpRetriedVal
      const balancer = new Balancer({
        retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }, { retrySameIp, abort }) => {
          retryCountVal = retryCount
          ipsTriedVal = ipsTried
          timesThisIpRetriedVal = timesThisIpRetried
          return retryCount >= 2 ? abort() : retrySameIp()
        },
        fetchProxies
      });

      singleServer = createFailureServer()

      // creates function wrapper
      sinon.spy(balancer, 'request')

      try {
        await balancer.request('http://127.0.0.1:8080')
      } catch {
        expect(balancer.request.calledThrice).to.be.true
        expect(ipsTriedVal).to.equal(1)
        expect(retryCountVal).to.equal(2)
        expect(timesThisIpRetriedVal).to.equal(2)
      }
    });
  })
});