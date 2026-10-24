import crypto from 'node:crypto';

// One client belongs to one controller/module, never a global cross-install pool.
// Reuse its authenticated connection to avoid Rust's per-IP reconnect controls.
// Never expose password-bearing URLs or native socket errors to API clients.
export function createWebRcon(){
  let current=null;
  function disconnect(session,error=Error('Rust WebRCON closed before replying.')){
    if(session.closed)return;session.closed=true;clearTimeout(session.idle);
    if(current===session)current=null;
    for(const request of session.pending.values()){clearTimeout(request.timer);request.reject(error);}
    session.pending.clear();try{session.socket?.terminate();}catch{}
  }
  function idle(session){
    clearTimeout(session.idle);
    if(!session.pending.size)session.idle=setTimeout(()=>disconnect(session),30000).unref();
  }
  const request=async({host,port,password,command,timeout=10000,Socket})=>{
    // Factorio host setup can import the module registry without npm installed.
    Socket??=(await import('ws')).default;
    if(current&&(current.host!==host||current.port!==port||current.password!==password||current.Socket!==Socket))disconnect(current);
    if(!current){
      const session={host,port,password,Socket,pending:new Map(),ready:false,closed:false,next:crypto.randomInt(1001,2147480000)};
      current=session;
      try{
        session.socket=new Socket(`ws://${host}:${port}/${encodeURIComponent(password)}`,{handshakeTimeout:timeout,maxPayload:1024*1024,perMessageDeflate:false});
        session.send=(id,value)=>{try{session.socket.send(JSON.stringify({Identifier:id,Message:value,Name:'WebRcon'}));}catch{disconnect(session,Error('Rust WebRCON could not send the command.'));}};
        session.socket.addEventListener('open',()=>{if(session.closed)return;session.ready=true;for(const [id,pending] of session.pending){if(session.closed)break;session.send(id,pending.command);}});
        session.socket.addEventListener('message',event=>{
          if(session.closed)return;
          if(typeof event.data!=='string'||Buffer.byteLength(event.data)>1024*1024)return disconnect(session,Error('Rust WebRCON response exceeded its limit.'));
          let packet;try{packet=JSON.parse(event.data);}catch{return disconnect(session,Error('Invalid Rust WebRCON response.'));}
          if(!packet||typeof packet!=='object'||Array.isArray(packet))return disconnect(session,Error('Invalid Rust WebRCON response.'));
          const pending=session.pending.get(packet.Identifier);if(!pending)return; // broadcasts and stale replies
          if(typeof packet.Message!=='string')return disconnect(session,Error('Invalid Rust WebRCON response.'));
          clearTimeout(pending.timer);session.pending.delete(packet.Identifier);
          if(packet.Type==='Error'||packet.Type==='Exception')pending.reject(Error('Rust rejected the management command. Check the Rust logs.'));
          else pending.resolve(packet.Message);
          idle(session);
        });
        session.socket.addEventListener('error',()=>disconnect(session,Error('Rust WebRCON is unavailable. Check server readiness and credentials.')));
        session.socket.addEventListener('close',()=>disconnect(session));
      }catch{disconnect(session,Error('Rust WebRCON could not connect.'));throw Error('Rust WebRCON could not connect.');}
    }
    const session=current;
    if(!session||session.closed)throw Error('Rust WebRCON is unavailable. Check server readiness and credentials.');
    if(session.pending.size>=64)throw Error('Rust WebRCON is busy. Try again shortly.');
    clearTimeout(session.idle);
    return new Promise((resolve,reject)=>{
      const id=session.next++;if(session.next>=2147483647)session.next=1001;
      const timer=setTimeout(()=>disconnect(session,Error('Rust WebRCON timed out. Check server readiness and credentials.')),timeout);
      session.pending.set(id,{resolve,reject,timer,command});
      if(session.ready)session.send(id,command);
    });
  };
  // Timeout/error/idle and explicit close always abort incomplete handshakes and
  // destroy sockets. Commands are never replayed after a disconnect.
  request.close=()=>{if(current)disconnect(current);};
  return request;
}

// One-off callers also get reliable cleanup when Rust ignores close handshakes.
export async function webRcon(options){
  const request=createWebRcon();try{return await request(options);}finally{request.close();}
}

export function sanitizeLogs(value,password){
  return String(value).split('\n').filter(line=>!/rcon[._ -]?(password|pw)|authorization|controller.?token/i.test(line))
    .map(line=>password?line.split(password).join('[redacted]'):line).join('\n');
}
