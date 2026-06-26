const https = require('https');
const url   = require('url');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.EVALUACIONES_LIST_ID;

module.exports = async function (context, req) {

    // — Diagnóstico: confirmar que la función corre y tiene las variables —
    if (req.method === 'GET' && req.query.diag === '1') {
        context.res = {
            status: 200,
            body: JSON.stringify({
                ok: true,
                hasTenant: !!TENANT_ID,
                hasClient: !!CLIENT_ID,
                hasSecret: !!CLIENT_SECRET,
                hasSite:   !!SITE_ID,
                hasList:   !!LIST_ID,
                node:      process.version
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    }

    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID || !LIST_ID) {
        context.res = {
            status: 500,
            body: JSON.stringify({ error: 'Faltan variables: '
                + [!TENANT_ID && 'TENANT_ID', !CLIENT_ID && 'CLIENT_ID',
                   !CLIENT_SECRET && 'CLIENT_SECRET', !SITE_ID && 'SITE_ID',
                   !LIST_ID && 'EVALUACIONES_LIST_ID'].filter(Boolean).join(', ') }),
            headers: { 'Content-Type': 'application/json' }
        };
        return;
    }

    // — Obtener token —
    var token;
    try {
        token = await new Promise((resolve, reject) => {
            const body = 'grant_type=client_credentials'
                + '&client_id=' + encodeURIComponent(CLIENT_ID)
                + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
                + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default');
            const u = url.parse('https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token');
            const req2 = https.request({
                hostname: u.hostname, path: u.path, method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
            }, res => {
                let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => {
                    try { const d = JSON.parse(raw); resolve(d.access_token || ('no_token:' + raw.substring(0,200))); }
                    catch(e) { resolve('parse_error:' + raw.substring(0,200)); }
                });
            });
            req2.on('error', e => reject(e));
            req2.write(body); req2.end();
        });
    } catch(e) {
        context.res = { status: 500, body: JSON.stringify({ error: 'token_error: ' + e.message }), headers: { 'Content-Type': 'application/json' } };
        return;
    }

    if (!token || token.startsWith('no_token') || token.startsWith('parse_error')) {
        context.res = { status: 500, body: JSON.stringify({ error: 'token_invalid: ' + token }), headers: { 'Content-Type': 'application/json' } };
        return;
    }

    const authH = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    function graphRequest(method, path2, bodyStr) {
        return new Promise((resolve, reject) => {
            const opts = {
                hostname: 'graph.microsoft.com',
                path: path2,
                method: method,
                headers: Object.assign({}, authH, bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
            };
            const req3 = https.request(opts, res => {
                let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => {
                    resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, raw: raw });
                });
            });
            req3.on('error', reject);
            if (bodyStr) req3.write(bodyStr);
            req3.end();
        });
    }

    if (req.method === 'GET') {
        try {
            const empresa = (req.query && req.query.empresa) ? req.query.empresa : '';
            const filter = empresa ? '&$filter=fields/Empresa eq \'' + empresa.replace(/'/g, "''") + '\'' : '';
            const r = await graphRequest('GET', '/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + '/items?expand=fields' + filter);
            if (!r.ok) { context.res = { status: r.status, body: JSON.stringify({ error: r.raw.substring(0,500) }), headers: { 'Content-Type': 'application/json' } }; return; }
            const data = JSON.parse(r.raw);
            const ev = (data.value || []).map(function(i) { return {
                id: i.id, empresa: i.fields.Empresa, estrellas: i.fields.Estrellas,
                comentario: i.fields.Comentario, evaluador: i.fields.Evaluador, fecha: i.fields.FechaServicio
            }; });
            context.res = { status: 200, body: JSON.stringify(ev), headers: { 'Content-Type': 'application/json' } };
        } catch(e) { context.res = { status: 500, body: JSON.stringify({ error: 'GET_error: ' + e.message }), headers: { 'Content-Type': 'application/json' } }; }

    } else if (req.method === 'POST') {
        try {
            const b = req.body || {};
            const fecha = b.fechaServicio ? b.fechaServicio + 'T00:00:00Z' : null;
            const payload = JSON.stringify({ fields: {
                Title:        b.empresa || '',
                Empresa:      b.empresa || '',
                Estrellas:    Number(b.estrellas) || 0,
                Comentario:   b.comentario || '',
                Evaluador:    b.evaluador || '',
                FechaServicio: fecha
            }});
            const r = await graphRequest('POST', '/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + '/items', payload);
            if (!r.ok) { context.res = { status: r.status, body: JSON.stringify({ error: r.raw.substring(0,500) }), headers: { 'Content-Type': 'application/json' } }; return; }
            const data = JSON.parse(r.raw);
            context.res = { status: 201, body: JSON.stringify({ id: data.id }), headers: { 'Content-Type': 'application/json' } };
        } catch(e) { context.res = { status: 500, body: JSON.stringify({ error: 'POST_error: ' + e.message }), headers: { 'Content-Type': 'application/json' } }; }
    }
};
