/**
 * Using proxy-balancer with axios
 *
 * This example shows how to use axios as the HTTP client
 * instead of the default node-fetch.
 */

const { Balancer } = require('proxy-balancer');
const axios = require('axios');

const balancer = new Balancer({
  // Use axios as the requestor
  requestor: axios,

  fetchProxies: async () => {
    return [
      'http://proxy1.example.com:8080',
      'http://proxy2.example.com:8080',
      'http://proxy3.example.com:8080',
    ];
  },

  timeout: 5000,
  maxConcurrent: 15,
});

async function main() {
  try {
    // When using axios, the response is an axios response
    const response = await balancer.request('https://api.ipify.org?format=json');

    // Access data directly from axios response
    console.log('Your IP:', response.data.ip);
    console.log('Status:', response.status);
    console.log('Headers:', response.headers);

    // Make a POST request
    const postResponse = await balancer.request('https://httpbin.org/post', {
      method: 'POST',
      data: {
        key: 'value',
        timestamp: Date.now(),
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('POST response:', postResponse.data);
  } catch (error) {
    if (error.response) {
      // Axios error with response
      console.error('Error status:', error.response.status);
      console.error('Error data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

main();
