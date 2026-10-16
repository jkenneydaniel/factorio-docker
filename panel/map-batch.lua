local state=storage.panel_map
local m=state.output
local s=game.surfaces.nauvis
local function rgb(c)
  return {math.floor(c.r or 76),math.floor(c.g or 102),math.floor(c.b or 76)}
end
for index=MAP_START,math.min(MAP_START+15,#state.queue) do
  local c=state.queue[index]
  local chunk={x=c.x,y=c.y,tiles={},pollution=s.get_pollution({c.x*32+16,c.y*32+16})}
  for y=0,30,2 do for x=0,30,2 do
    local tile=s.get_tile(c.x*32+x,c.y*32+y)
    local id=state.palette_lookup[tile.name]
    if not id then id=#m.palette+1;state.palette_lookup[tile.name]=id;m.palette[id]={name=tile.name,color=rgb(tile.prototype.map_color)} end
    local runs=chunk.tiles
    if #runs>0 and runs[#runs-1]==id then runs[#runs]=runs[#runs]+1 else runs[#runs+1]=id;runs[#runs+1]=1 end
  end end
  m.chunks[#m.chunks+1]=chunk
  for _,e in pairs(s.find_entities_filtered{area={{c.x*32,c.y*32},{c.x*32+32,c.y*32+32}}}) do
    local category=nil
    if e.type=='resource' then category='resources'
    elseif string.find(e.type,'rail') and e.force.name=='player' then category='railways'
    elseif e.force.name=='enemy' and (e.type=='unit-spawner' or e.type=='turret') then category='enemies'
    elseif e.force.name=='player' and e.type~='character' and e.type~='entity-ghost' and e.type~='tile-ghost' then category='buildings' end
    local key=e.name..':'..e.position.x..':'..e.position.y
    if category and not state.seen[key] and e.position.x>=c.x*32 and e.position.x<c.x*32+32 and e.position.y>=c.y*32 and e.position.y<c.y*32+32 then
      state.seen[key]=true
      if #m.entities<80000 then
        local b=e.bounding_box
        local power=e.type=='electric-pole' or e.type=='generator' or e.type=='solar-panel' or e.type=='accumulator' or e.type=='power-switch'
        local item={name=e.name,type=e.type,x=e.position.x,y=e.position.y,w=math.min(128,b.right_bottom.x-b.left_top.x),h=math.min(128,b.right_bottom.y-b.left_top.y),category=category,power=power,color=rgb(e.prototype.map_color or e.prototype.friendly_map_color)}
        if category=='resources' then item.amount=e.amount end
        if e.type=='assembling-machine' or e.type=='furnace' then local ok,recipe=pcall(function() return e.get_recipe() end);if ok and recipe then item.recipe=recipe.name end end
        m.entities[#m.entities+1]=item
      else m.entitiesLimited=true end
    end
  end
end
rcon.print('MAP_BATCH_OK')
