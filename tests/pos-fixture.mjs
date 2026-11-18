import { createServer } from 'node:http';

const product = { id: 'wr3000', name: 'Cudy WR3000', sku: 'WR3000', price: { amount: 95000, currency: 'TZS' } };
let reads = 0;
createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const result = (() => {
    switch (url.pathname) {
      case '/products': return { items: /^(?:cudy\s+)?wr3000$/i.test(url.searchParams.get('search') ?? '') ? [product] : [] };
      case '/products/wr3000': return { ...product, price: { amount: reads++ ? 99000 : 95000, currency: 'TZS' },
        images: [{ url: 'https://assets.example.test/wr3000.jpg', primary: true }] };
      case '/products/wr3000/availability': return { available_to_sell: 8 };
      case '/service-plans': return {
        items: url.searchParams.get('kind') === 'subscription' && url.searchParams.get('system') === 'lubfy'
          ? [{ name: 'Integration Test LubFy', price: { amount: 12345, currency: 'TZS' }, billing_period: 'MONTHLY' }]
          : [],
      };
      default: return null;
    }
  })();
  res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(result));
}).listen(9090, '0.0.0.0');
