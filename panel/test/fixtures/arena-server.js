const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'matches/current.json');
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
http.createServer((req,res)=>{
  try{
    if(req.url==='/boundary'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({daemon:fs.existsSync('/var/run/docker.sock'),broker:fs.existsSync('/broker/credential/token'),control:fs.existsSync('/instance/control/controller-token')}));}
    const value=read();
    if(req.url==='/rotate'&&req.method==='POST'){value.score++;const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,file);}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({...value,ready:true,tickRate:Number(process.env.ARENA_TICK_RATE)}));
  }catch{res.statusCode=503;res.end('Fixture data unavailable.');}
}).listen(7777,'0.0.0.0');
