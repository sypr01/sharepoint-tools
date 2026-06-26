const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.PROVEEDORES_LIST_ID;

async function getToken() {
    const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            scope: "https://graph.microsoft.com/.default"
        })
    });
    const data = await res.json();
    return data.access_token;
}

module.exports = async function (context, req) {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    if (req.method === "GET") {
        const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items?expand=fields&$top=500`, { headers });
        const data = await res.json();
        const proveedores = (data.value || []).map(i => ({
            id: i.id,
            empresa: i.fields.Empresa,
            tipo: i.fields.TipoServicio,
            contacto: i.fields.Contacto,
            telefono: i.fields.Telefono,
            correo: i.fields.Correo,
            cargo: i.fields.Cargo,
            direccion: i.fields.Direccion,
            web: i.fields.SitioWeb
        }));
        context.res = { body: proveedores, headers: { "Content-Type": "application/json" } };

    } else if (req.method === "POST") {
        const b = req.body;
        const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items`, {
            method: "POST", headers,
            body: JSON.stringify({ fields: {
                Title: b.empresa,
                Empresa: b.empresa,
                TipoServicio: b.tipo,
                Contacto: b.contacto,
                Telefono: b.telefono,
                Correo: b.correo,
                Cargo: b.cargo,
                Direccion: b.direccion,
                SitioWeb: b.web
            }})
        });
        const data = await res.json();
        context.res = { status: 201, body: { id: data.id }, headers: { "Content-Type": "application/json" } };
    }
};
