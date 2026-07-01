const https = require('https');
const url = require('url');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Divisiones válidas — el nombre del grupo en M365 debe contener alguna de estas claves
const DIVISIONES = [
    { key: 'PLG DE EL SALVADOR',    aliases: ['el salvador', 'plg els', 'plgels'] },
    { key: 'PLG DIVISION ADUANAS',  aliases: ['aduanas'] },
    { key: 'PLG DIVISION TERRESTRE',aliases: ['terrestre'] },
    { key: 'PLG DOMINICANA',        aliases: ['dominicana'] }
];

// Departamentos válidos
const DEPARTAMENTOS = ['Operaciones','Comercial','Finanzas','Pricing','Coordinacion','RRHH','Informatica','Administracion'];

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
                resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') });
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

// Deriva división desde nombre de grupo M365
function derivarDivision(groupNames) {
    for (var g of groupNames) {
        var gl = g.toLowerCase();
        for (var div of DIVISIONES) {
            if (gl.includes(div.key.toLowerCase())) return div.key;
            for (var alias of div.aliases) {
                if (gl.includes(alias)) return div.key;
            }
        }
    }
    return null;
}

// Deriva departamento desde nombre de grupo M365
function derivarDepartamento(groupNames) {
    for (var g of groupNames) {
        var gl = g.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        for (var dept of DEPARTAMENTOS) {
            var dl = dept.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (gl.includes(dl)) return dept;
        }
    }
    return null;
}

module.exports = async function (context, req) {
    context.res = { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } };

    var principal = req.headers['x-ms-client-principal'];
    var userEmail = null;
    if (principal) {
        try {
            var decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
            userEmail = decoded.userDetails;
        } catch(e) {}
    }
    if (!userEmail && req.query && req.query.email) userEmail = req.query.email;
    if (!userEmail) {
        context.res.status = 401;
        context.res.body = JSON.stringify({ error: 'No autenticado' });
        return;
    }

    try {
        var token = await getToken();
        var fields = 'displayName,jobTitle,department,officeLocation,mobilePhone,businessPhones,mail,id';

        // 1. Obtener perfil del usuario
        var resp = await request(
            'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(userEmail) + '?$select=' + fields,
            { headers: { Authorization: 'Bearer ' + token } }
        );
        var user = JSON.parse(resp.raw);

        // 2. Obtener grupos del usuario para derivar división y departamento
        var gruposResp = await request(
            'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(userEmail) + '/memberOf?$select=displayName&$top=50',
            { headers: { Authorization: 'Bearer ' + token } }
        );
        var grupos = [];
        try { grupos = (JSON.parse(gruposResp.raw).value || []).map(function(g){ return g.displayName || ''; }); } catch(e) {}

        // 3. Usar officeLocation/department del perfil; si faltan, derivar de grupos
        if (!user.officeLocation) {
            user.officeLocation = derivarDivision(grupos);
        }
        if (!user.department) {
            user.department = derivarDepartamento(grupos);
        }
        // Adjuntar lista de grupos para debug (el portal puede ignorarla)
        user._grupos = grupos;

        // 4. Colegas de la misma división
        var colegas = [];
        if (user.officeLocation) {
            var colegasResp = await request(
                'https://graph.microsoft.com/v1.0/users?$select=' + fields + '&$filter=officeLocation+eq+%27' + encodeURIComponent(user.officeLocation) + '%27&$top=8',
                { headers: { Authorization: 'Bearer ' + token } }
            );
            try { colegas = JSON.parse(colegasResp.raw).value || []; } catch(e) {}
        }

        context.res.body = JSON.stringify({ user: user, colegas: colegas });
    } catch(e) {
        context.res.status = 500;
        context.res.body = JSON.stringify({ error: e.message });
    }
};
