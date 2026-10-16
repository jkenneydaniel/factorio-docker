local s=game.surfaces.nauvis
local f=game.forces.player
local chunks={}
for c in s.get_chunks() do
  if f.is_chunk_charted(s,c) then chunks[#chunks+1]={x=c.x,y=c.y} end
end
local origin=f.get_spawn_position(s)
table.sort(chunks,function(a,b) return (a.x*32-origin.x)^2+(a.y*32-origin.y)^2 < (b.x*32-origin.x)^2+(b.y*32-origin.y)^2 end)
local total=#chunks
while #chunks>2048 do chunks[#chunks]=nil end
storage.panel_map={queue=chunks,palette_lookup={},seen={},output={version=1,surface=s.name,seed=s.map_gen_settings.seed,tick=game.tick,step=2,totalChunks=total,limited=total>#chunks,chunks={},palette={},entities={},players={},tags={}}}
local m=storage.panel_map.output
for _,p in pairs(game.players) do
  if p.surface==s and f.is_chunk_charted(s,{math.floor(p.position.x/32),math.floor(p.position.y/32)}) then m.players[#m.players+1]={name=p.name,x=p.position.x,y=p.position.y} end
end
for _,tag in pairs(f.find_chart_tags(s)) do
  if f.is_chunk_charted(s,{math.floor(tag.position.x/32),math.floor(tag.position.y/32)}) then m.tags[#m.tags+1]={label=tag.text,x=tag.position.x,y=tag.position.y} end
end
rcon.print('MAP_CHUNKS='..#chunks)
