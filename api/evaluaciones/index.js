const https = require('https');
const url   = require('url');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.EVALUACIONES_LIST_ID;

function request(rawUrl, opts, body) {
    return new Promise(function(resolve, reject) {
        var u = url.parse(rawUrl);
        var req = https.request({
            hostname: u.hostname, path: u.path,
            method: opts.method || 'GET', headers: opts.headers || {}
        }, function(res) {
            var raw = '';
            res.on('data', function(c) { raw += c; });
            res.on('end', function() {
                resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, raw: raw });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function reply(context, status, obj) {
    context.res = { status: status, body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } };
}

module.exports = async function (context, req) {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID || !LIST_ID) {
        return reply(context, 500, { error: 'Faltan variables de entorno' });
    }

    // Obtener token
    var token;
    try {
        var tokenBody = 'grant_type=client_credentials'
            + '&client_id=' + encodeURIComponent(CLIENT_ID)
            + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
            + '&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default';
        var tokenRes = await request(
            'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token',
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) } },
            tokenBody
        );
        var tokenData = JSON.parse(tokenRes.raw);
        token = tokenData.access_token;
        if (!token) return reply(context, 500, { error: 'Token invalido: ' + tokenRes.raw.substring(0, 300) });
    } catch (e) {
        return reply(context, 500, { error: 'Error token: ' + e.message });
    }

    var authH = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
        try {
            var empresa = (req.query && req.query.empresa) ? req.query.empresa : '';
            var filter = empresa ? "&$filter=fields/Empresa eq '" + empresa.replace(/'/g, "''") + "'" : '';
            var r = await request(
                'https://graph.microsoft.com/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + '/items?expand=fields' + filter,
                { headers: authH }
            );
            if (!r.ok) return reply(context, r.status, { error: r.raw.substring(0, 500) });
            var data = JSON.parse(r.raw);
            var ev = (data.value || []).map(function(i) {
                return { id: i.id, empresa: i.fields.Empresa, estrellas: i.fields.Estrellas,
                    comentario: i.fields.Comentario, evaluador: i.fields.Evaluador, fecha: i.fields.FechaServicio };
            });
            reply(context, 200, ev);
        } catch (e) { reply(context, 500, { error: 'GET error: ' + e.message }); }

    } else if (req.method === 'POST') {
        try {
            var b = req.body || {};
            var fecha = b.fechaServicio ? b.fechaServicio + 'T00:00:00Z' : null;
            var payload = JSON.stringify({ fields: {
                Title: b.empresa || '', Empresa: b.empresa || '',
                Estrellas: Number(b.estrellas) || 0, Comentario: b.comentario || '',
                Evaluador: b.evaluador || '', FechaServicio: fecha
            }});
            var r2 = await request(
                'https://graph.microsoft.com/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + '/items',
                { method: 'POST', headers: Object.assign({}, authH, { 'Content-Length': Buffer.byteLength(payload) }) },
                payload
            );
            if (!r2.ok) return reply(context, r2.status, { error: r2.raw.substring(0, 500) });
            var created = JSON.parse(r2.raw);
            reply(context, 201, { id: created.id });
        } catch (e) { reply(context, 500, { error: 'POST error: ' + e.message }); }
    }
};
