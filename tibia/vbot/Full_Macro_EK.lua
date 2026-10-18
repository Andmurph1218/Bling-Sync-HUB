-- Full Macro EK
-- vBot 4.8 / OTClient. Cole este arquivo no editor de scripts do vBot.
-- Feito para Elite Knight no Aurera Global, depois do balanceamento de vocacoes.
--
-- Mana e level abaixo sao o fallback. Se o client tiver a spell em SpellInfo,
-- canCast/getSpellData usam o valor do client.
--
-- Aurera (wiki, balanceamento de vocacoes):
--   utito tempo      level 20   mana 20    stance. Nao recastar com o icone strengthened.
--   exori            level 35   mana 125   cd 4s   area 1
--   exori mas        level 33   mana 200   cd 8s   area grande
--   exori min        level 70   mana 200   cd 6s   3 sqm a frente
--   exori gran       level 90   mana 360   cd 6s   area 1
--   exori gran ico   level 110  mana 300   cd 30s  alvo cardinal na frente
--   exori ico        level 16   mana 30    cd 6s   alvo na frente
--   exeta res        level 20   mana 40    cd 2s
--   exeta amp res    level 150  mana 80    cd 2s   alcance 7
--   exura ico        level 8    mana 40    grupo de cura 2s
--   exura gran ico   level 80   mana 300   cd individual 2 min
--   exura med ico    level 300  mana 135   grupo de cura 2s
--   utani hur        level 14   mana 60
--
-- Grupos do OTClient: 1 attack, 2 healing, 3 support.
-- Desligue o AttackBot se ele tambem estiver soltando exori. Os dois juntos duplicam a magia.
--
-- Fora deste script, de proposito:
--   follow em "Player2": nome fixo, e o CaveBot ja segue o caminho.
--   "exeta mas res": essa spell nao existe.
--   Auto SSA / Auto Might separados: hppercent() <= 100 equipava sempre.
--     O painel de joias abaixo faz o mesmo trabalho, com limiar real.

local Config = {
  potId = 23375,       -- supreme health potion
  potHp = 80,
  potDelay = 1000,
  healHp = 70,         -- exura med ico, ou exura ico abaixo do level 300
  granHealHp = 45,     -- exura gran ico
  minGran = 2,         -- exori gran
  minMas = 3,          -- exori mas
  minExori = 1,        -- exori
  minSweep = 1,        -- exori min
  talkGap = 200,
  equipGap = 400
}

local Spell = {
  ["utito tempo"]     = {mana = 20,  level = 20,  cd = 2000},
  ["exori"]           = {mana = 125, level = 35,  cd = 4000},
  ["exori mas"]       = {mana = 200, level = 33,  cd = 8000},
  ["exori min"]       = {mana = 200, level = 70,  cd = 6000},
  ["exori gran"]      = {mana = 360, level = 90,  cd = 6000},
  ["exori gran ico"]  = {mana = 300, level = 110, cd = 30000},
  ["exori ico"]       = {mana = 30,  level = 16,  cd = 6000},
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

storage.ekExeta = storage.ekExeta or "exeta amp res"
storage.ekAntiPara = storage.ekAntiPara or "utani hur"

local lastTalk = 0
local GROUP_ATTACK = 1
local GROUP_HEAL = 2
local GROUP_SUPPORT = 3

local function trim(text)
  if type(text) ~= "string" then return "" end
  return text:lower():gsub("^%s+", ""):gsub("%s+$", "")
end

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

-- Jogadores que nao sao party e nao sao o alvo atual.
local function strangersAround(range, ignore)
  local total = 0
  local origin = pos()
  for _, spec in pairs(getSpectators()) do
    if spec:isPlayer() and not spec:isLocalPlayer() and spec ~= ignore then
      local specPos = spec:getPosition()
      local party = spec.isPartyMember and spec:isPartyMember()
      if specPos and specPos.z == origin.z and not party and getDistanceBetween(origin, specPos) <= range then
        total = total + 1
      end
    end
  end
  return total
end

local function areaBlocked(range, target)
  return safeMacro and safeMacro.isOn() and strangersAround(range, target) > 0
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

-- Icone strengthened cobre Blood Rage e Protector. Recastar utito desliga a stance.
local function bloodRageActive()
  if type(hasPartyBuff) == "function" and hasPartyBuff() then return true end
  return false
end

local function spellLevel(words)
  local info = clientSpell(words)
  if info then return info.level end
  return spellFallback(words).level
end

local function exetaWords()
  local words = trim(storage.ekExeta)
  if words == "" or words == "exeta mas res" then
    words = "exeta amp res"
  end
  if words == "exeta amp res" and lvl() < spellLevel(words) then
    return "exeta res"
  end
  return words
end

local function paraWords()
  local words = trim(storage.ekAntiPara)
  if words == "" then return "utani hur" end
  return words
end

local function trySpell(words, groupId)
  if not canTalk() or groupBusy(groupId) or not ready(words) then return false end
  speak(words)
  return true
end

local function castPara()
  if not isParalyzed() then return false end
  return trySpell(paraWords(), GROUP_SUPPORT)
end

local function castBloodRage()
  if bloodRageActive() then return false end
  if not g_game.isAttacking() and countMonsters(5) < 1 then return false end
  return trySpell("utito tempo", GROUP_SUPPORT)
end

local function castExeta(target)
  if huntMacro.isOff() then return false end
  if target and target:isPlayer() then return false end
  if countMonsters(7) < 1 then return false end
  return trySpell(exetaWords(), GROUP_SUPPORT)
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
  if adjacent >= Config.minGran and not areaBlocked(1, target) and trySpell("exori gran", GROUP_ATTACK) then
    return true
  end
  if not justTurned and monstersInFront() >= Config.minSweep and not areaBlocked(1, target) and trySpell("exori min", GROUP_ATTACK) then
    return true
  end
  if around >= Config.minMas and not areaBlocked(3, target) and trySpell("exori mas", GROUP_ATTACK) then
    return true
  end
  if adjacent >= Config.minExori and not areaBlocked(1, target) and trySpell("exori", GROUP_ATTACK) then
    return true
  end
  -- Area bloqueada ou em cooldown: Brutal Strike nao pega jogador ao lado.
  if not justTurned and cardinalMelee(target) and trySpell("exori ico", GROUP_ATTACK) then
    return true
  end
  return false
end

local function meleeDistance(creature)
  local origin = pos()
  local targetPos = creature:getPosition()
  if not targetPos or targetPos.z ~= origin.z then return 99 end
  return getDistanceBetween(origin, targetPos)
end

local function castBurst(target, justTurned)
  if castSingleTarget(target, justTurned) then return true end
  local dist = meleeDistance(target)
  if dist <= 1 and not areaBlocked(1, target) and trySpell("exori gran", GROUP_ATTACK) then
    return true
  end
  if dist <= 1 and not areaBlocked(1, target) and trySpell("exori", GROUP_ATTACK) then
    return true
  end
  return false
end

local function castAttack(target, justTurned)
  if not target or not target:getPosition() then return false end
  if target:isPlayer() then
    if pvpMacro.isOff() then return false end
    return castBurst(target, justTurned)
  end
  if huntMacro.isOn() then
    return castHunt(target, justTurned)
  end
  if pvpMacro.isOn() then
    return castBurst(target, justTurned)
  end
  return false
end

if UI and UI.Separator then
  UI.Separator()
  UI.Label("EK Aurera")
  UI.Separator()
else
  addSeparator()
end

addTextEdit("ekExeta", storage.ekExeta, function(widget, text)
  storage.ekExeta = text
end)
addTextEdit("ekAntiPara", storage.ekAntiPara, function(widget, text)
  storage.ekAntiPara = text
end)

huntMacro = macro(100, "EK Hunt", function() end)
pvpMacro = macro(100, "EK PVP", function() end)
safeMacro = macro(100000, "EK Safe AoE", function() end)

macro(100, "Anti Paralyze", function()
  if isInPz() then return end
  castPara()
end)

macro(200, "Supreme HP", function()
  if hppercent() > Config.potHp then return end
  if not findItem(Config.potId) then return end
  usewith(Config.potId, player)
  delay(Config.potDelay)
end)

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

macro(100, function()
  if huntMacro.isOff() and pvpMacro.isOff() then return end
  if isInPz() then return end

  local target = g_game.isAttacking() and g_game.getAttackingCreature() or nil
  if target and not target:getPosition() then target = nil end

  local justTurned = false
  if target then
    justTurned = faceCreature(target)
  end

  if castPara() then return end
  if castBloodRage() then return end
  if target and castAttack(target, justTurned) then return end
  castExeta(target)
end)

local pvpIcon = addIcon("pvp", {item = 32616, text = "PVP"}, pvpMacro)
pvpIcon:breakAnchors()
pvpIcon:move(228, 650)

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

  local ui = setupUI([[
Panel
  height: 108
  margin-top: 2

  BotItem
    id: ammyId
    anchors.left: parent.left
    anchors.top: parent.top

  BotItem
    id: defaultAmmyId
    anchors.left: parent.left
    anchors.top: parent.top
    margin-left: 36

  BotLabel
    id: ammyTitle
    anchors.left: defaultAmmyId.right
    anchors.right: parent.right
    anchors.top: parent.top
    text-align: center
    text: Amuleto HP

  SmallBotSwitch
    id: ammySwitch
    anchors.left: defaultAmmyId.right
    anchors.right: parent.right
    anchors.top: parent.top
    margin-left: 3
    margin-right: 3
    margin-top: 18

  HorizontalScrollBar
    id: ammyScroll1
    anchors.left: parent.left
    anchors.top: defaultAmmyId.bottom
    anchors.right: parent.right
    margin-right: 2
    margin-left: 2
    margin-top: 5
    minimum: 0
    maximum: 100
    step: 1

  BotItem
    id: ringId
    anchors.left: parent.left
    anchors.top: ammyScroll1.bottom
    margin-top: 5

  BotItem
    id: defaultRingId
    anchors.left: parent.left
    anchors.top: ammyScroll1.bottom
    margin-top: 5
    margin-left: 36

  BotLabel
    id: ringTitle
    anchors.left: defaultRingId.right
    anchors.right: parent.right
    anchors.top: ammyScroll1.top
    text-align: center
    text: Anel HP
    margin-top: 20

  SmallBotSwitch
    id: ringSwitch
    anchors.left: defaultRingId.right
    anchors.right: parent.right
    anchors.top: ammyScroll1.top
    margin-left: 3
    margin-right: 3
    margin-top: 36

  HorizontalScrollBar
    id: ringScroll1
    anchors.left: parent.left
    anchors.top: defaultRingId.bottom
    anchors.right: parent.right
    margin-right: 2
    margin-left: 2
    margin-top: 5
    minimum: 0
    maximum: 100
    step: 1
]], parent or panel)

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

if UI and UI.Separator then UI.Separator() else addSeparator() end
jewelleryEquip()
if UI and UI.Separator then UI.Separator() else addSeparator() end
