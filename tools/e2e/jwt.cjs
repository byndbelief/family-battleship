const c=require('crypto'); const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
module.exports=(sub)=>{ const h=b({alg:'HS256',typ:'JWT'}), p=b({sub,role:'authenticated',exp:4102444800}); return h+'.'+p+'.'+c.createHmac('sha256','test-secret-test-secret-test-secret-000').update(h+'.'+p).digest('base64url'); };
