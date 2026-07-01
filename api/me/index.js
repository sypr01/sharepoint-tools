const https = require('https');
const url = require('url');

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
                resolve({ status: res.statusCode, raw: buf.toString('utf8') });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getToken() {
    var body = 'grant_type=client_credentials'
        + '&client_id=' + encodeURIComponent(CLIENT_ID)
        + '&client_secret=' + encodeURIComponent(CLIENT_SECRET)
        + '&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default';
    var resp = await request(
        'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token',
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }},
        body
    );
    return JSON.parse(resp.raw).access_token;
}

module.exports = async function (context, req) {
    context.res = { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } };

    // Leer el principal de SWA auth
    var principal = req.headers['x-ms-client-principal'];
    var userEmail = null;

    if (principal) {
        try {
            var decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
            userEmail = decoded.userDetails;
        } catch(e) {}
    }

    // Fallback: email en query string (para pruebas)
    if (!userEmail && req.query && req.query.email) {
        userEmail = req.query.email;
    }

    if (!userEmail) {
        context.res.status = 401;
        context.res.body = JSON.stringify({ error: 'No autenticado' });
        return;
    }

    try {
        var token = await getToken();
        var fields = 'displayName,jobTitle,department,officeLocation,mobilePhone,businessPhones,mail,id';
        var resp = await request(
            'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(userEmail) + '?$select=' + fields,
            { headers: { Authorization: 'Bearer ' + token } }
        );
        var user = JSON.parse(resp.raw);

        // Obtener colegas de la misma división
        var division = user.officeLocation || '';
        var colegasResp = await request(
            'https://graph.microsoft.com/v1.0/users?$select=' + fields + '&$filter=officeLocation+eq+%27' + encodeURIComponent(division) + '%27&$top=8&$orderby=displayName',
            { headers: { Authorization: 'Bearer ' + token } }
        );
        var colegas = [];
        try { colegas = JSON.parse(colegasResp.raw).value || []; } catch(e) {}

        context.res.body = JSON.stringify({ user: user, colegas: colegas });
    } catch(e) {
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: e.message });
    }
};
