const { respond } = await import('/app/dist/assistant.js');
const client = { query: async () => ({ rows: [] }) };
const conv = (memory, stage = 'inquiry') => ({ id: 'sim', account_id: 'sales',
  customer_jid: 'x@s.whatsapp.net', customer_phone: null, customer_name: null, mode: 'bot',
  stage, unread_count: 0, last_body: null, last_at: null, memory });
const said = process.argv.slice(2);
let memory = {};
for (const text of said) {
  const out = await respond(client, conv(memory, 'quoted'), text, []);
  console.log('### CUSTOMER:', text);
  console.log(out.body);
  console.log('');
  memory = out.memory;
}
