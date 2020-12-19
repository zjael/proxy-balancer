const Balancer = require('../lib/balancer');
const chai = require('chai');
const ProxyAgent = require('simple-proxy-agent');
const chaiAsPromised = require('chai-as-promised');
const http = require('http');
const utils = require('./test-utils');
const axios = require('axios')
const got = require('got')
const tunnel = require('tunnel')
const sinon = require('sinon')

const retryOptions = Balancer.retryOptions
const expect = chai.expect;
chai.use(chaiAsPromised);

const ports = [
  4001,
  4002,
  4003,
  4004
]
const fetchProxies = () => ports.map(port => 'http://127.0.0.1:' + port)

describe('Proxy Balancer', () => {
  let servers;
  let singleServer;

  before(done => {
    servers = ports.map(port => utils.createProxyServer().listen(port));
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

  it('should use new proxy on each request - round robin', async () => {
    const balancer = new Balancer({
      fetchProxies
    });

    const first = await balancer.getNext();
    const second = await balancer.getNext();

    expect(first).to.deep.equal({ url: 'http://127.0.0.1:' + ports[0] });
    expect(second).to.deep.equal({ url: 'http://127.0.0.1:' + ports[1] });
  });

  it('should send request using proxy', (done) => {
    const balancer = new Balancer({
      fetchProxies
    });

    singleServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-type': 'text/plan' });
      res.write('test');
      res.end();
    }).listen(8080);

    balancer.request('http://127.0.0.1:8080')
      .then(res => res.text())
      .then(body => {
        expect(body).to.equal('test')
        done();
      })
  });

  context('different requestors', () => {
    it('should make requests successfully with axios', (done) => {
      const balancer = new Balancer({
        requestor: axios,
        fetchProxies
      });

      singleServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-type': 'text/plan' });
        res.write('test');
        res.end();
      }).listen(8080);

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

      singleServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-type': 'text/plan' });
        res.write('test');
        res.end();
      }).listen(8080);

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

      singleServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-type': 'text/plan' });
        res.write('test');
        res.end();
      }).listen(8080);

      balancer.request('http://127.0.0.1:8080')
        .then(res => res.data)
        .then(body => {
          expect(body).to.equal('test')
          done();
        })
    });
  })

  context('retryFn(..)', () => {
    it('should abort when passing abort', async () => {
      const balancer = new Balancer({
        retryFn: ({ error, retryCount, timesThisIpRetried, ipsTried }) => {
          return retryOptions.abort
        },
        fetchProxies
      });

      singleServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-type': 'text/plan' });
        res.write('test');
        res.end();
      }).listen(8080);

      // creates function wrapper
      sinon.spy(balancer, 'request')

      await balancer.request('http://127.0.0.1:8080')

      expect(balancer.request.calledOnce).to.be.true
    });
  })
});