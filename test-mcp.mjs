import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });

rl.on('close', () => process.exit(0));

async function send(id, method, params) {
    const req = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    rl.write(req + '\n');
}

let responseId = 1;

rl.on('line', async (line) => {
    try {
        const req = JSON.parse(line);
        if (req.id === 3) { // nav tool result
            console.log(JSON.stringify(req.result));
            rl.close();
            return;
        }
    } catch {}
});

send(1, 'initialize');
send(2, 'tools/list');
setTimeout(() => send(3, 'tools/call', { name: 'nav', arguments: { url: 'https://www.google.com/search?q=wireless+bluetooth+headphones' } }), 500);
