const https = require('https');
const url   = require('url');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.EVALUACIONES_LIST_ID;

function request(rawUrl, options, body) {
    return new Promise((resolve, reject) => {
        const u = url.parse(rawUrl);
        const reqOpts = {
            hostname: u.hostname,
            path: u.path,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        const req = https.request(reqOpts, res => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    text: raw,
                    json: () => JSON.parse(raw)
                });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getToken() {
    const body = 'grant_type=client_credentials'
        + '&client_id=' + encodeURIComponent(CLIENT_ID)
        + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
        + '&scope=' + encodeURIComponent('https://graph.microsoft.com/.default');
    const res = await request(
        'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token',
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
        body
    );
    const data = res.json();
    if (!data.access_token) throw new Error('Token error: ' + res.text);
    return data.access_token;
}

function errRes(context, status, msg) {
    context.res = { status: status, body: { error: msg }, headers: { 'Content-Type': 'application/json' } };
}

module.exports = async function (context, req) {
    // Verificar variables de entorno
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID || !LIST_ID) {
        return errRes(context, 500, 'Faltan variables de entorno: '
            + (!TENANT_ID ? 'TENANT_ID ' : '')
            + (!CLIENT_ID ? 'CLIENT_ID ' : '')
            + (!CLIENT_SECRET ? 'CLIENT_SECRET ' : '')
            + (!SITE_ID ? 'SITE_ID ' : '')
            + (!LIST_ID ? 'EVALUACIONES_LIST_ID' : ''));
    }

    var token;
    try { token = await getToken(); }
    catch (e) { return errRes(context, 500, 'getToken: ' + (e.message || String(e))); }

    const authHeaders = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
        try {
            const empresa = (req.query && req.query.empresa) ? req.query.empresa : '';
            const filter = empresa ? '&$filter=fields/Empresa eq \'' + empresa.replace(/'/g, "''") + '\'' : '';
            const res = await request(
                'https://graph.microsoft.com/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + '/items?expand=fields' + filter,
                { headers: authHeaders }
            );
            const data = res.json();
            const evaluaciones = (data.value || []).map(function(i) { return {
                id: i.id,
                empresa: i.fields.Empresa,
                estrellas: i.fields.Estrellas,
                comentario: i.fields.Comentario,
                evaluador: i.fields.Evaluador,
                fecha: i.fields.FechaServicio
            }; });
            context.res = { body: evaluaciones, headers: { 'Content-Type': 'application/json' } };
        } catch (e) { errRes(context, 500, 'GET: ' + (e.message || String(e))); }

    } else if (req.method === 'POST') {
        try {
            const b = req.body;
            if (!b) return errRes(context, 400, 'Body vacio');
            const fecha = b.fechaServicio ? b.fechaServicio + 'T00:00:00Z' : null;
            const payload = JSON.stringify({ fields: {
                Title: b.empresa || '',
                Empresa: b.empresa || '',
                Estrellas: Number(b.estrellas) || 0,
                Comentario: b.comentario || '',
                Evaluador: b.evaluador || '',
                FechaServicio: fecha
            }});
            const res = await request(
                'https://graph.microsoft.com/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + '/items',
                { method: 'POST', headers: Object.assign({}, authHeaders, { 'Content-Length': Buffer.byteLength(payload) }) },
                payload
            );
            const data = res.json();
            if (!res.ok) return errRes(context, res.status, JSON.stringify(data.error || data));
            context.res = { status: 201, body: { id: data.id }, headers: { 'Content-Type': 'application/json' } };
        } catch (e) { errRes(context, 500, 'POST: ' + (e.message || String(e))); }
    }
};
