const { respond } = await import('/app/dist/assistant.js');
const { db } = await import('/app/dist/db.js');
const turns = ['Nahitaji access point', 'Hauna model zingine?', 'Nahitaji access point ya mita 300',
  'Cudy AP 3000 ni ya ndani au nje, na ina ports ngapi?', 'TP LINK EAP 650 ina uwezo wa kwenda umbali gani?',
  'Ofisi yenu inapatikana wapi'];
const conversation = memory => ({ id: 'sim', account_id: 'sales', customer_jid: 'x@s.whatsapp.net',
  customer_phone: null, customer_name: null, mode: 'bot', stage: 'quoted', unread_count: 0,
  last_body: null, last_at: null, memory });
let memory = {};
try {
  for (const text of turns) {
    const out = await respond(db, conversation(memory), text, []);
    console.log('CUSTOMER:', text);
    console.log(out.body);
    console.log('---');
    memory = out.memory;
  }
} finally {
  await db.end();
}
