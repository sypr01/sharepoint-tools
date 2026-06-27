const https = require('https');
const url   = require('url');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function request(rawUrl, opts, body) {
    return new Promise(function(resolve, reject) {
        var u = url.parse(rawUrl);
        var req = https.request({
            hostname: u.hostname, path: u.path,
            method: opts.method || 'GET', headers: opts.headers || {}
        }, function(res) {
            var chunks = [];
            res.on('data', function(c) { chunks.push(c); });
            res.on('end', function() {
                var buf = Buffer.concat(chunks);
                resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, buf: buf, raw: buf.toString('utf8') });
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

module.exports = async function (context, req) {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
        return reply(context, 500, { error: 'Faltan variables de entorno' });
    }

    var token;
    try { token = await getToken(); }
    catch (e) { return reply(context, 500, { error: 'Token: ' + e.message }); }

    var authH = { Authorization: 'Bearer ' + token };

    try {
        var fields = 'id,displayName,jobTitle,department,mail,businessPhones,officeLocation,companyName,accountEnabled';
        var graphUrl = 'https://graph.microsoft.com/v1.0/users?$select=' + fields + '&$top=999&$filter=accountEnabled eq true';

        var r = await request(graphUrl, { headers: authH });
        if (!r.ok) return reply(context, r.status, { error: r.raw.substring(0, 500) });

        var data = JSON.parse(r.raw);
        var usuarios = (data.value || [])
            .filter(function(u) { return u.mail && u.mail.includes('@plg'); })
            .map(function(u) {
                var tel = (u.businessPhones && u.businessPhones.length) ? u.businessPhones[0] : '';
                return {
                    id:          u.id,
                    nombre:      u.displayName || '',
                    cargo:       u.jobTitle    || '',
                    departamento: u.department  || '',
                    correo:      u.mail        || '',
                    telefono:    tel,
                    oficina:     u.officeLocation || u.companyName || ''
                };
            });

        // Obtener fotos en paralelo para todos los usuarios
        await Promise.all(usuarios.map(async function(u) {
            try {
                var fr = await request(
                    'https://graph.microsoft.com/v1.0/users/' + u.id + '/photo/$value',
                    { headers: Object.assign({}, authH, { Accept: 'image/jpeg' }) }
                );
                if (fr.ok && fr.buf.length > 0) {
                    u.foto = 'data:image/jpeg;base64,' + fr.buf.toString('base64');
                }
            } catch(e) { /* sin foto */ }
        }));

        reply(context, 200, usuarios);
    } catch (e) { reply(context, 500, { error: 'GET: ' + e.message }); }
};
