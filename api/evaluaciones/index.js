const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_ID       = process.env.SITE_ID;
const LIST_ID       = process.env.EVALUACIONES_LIST_ID;

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
    try {
        const token = await getToken();
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

        if (req.method === "GET") {
            const empresa = req.query.empresa || "";
            const filter = empresa ? `&$filter=fields/Empresa eq '${empresa.replace(/'/g, "''")}'` : "";
            const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items?expand=fields${filter}`, { headers });
            const data = await res.json();
            const evaluaciones = (data.value || []).map(i => ({
                id: i.id,
                empresa: i.fields.Empresa,
                estrellas: i.fields.Estrellas,
                comentario: i.fields.Comentario,
                evaluador: i.fields.Evaluador,
                fecha: i.fields.FechaServicio
            }));
            context.res = { body: evaluaciones, headers: { "Content-Type": "application/json" } };

        } else if (req.method === "POST") {
            const b = req.body;
            // SharePoint date columns require ISO 8601 with time zone
            const fecha = b.fechaServicio ? b.fechaServicio + "T00:00:00Z" : null;
            const payload = { fields: {
                Title: b.empresa,
                Empresa: b.empresa,
                Estrellas: Number(b.estrellas),
                Comentario: b.comentario || "",
                Evaluador: b.evaluador,
                FechaServicio: fecha
            }};
            const res = await fetch(`https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}/items`, {
                method: "POST", headers,
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                context.res = { status: res.status, body: { error: data.error || data }, headers: { "Content-Type": "application/json" } };
                return;
            }
            context.res = { status: 201, body: { id: data.id }, headers: { "Content-Type": "application/json" } };
        }
    } catch (e) {
        context.res = { status: 500, body: { error: e.message }, headers: { "Content-Type": "application/json" } };
    }
};
