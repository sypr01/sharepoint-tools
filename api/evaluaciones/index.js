module.exports = async function (context, req) {
    context.res = {
        status: 200,
        body: '{"test":"ok","method":"' + req.method + '"}',
        headers: { 'Content-Type': 'application/json' }
    };
};
