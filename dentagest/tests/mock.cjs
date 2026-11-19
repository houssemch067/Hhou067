// Faux services pour les tests : API Claude (messages) et API WhatsApp Cloud (Graph)
const http = require('http');
const log = { claude: [], graph: [] };
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const usage = { input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (req.url === '/__log') return json(res, 200, log);
    if (req.url === '/__reset') { log.claude = []; log.graph = []; return json(res, 200, { ok: true }); }
    if (req.url.startsWith('/graph/')) { log.graph.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }); return json(res, 200, { messages: [{ id: 'wamid.x' }] }); }
    if (req.url === '/v1/messages') {
      const b = JSON.parse(body); log.claude.push(b);
      const sys = b.system.map((s) => s.text).join('\n');
      const last = b.messages[b.messages.length - 1];
      const msg = (content, stop) => json(res, 200, { id: 'msg_' + Date.now(), type: 'message', role: 'assistant', model: b.model, content, stop_reason: stop, stop_sequence: null, usage });
      if (Array.isArray(last.content) && last.content[0].type === 'tool_result')
        return msg([{ type: 'text', text: last.content[0].is_error ? 'Ce créneau n’est pas libre.' : 'C’est noté ✅ Le cabinet va vous confirmer sur WhatsApp.' }], 'end_turn');
      const t = String(last.content).toLowerCase();
      if (/rendez|rdv/.test(t)) {
        const m = /\((\d{4}-\d{2}-\d{2})\) : (\d{2}:\d{2})/.exec(sys);
        return msg([{ type: 'tool_use', id: 'tu_1', name: 'demande_rdv', input: { nom: 'Yacine Hamidi', motif: 'détartrage', date: m[1], heure: m[2] } }], 'tool_use');
      }
      if (/gonfl|urgen/.test(t)) return msg([{ type: 'tool_use', id: 'tu_2', name: 'urgence', input: { nom: null, resume: 'Joue gonflée et fièvre' } }], 'tool_use');
      const adr = (/- Adresse : (.*)/.exec(sys) || [])[1];
      return msg([{ type: 'text', text: 'Salam ! Le cabinet se trouve ' + adr + '.' }], 'end_turn');
    }
    json(res, 404, { error: 'mock' });
  });
}).listen(8790, '127.0.0.1', () => console.log('mock ready'));
