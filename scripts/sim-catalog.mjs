const { respond } = await import('/app/dist/assistant.js');
const client = { query: async () => ({ rows: [] }) };
const conv = (memory) => ({ id: 'sim', account_id: 'sales', customer_jid: 'x@s.whatsapp.net',
  customer_phone: null, customer_name: null, mode: 'bot', stage: 'inquiry', unread_count: 0,
  last_body: null, last_at: null, memory });
const a = await respond(client, conv({}), 'Nahitaji access point ya mita 300', []);
console.log('=== turn 1 ===');
console.log(a.body);
const b = await respond(client, conv({ productOptions: a.memory.productOptions, optionQuery: a.memory.optionQuery }), 'Hauna model zingine?', []);
console.log('=== turn 2 ===');
console.log(b.body);
const c = await respond(client, conv({ productOptions: b.memory.productOptions, optionQuery: b.memory.optionQuery }), 'TP LINK EAP 650', []);
console.log('=== turn 3 ===');
console.log(c.body);
