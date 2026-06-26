const https = require('https');
const url   = require('url');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.PROVEEDORES_LIST_ID;

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

async function getToken() {
    var body = 'grant_type=client_credentials'
        + '&client_id=' + encodeURIComponent(CLIENT_ID)
        + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
        + '&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default';
    var r = await request(
        'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token',
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
        body
    );
    var d = JSON.parse(r.raw);
    if (!d.access_token) throw new Error('Token invalido: ' + r.raw.substring(0, 200));
    return d.access_token;
}

function graphUrl(path) {
    return 'https://graph.microsoft.com/v1.0/sites/' + SITE_ID + '/lists/' + LIST_ID + path;
}

async function crearItem(authH, empresa, tipo, web, direccion, contacto) {
    var payload = JSON.stringify({ fields: {
        Title:       empresa,
        Empresa:     empresa,
        TipoServicio: tipo     || '',
        SitioWeb:    web       || '',
        Direccion:   direccion || '',
        Contacto:    contacto.contacto  || '',
        Cargo:       contacto.cargo     || '',
        Telefono:    contacto.telefono  || '',
        Correo:      contacto.correo    || ''
    }});
    return await request(
        graphUrl('/items'),
        { method: 'POST', headers: Object.assign({}, authH, { 'Content-Length': Buffer.byteLength(payload) }) },
        payload
    );
}

async function borrarItemsPorEmpresa(authH, empresaNombre) {
    var r = await request(graphUrl('/items?expand=fields&$top=500'), { headers: authH });
    if (!r.ok) return;
    var data = JSON.parse(r.raw);
    var nombre = empresaNombre.toLowerCase().trim();
    var aEliminar = (data.value || []).filter(function(i) {
        return (i.fields.Empresa || i.fields.Title || '').toLowerCase().trim() === nombre;
    });
    for (var i = 0; i < aEliminar.length; i++) {
        await request(graphUrl('/items/' + aEliminar[i].id), { method: 'DELETE', headers: authH });
    }
    return aEliminar.length;
}

module.exports = async function (context, req) {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_ID || !LIST_ID) {
        return reply(context, 500, { error: 'Faltan variables de entorno' });
    }

    var token;
    try { token = await getToken(); }
    catch (e) { return reply(context, 500, { error: 'Token: ' + e.message }); }

    var authH = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    // ── GET: listar todos los proveedores ──────────────────────────
    if (req.method === 'GET') {
        try {
            var r = await request(graphUrl('/items?expand=fields&$top=500'), { headers: authH });
            if (!r.ok) return reply(context, r.status, { error: r.raw.substring(0, 500) });
            var data = JSON.parse(r.raw);
            var items = (data.value || []).map(function(i) { return {
                id: i.id,
                empresa:   i.fields.Empresa   || i.fields.Title || '',
                tipo:      i.fields.TipoServicio || '',
                contacto:  i.fields.Contacto  || '',
                cargo:     i.fields.Cargo     || '',
                telefono:  i.fields.Telefono  || '',
                correo:    i.fields.Correo    || '',
                direccion: i.fields.Direccion || '',
                web:       i.fields.SitioWeb  || ''
            }; });
            reply(context, 200, items);
        } catch (e) { reply(context, 500, { error: 'GET: ' + e.message }); }

    // ── POST: crear empresa con uno o varios contactos ─────────────
    } else if (req.method === 'POST') {
        try {
            var b = req.body || {};
            var contactos = (b.contactos && b.contactos.length) ? b.contactos : [{}];
            for (var i = 0; i < contactos.length; i++) {
                var r2 = await crearItem(authH, b.empresa, b.tipo, b.web, b.direccion, contactos[i]);
                if (!r2.ok) return reply(context, r2.status, { error: r2.raw.substring(0, 500) });
            }
            reply(context, 201, { created: contactos.length });
        } catch (e) { reply(context, 500, { error: 'POST: ' + e.message }); }

    // ── PUT: reemplazar empresa (borrar + recrear) ─────────────────
    } else if (req.method === 'PUT') {
        try {
            var b = req.body || {};
            var empresaVieja = (req.query && req.query.empresa) ? req.query.empresa : b.empresa;
            await borrarItemsPorEmpresa(authH, empresaVieja);
            var contactos = (b.contactos && b.contactos.length) ? b.contactos : [{}];
            for (var i = 0; i < contactos.length; i++) {
                var r3 = await crearItem(authH, b.empresa, b.tipo, b.web, b.direccion, contactos[i]);
                if (!r3.ok) return reply(context, r3.status, { error: r3.raw.substring(0, 500) });
            }
            reply(context, 200, { updated: contactos.length });
        } catch (e) { reply(context, 500, { error: 'PUT: ' + e.message }); }

    // ── DELETE: eliminar empresa completa ──────────────────────────
    } else if (req.method === 'DELETE') {
        try {
            var empresaNombre = (req.query && req.query.empresa) ? req.query.empresa : '';
            if (!empresaNombre) return reply(context, 400, { error: 'Falta empresa' });
            var eliminados = await borrarItemsPorEmpresa(authH, empresaNombre);
            reply(context, 200, { deleted: eliminados });
        } catch (e) { reply(context, 500, { error: 'DELETE: ' + e.message }); }
    }
};
