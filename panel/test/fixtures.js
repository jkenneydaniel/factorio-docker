export function settingsTar(settings){
  const body=Buffer.from(JSON.stringify(settings)),header=Buffer.alloc(512);
  header.write('map-settings.example.json');header.write(body.length.toString(8).padStart(11,'0')+'\0',124);
  return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512+1024)]);
}
