local Config = {
  potId = 23375,       -- supreme health potion
  potHp = 70,
  manaId = 238,        -- great mana potion; no Aurera, todas as vocacoes
  manaMp = 50,
  potDelay = 1000,     -- exhaust compartilhado das duas pocoes
  healHp = 85,         -- exura med ico, ou exura ico abaixo do level 300
  granHealHp = 45,     -- exura gran ico
  minGran = 2,         -- exori gran
  minMas = 3,          -- exori mas
  minExori = 2,        -- exori
  minSweep = 3,        -- exori min
  minScu = 2,          -- exori scu (Shield Slam, adjacentes)
  minExetaRes = 2,     -- exeta res com monstro a 1 sqm
  exetaGap = 4000,     -- entre um challenge e outro
  trashDelay = 600,    -- um item por vez; 200ms empurra os 8 sqm e trava
  dropItems = {3492, 3590, 3031}, -- worm, banana, gold coin
  maxStackedItems = 5,
  dropDelay = 100,     -- 10ms flooda; um drop por vez no pe
  talkGap = 200,
  equipGap = 400
}

local Spell = {
  ["exori"]           = {mana = 125, level = 35,  cd = 4000},
  ["exori mas"]       = {mana = 200, level = 33,  cd = 8000},
  ["exori min"]       = {mana = 200, level = 70,  cd = 6000},
  ["exori gran"]      = {mana = 360, level = 90,  cd = 6000},
  ["exori gran ico"]  = {mana = 300, level = 110, cd = 30000},
  ["exori scu"]       = {mana = 110, level = 30,  cd = 6000},
  ["exori ico"]       = {mana = 30,  level = 16,  cd = 6000},
  ["exori ico scu"]   = {mana = 30,  level = 18,  cd = 4000},
  ["exeta res"]       = {mana = 40,  level = 20,  cd = 2000},
  ["exeta amp res"]   = {mana = 80,  level = 150, cd = 2000},
  ["exura ico"]       = {mana = 40,  level = 8,   cd = 2000},
  ["exura gran ico"]  = {mana = 300, level = 80,  cd = 120000},
  ["exura med ico"]   = {mana = 135, level = 300, cd = 2000},
  ["utani hur"]       = {mana = 60,  level = 14,  cd = 2000},
  ["utani tempo hur"] = {mana = 100, level = 25,  cd = 2000}
}

-- Familiares contam como monstro em alguns OT. getType() >= 3 ja filtra no client oficial.
local Familiars = {
  ["emberwing"] = true,
  ["skullfrost"] = true,
  ["grovebeast"] = true,
  ["thundergiant"] = true,
  ["monk familiar"] = true
}

local lastTalk = 0
local lastPotion = 0
local lastExetaRes = 0
local lastExetaAmp = 0
local lastMove = 0
local GROUP_ATTACK = 1
local GROUP_HEAL = 2
local GROUP_SUPPORT = 3

local function spellFallback(words)
  return Spell[words] or {mana = 0, level = 0, cd = 2000}
end

local function clientSpell(words)
  if type(getSpellData) ~= "function" then return nil end
  local ok, data = pcall(getSpellData, words)
  if not ok or type(data) ~= "table" then return nil end
  if not data.mana or not data.level then return nil end
  -- entrada sintetica do vBot quando a spell ainda nao esta no SpellInfo
  if data.level <= 1 and data.mana <= 1 then return nil end
  return data
end

local function groupBusy(groupId)
  local cooldown = modules and modules.game_cooldown
  if not cooldown or type(cooldown.isGroupCooldownIconActive) ~= "function" then
    return false
  end
  local ok, active = pcall(cooldown.isGroupCooldownIconActive, groupId)
  return ok and active or false
end

local function onCooldown(words)
  if type(getSpellCoolDown) ~= "function" then return false end
  local ok, cooling = pcall(getSpellCoolDown, words)
  return ok and cooling or false
end

local function ready(words)
  local info = clientSpell(words)
  local fallback = spellFallback(words)
  local needMana = info and info.mana or fallback.mana
  local needLevel = info and info.level or fallback.level
  if lvl() < needLevel or mana() < needMana then return false end
  if onCooldown(words) then return false end
  if type(canCast) == "function" then
    local ok, allowed = pcall(canCast, words, true, false)
    if ok and not allowed then return false end
  elseif SpellCastTable and SpellCastTable[words] then
    local entry = SpellCastTable[words]
    if now - entry.t <= entry.d then return false end
  end
  return true
end

local function speak(words)
  local cd = spellFallback(words).cd
  if type(cast) == "function" then
    cast(words, cd)
  else
    say(words)
  end
  lastTalk = now
end

local function canTalk()
  return now - lastTalk >= Config.talkGap
end

local function isRealMonster(creature)
  if not creature or not creature:isMonster() then return false end
  local name = creature:getName()
  if name and Familiars[name:lower()] then return false end
  if g_game.getClientVersion() >= 960 and creature.getType and creature:getType() >= 3 then
    return false
  end
  return true
end

local function countMonsters(range)
  local total = 0
  local origin = pos()
  for _, spec in pairs(getSpectators()) do
    local specPos = spec:getPosition()
    if specPos and specPos.z == origin.z and isRealMonster(spec) and getDistanceBetween(origin, specPos) <= range then
      total = total + 1
    end
  end
  return total
end

local function faceCreature(creature)
  local origin = pos()
  local targetPos = creature:getPosition()
  if not targetPos or targetPos.z ~= origin.z then return false end
  local dx = targetPos.x - origin.x
  local dy = targetPos.y - origin.y
  local adx = math.abs(dx)
  local ady = math.abs(dy)
  if (adx >= 2 and ady >= 2) or adx > 7 or ady > 7 or (adx == 0 and ady == 0) then
    return false
  end
  local dir
  if ady >= adx then
    dir = dy > 0 and 2 or 0
  else
    dir = dx > 0 and 1 or 3
  end
  if player:getDirection() ~= dir then
    turn(dir)
    return true
  end
  return false
end

-- exori gran ico e exori ico so acertam o sqm cardinal da frente.
local function cardinalMelee(creature)
  local origin = pos()
  local targetPos = creature:getPosition()
  if not targetPos or targetPos.z ~= origin.z then return false end
  local dx = targetPos.x - origin.x
  local dy = targetPos.y - origin.y
  if math.abs(dx) + math.abs(dy) ~= 1 then return false end
  local dir = (dx == 1 and 1) or (dx == -1 and 3) or (dy == 1 and 2) or 0
  return player:getDirection() == dir
end

local function monstersInFront()
  local origin = pos()
  local dir = player:getDirection()
  local offsets = {
    [0] = {{0, -1}, {-1, -1}, {1, -1}},
    [1] = {{1, 0}, {1, -1}, {1, 1}},
    [2] = {{0, 1}, {-1, 1}, {1, 1}},
    [3] = {{-1, 0}, {-1, -1}, {-1, 1}}
  }
  local total = 0
  for _, offset in pairs(offsets[dir] or {}) do
    local tile = g_map.getTile({x = origin.x + offset[1], y = origin.y + offset[2], z = origin.z})
    if tile and tile.getCreatures then
      for _, creature in pairs(tile:getCreatures()) do
        if isRealMonster(creature) then total = total + 1 end
      end
    end
  end
  return total
end

local function trySpell(words, groupId)
  if not canTalk() or groupBusy(groupId) or not ready(words) then return false end
  speak(words)
  return true
end

local function castSingleTarget(target, justTurned)
  if justTurned or not cardinalMelee(target) then return false end
  if trySpell("exori gran ico", GROUP_ATTACK) then return true end
  if target:isPlayer() and trySpell("exori ico", GROUP_ATTACK) then return true end
  return false
end

local function castHunt(target, justTurned)
  local adjacent = countMonsters(1)
  local around = countMonsters(3)
  if castSingleTarget(target, justTurned) then return true end
  if adjacent >= Config.minGran and trySpell("exori gran", GROUP_ATTACK) then
    return true
  end
  if adjacent >= Config.minScu and trySpell("exori scu", GROUP_ATTACK) then
    return true
  end
  if not justTurned and monstersInFront() >= Config.minSweep and trySpell("exori min", GROUP_ATTACK) then
    return true
  end
  if around >= Config.minMas and trySpell("exori mas", GROUP_ATTACK) then
    return true
  end
  if adjacent >= Config.minExori and trySpell("exori", GROUP_ATTACK) then
    return true
  end
  if not justTurned and cardinalMelee(target) and trySpell("exori ico", GROUP_ATTACK) then
    return true
  end
  return false
end

local function castAttack(target, justTurned)
  if not target or not target:getPosition() then return false end
  if not huntMacro or huntMacro.isOff() then return false end
  if target:isPlayer() then return false end
  return castHunt(target, justTurned)
end

-- Challenge sai antes do exori. talkGap e o grupo support seguram a rotacao.
local function castExetaRes(target)
  if not exetaResMacro or exetaResMacro.isOff() or isInPz() then return false end
  if now - lastExetaRes < Config.exetaGap then return false end
  if target and target:isPlayer() then return false end
  if countMonsters(1) < Config.minExetaRes then return false end
  if not trySpell("exeta res", GROUP_SUPPORT) then return false end
  lastExetaRes = now
  return true
end

local function castExetaAmp(target)
  if not exetaAmpMacro or exetaAmpMacro.isOff() or isInPz() then return false end
  if now - lastExetaAmp < Config.exetaGap then return false end
  if target and target:isPlayer() then return false end
  if countMonsters(7) < 1 then return false end
  if not trySpell("exeta amp res", GROUP_SUPPORT) then return false end
  lastExetaAmp = now
  return true
end

local function section(title)
  if UI and UI.Separator then
    UI.Separator()
    UI.Label(title)
  else
    addSeparator()
  end
end

local function usePotion(itemId)
  if now - lastPotion < Config.potDelay then return false end
  if not findItem(itemId) then return false end
  usewith(itemId, player)
  lastPotion = now
  return true
end

local function isCorpseContainer(container)
  if container.lootContainer then return true end
  if not container.getName then return false end
  local name = container:getName()
  if type(name) ~= "string" then return false end
  name = name:lower()
  if name:find("dead ", 1, true) == 1 then return true end
  if name:find("slain ", 1, true) == 1 then return true end
  if name:find("remains of", 1, true) == 1 then return true end
  return false
end

local trashOffsets = {
  {0, -1}, {1, -1}, {1, 0}, {1, 1},
  {0, 1}, {-1, 1}, {-1, 0}, {-1, -1}
}
local trashStep = 1

local function pullTrash()
  if now - lastMove < Config.trashDelay then return false end
  local origin = pos()
  if not origin then return false end
  local feet = player:getPosition()
  if not feet then return false end

  for n = 0, #trashOffsets - 1 do
    local index = ((trashStep - 1 + n) % #trashOffsets) + 1
    local offset = trashOffsets[index]
    local position = {x = origin.x + offset[1], y = origin.y + offset[2], z = origin.z}
    local tile = g_map.getTile(position)
    if tile then
      local thing = tile.getTopMoveThing and tile:getTopMoveThing() or nil
      if not thing and tile.getTopThing then
        thing = tile:getTopThing()
      end
      local pickup = thing and thing.isItem and thing:isItem()
      if pickup and thing.isPickupable and not thing:isPickupable() then
        pickup = false
      end
      if pickup and thing.isNotMoveable and thing:isNotMoveable() then
        pickup = false
      end
      if pickup then
        local count = thing:getCount()
        if not count or count < 1 then count = 1 end
        g_game.move(thing, feet, count)
        lastMove = now
        trashStep = index + 1
        return true
      end
    end
  end
  return false
end

local function antiPush()
  if not antiPushMacro or antiPushMacro.isOff() then return end
  if now - lastMove < Config.dropDelay then return end
  local feet = pos()
  if not feet then return end
  local tile = g_map.getTile(feet)
  if not tile or tile:getThingCount() >= Config.maxStackedItems then return end

  local top = tile:getTopThing()
  local topId = nil
  if top and top.isItem and top:isItem() then
    if top.isNotMoveable and top:isNotMoveable() then return end
    topId = top:getId()
  end

  local fallback = nil
  for _, itemId in ipairs(Config.dropItems) do
    if itemId ~= topId then
      local dropItem = findItem(itemId)
      if dropItem then
        g_game.move(dropItem, feet, 1)
        lastMove = now
        return
      end
    elseif not fallback then
      fallback = findItem(itemId)
    end
  end
  if fallback then
    g_game.move(fallback, feet, 1)
    lastMove = now
  end
end

section("EK Aurera")
section("Combate")
huntMacro = macro(100, "EK Hunt", function() end)
exetaResMacro = macro(100, "Exeta Res", function() end)
exetaAmpMacro = macro(100, "Exeta Amp", function() end)
paraMacro = macro(100, "Anti Paralyze", function() end)

macro(100, function()
  if isInPz() then return end
  if paraMacro.isOn() and isParalyzed() then
    trySpell("utani hur", GROUP_SUPPORT)
  end
end)

macro(100, function()
  if isInPz() then return end
  local hunting = huntMacro.isOn()
  local wantExeta = exetaResMacro.isOn() or exetaAmpMacro.isOn()
  if not hunting and not wantExeta then return end

  local target = g_game.isAttacking() and g_game.getAttackingCreature() or nil
  if target and not target:getPosition() then target = nil end

  if castExetaRes(target) then return end
  if castExetaAmp(target) then return end

  if not hunting or not target then return end
  local justTurned = faceCreature(target)
  castAttack(target, justTurned)
end)

section("Cura")
macro(100, "EK Heal", function()
  if isInPz() or not canTalk() or groupBusy(GROUP_HEAL) then return end
  if hppercent() <= Config.granHealHp and ready("exura gran ico") then
    speak("exura gran ico")
    return
  end
  if hppercent() > Config.healHp then return end
  if lvl() >= spellFallback("exura med ico").level and ready("exura med ico") then
    speak("exura med ico")
    return
  end
  if ready("exura ico") then
    speak("exura ico")
  end
end)

macro(200, "Supreme HP", function()
  if hppercent() > Config.potHp then return end
  usePotion(Config.potId)
end)

macro(200, "Mana Potion", function()
  if manapercent() > Config.manaMp then return end
  usePotion(Config.manaId)
end)

section("Util")
if storage.gpPushEnabled == nil then
  storage.gpPushEnabled = false
end

local trashParent = parent or panel
if not trashParent and type(setDefaultTab) == "function" then
  setDefaultTab("HP")
  trashParent = panel
end

if type(addSwitch) == "function" then
  local trashSwitch = addSwitch("gpPushEnabled", "Puxar Trash", function(widget)
    storage.gpPushEnabled = not widget:isOn()
    widget:setOn(storage.gpPushEnabled)
  end, trashParent)
  if trashSwitch then
    trashSwitch:setOn(storage.gpPushEnabled and true or false)
  end
end

macro(Config.trashDelay, function()
  if not storage.gpPushEnabled then return end
  pullTrash()
end)

macro(1000, "Stack items", function()
  local containers = g_game.getContainers()
  local groups = {}
  for _, container in pairs(containers) do
    if container and not isCorpseContainer(container) and (not container.isClosed or not container:isClosed()) then
      local total = container:getItemsCount()
      for slot = 0, total - 1 do
        local item = container:getItem(slot)
        if item and item:isStackable() then
          local count = item:getCount()
          if count > 0 and count < 100 then
            local id = item:getId()
            local pile = groups[id]
            if not pile then
              pile = {}
              groups[id] = pile
            end
            pile[#pile + 1] = item
          end
        end
      end
    end
  end

  for _, pile in pairs(groups) do
    if #pile >= 2 then
      local dest = pile[1]
      local source = pile[2]
      for n = 2, #pile do
        local item = pile[n]
        if item:getCount() > dest:getCount() then
          source = dest
          dest = item
        elseif item:getCount() < source:getCount() then
          source = item
        end
      end
      local space = 100 - dest:getCount()
      local moving = math.min(space, source:getCount())
      local destPos = dest:getPosition()
      if moving > 0 and destPos and destPos.x == 65535 and now - lastMove >= 200 then
        g_game.move(source, destPos, moving)
        lastMove = now
        return
      end
    end
  end
end)

antiPushMacro = macro(Config.dropDelay, "Anti Push", function()
  antiPush()
end)

if type(onPlayerPositionChange) == "function" then
  onPlayerPositionChange(function()
    antiPush()
  end)
end

local huntIcon = addIcon("up", {item = 34083, text = "HUNT"}, huntMacro)
huntIcon:breakAnchors()
huntIcon:move(190, 650)

local function sameItem(currentId, wantedId)
  if not wantedId or wantedId <= 0 or not currentId then return false end
  if currentId == wantedId then return true end
  if type(getActiveItemId) == "function" and currentId == getActiveItemId(wantedId) then return true end
  if type(getInactiveItemId) == "function" and currentId == getInactiveItemId(wantedId) then return true end
  return false
end

local function equipById(itemId)
  if not itemId or itemId <= 0 then return false end
  local real = findItem(itemId)
  if real then
    g_game.equipItem(real)
  else
    g_game.equipItemId(itemId)
  end
  return true
end

local function jewelleryEquip()
  local panelName = "jewelleryEquipper"
  -- setDefaultTab grava a aba em `panel`. O global `parent` fica nil no editor do vBot.
  if not parent and not panel and type(setDefaultTab) == "function" then
    setDefaultTab("HP")
  end

  -- Texto comum de proposito. Colchete duplo fecha o editor do vBot e o parentese seguinte vira erro.
  local otui = table.concat({
    "Panel",
    "  height: 108",
    "  margin-top: 2",
    "",
    "  BotItem",
    "    id: ammyId",
    "    anchors.left: parent.left",
    "    anchors.top: parent.top",
    "",
    "  BotItem",
    "    id: defaultAmmyId",
    "    anchors.left: parent.left",
    "    anchors.top: parent.top",
    "    margin-left: 36",
    "",
    "  BotLabel",
    "    id: ammyTitle",
    "    anchors.left: defaultAmmyId.right",
    "    anchors.right: parent.right",
    "    anchors.top: parent.top",
    "    text-align: center",
    "    text: Amuleto HP",
    "",
    "  SmallBotSwitch",
    "    id: ammySwitch",
    "    anchors.left: defaultAmmyId.right",
    "    anchors.right: parent.right",
    "    anchors.top: parent.top",
    "    margin-left: 3",
    "    margin-right: 3",
    "    margin-top: 18",
    "",
    "  HorizontalScrollBar",
    "    id: ammyScroll1",
    "    anchors.left: parent.left",
    "    anchors.top: defaultAmmyId.bottom",
    "    anchors.right: parent.right",
    "    margin-right: 2",
    "    margin-left: 2",
    "    margin-top: 5",
    "    minimum: 0",
    "    maximum: 100",
    "    step: 1",
    "",
    "  BotItem",
    "    id: ringId",
    "    anchors.left: parent.left",
    "    anchors.top: ammyScroll1.bottom",
    "    margin-top: 5",
    "",
    "  BotItem",
    "    id: defaultRingId",
    "    anchors.left: parent.left",
    "    anchors.top: ammyScroll1.bottom",
    "    margin-top: 5",
    "    margin-left: 36",
    "",
    "  BotLabel",
    "    id: ringTitle",
    "    anchors.left: defaultRingId.right",
    "    anchors.right: parent.right",
    "    anchors.top: ammyScroll1.top",
    "    text-align: center",
    "    text: Anel HP",
    "    margin-top: 20",
    "",
    "  SmallBotSwitch",
    "    id: ringSwitch",
    "    anchors.left: defaultRingId.right",
    "    anchors.right: parent.right",
    "    anchors.top: ammyScroll1.top",
    "    margin-left: 3",
    "    margin-right: 3",
    "    margin-top: 36",
    "",
    "  HorizontalScrollBar",
    "    id: ringScroll1",
    "    anchors.left: parent.left",
    "    anchors.top: defaultRingId.bottom",
    "    anchors.right: parent.right",
    "    margin-right: 2",
    "    margin-left: 2",
    "    margin-top: 5",
    "    minimum: 0",
    "    maximum: 100",
    "    step: 1"
  }, "\n")
  local ui = setupUI(otui, parent or panel)

  if not ui then
    if type(warn) == "function" then
      warn("[EK] Nao consegui criar o painel de joias nesta aba.")
    end
    return
  end

  ui:setId(panelName)

  if type(storage[panelName]) ~= "table" then
    storage[panelName] = {}
  end
  local saved = storage[panelName]
  if saved.ringId == nil then saved.ringId = 3048 end
  if saved.defaultRingId == nil then saved.defaultRingId = 0 end
  if saved.ammyId == nil then saved.ammyId = 3081 end
  if saved.defaultAmmyId == nil then saved.defaultAmmyId = 0 end
  if saved.ringMin == nil then saved.ringMin = 70 end
  if saved.ammyMin == nil then saved.ammyMin = 75 end
  if saved.ammyEnabled == nil then saved.ammyEnabled = saved.ammySwitch ~= false end
  if saved.ringEnabled == nil then saved.ringEnabled = saved.ringSwitch ~= false end

  local function bindSwitch(widget, key)
    widget:setOn(saved[key] and true or false)
    widget.onClick = function(w)
      saved[key] = not saved[key]
      w:setOn(saved[key] and true or false)
    end
  end
  bindSwitch(ui.ammySwitch, "ammyEnabled")
  bindSwitch(ui.ringSwitch, "ringEnabled")

  local function updateTexts()
    ui.ammySwitch:setText("HP% <= " .. saved.ammyMin .. "%")
    ui.ringSwitch:setText("HP% <= " .. saved.ringMin .. "%")
  end

  ui.ammyScroll1.onValueChange = function(scroll, value)
    saved.ammyMin = value
    updateTexts()
  end
  ui.ringScroll1.onValueChange = function(scroll, value)
    saved.ringMin = value
    updateTexts()
  end
  ui.ammyId.onItemChange = function(widget)
    saved.ammyId = widget:getItemId()
  end
  ui.defaultAmmyId.onItemChange = function(widget)
    saved.defaultAmmyId = widget:getItemId()
  end
  ui.ringId.onItemChange = function(widget)
    saved.ringId = widget:getItemId()
  end
  ui.defaultRingId.onItemChange = function(widget)
    saved.defaultRingId = widget:getItemId()
  end

  local function showItem(widget, itemId)
    if itemId and itemId > 0 then widget:setItemId(itemId) end
  end

  ui.ammyScroll1:setValue(saved.ammyMin)
  ui.ringScroll1:setValue(saved.ringMin)
  showItem(ui.ammyId, saved.ammyId)
  showItem(ui.defaultAmmyId, saved.defaultAmmyId)
  showItem(ui.ringId, saved.ringId)
  showItem(ui.defaultRingId, saved.defaultRingId)
  updateTexts()

  local lastEquip = 0
  local function consider(enabled, slotItem, emergencyId, defaultId, minHp)
    if not enabled or now - lastEquip < Config.equipGap then return false end
    local currentId = slotItem and slotItem:getId() or nil
    local wanted
    if hppercent() <= minHp then
      wanted = emergencyId
    else
      wanted = defaultId
    end
    if not wanted or wanted <= 0 or sameItem(currentId, wanted) then return false end
    if equipById(wanted) then
      lastEquip = now
      return true
    end
    return false
  end

  macro(200, function()
    if consider(saved.ammyEnabled, getNeck(), saved.ammyId, saved.defaultAmmyId, saved.ammyMin) then
      return
    end
    consider(saved.ringEnabled, getFinger(), saved.ringId, saved.defaultRingId, saved.ringMin)
  end)
end

section("Joias")
jewelleryEquip()
if UI and UI.Separator then UI.Separator() else addSeparator() end
