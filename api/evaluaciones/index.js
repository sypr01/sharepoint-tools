const https = require('https');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.EVALUACIONES_LIST_ID;

function request(url, options, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        }, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => resolve({
                status: res.statusCode,
                ok: res.statusCode >= 200 && res.statusCode < 300,
                json: () => JSON.parse(raw)
            }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getToken() {
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default'
    }).toString();
    const res = await request(
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
        body
    );
    return res.json().access_token;
}

module.exports = async function (context, req) {
    try {
        const token = await getToken();
        const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

        if (req.method === 'GET') {
            const empresa = req.query.empresa || '';
            const filter = empresa ? `&$filter=fields/Empresa eq '${empresa.replace(/'/g, "''")}'` : '';
            const res = await request(
                `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items?expand=fields${filter}`,
                { headers: authHeaders }
            );
            const data = res.json();
            const evaluaciones = (data.value || []).map(i => ({
                id: i.id,
                empresa: i.fields.Empresa,
                estrellas: i.fields.Estrellas,
                comentario: i.fields.Comentario,
                evaluador: i.fields.Evaluador,
                fecha: i.fields.FechaServicio
            }));
            context.res = { body: evaluaciones, headers: { 'Content-Type': 'application/json' } };

        } else if (req.method === 'POST') {
            const b = req.body;
            const fecha = b.fechaServicio ? b.fechaServicio + 'T00:00:00Z' : null;
            const payload = JSON.stringify({ fields: {
                Title: b.empresa,
                Empresa: b.empresa,
                Estrellas: Number(b.estrellas),
                Comentario: b.comentario || '',
                Evaluador: b.evaluador,
                FechaServicio: fecha
            }});
            const res = await request(
                `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items`,
                { method: 'POST', headers: { ...authHeaders, 'Content-Length': Buffer.byteLength(payload) } },
                payload
            );
            const data = res.json();
            if (!res.ok) {
                context.res = { status: res.status, body: { error: data.error || data }, headers: { 'Content-Type': 'application/json' } };
                return;
            }
            context.res = { status: 201, body: { id: data.id }, headers: { 'Content-Type': 'application/json' } };
        }
    } catch (e) {
        context.res = { status: 500, body: { error: e.message, stack: e.stack }, headers: { 'Content-Type': 'application/json' } };
    }
};
