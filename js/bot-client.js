(function() {
  'use strict';

  var STORAGE = {
    collapsed: 'eon_game_bot_collapsed',
    target: 'eon_game_bot_target',
    follow: 'eon_game_bot_follow',
    autoSpawn: 'eon_game_bot_auto_spawn',
    autoRespawn: 'eon_game_bot_auto_respawn',
    autoSplit: 'eon_game_bot_auto_split',
    selfFeed: 'eon_game_bot_self_feed',
    spawnHotkey: 'eon_game_bot_spawn_hotkey',
    spawnMouse: 'eon_game_bot_spawn_mouse',
    splitHotkey: 'eon_game_bot_split_hotkey',
    splitMouse: 'eon_game_bot_split_mouse',
    massHotkey: 'eon_game_bot_mass_hotkey',
    massMouse: 'eon_game_bot_mass_mouse',
    prefix: 'eon_game_bot_prefix',
    count: 'eon_game_bot_count',
    uiOpacity: 'eon_game_bot_ui_opacity',
    paused: 'eon_game_bot_paused',
    activeTab: 'eon_game_bot_active_tab',
    ipPass: 'eon_game_bot_ip_pass',
    virusDodge: 'eon_game_bot_virus_dodge',
    cellLocator: 'eon_game_bot_cell_locator',
    captchaSitekey: 'eon_game_bot_captcha_sitekey',
    captchaAction: 'eon_game_bot_captcha_action',
    captchaCData: 'eon_game_bot_captcha_cdata'
  };

  var followTimer = null;
  var pauseTimer = null;
  var refreshTimer = null;
  var massTimer = null;
  var shareTimer = null;
  var botUiReady = false;
  var paused = localStorage.getItem(STORAGE.paused) === '1';
  var selfFeedReceiver = null;
  var shareAssignments = {};
  var botUiIdCounter = 1;
  var shareObjectIds = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var shareObjectIdCounter = 1;
  var botConsoleEntries = [];
  var botConsoleSeq = 1;
  var captchaWidgetId = null;
  var turnstileLoading = false;
  var turnstileCallbacks = [];
  var BINDABLE_ACTIONS = ['spawn', 'split', 'mass'];
  var VIRUS_SENSOR_RADIUS = 850;
  var VIRUS_SPAWN_DELAY = 2000;
  var VIRUS_SPLIT_DELAY = 15;
  var VIRUS_SPLIT_TRIGGER_RADIUS = 900;
  var virusDodgeAutoSplitHeld = false;
  var botConsoleRenderQueued = false;

  function botDebugEnabled() {
    return localStorage.getItem('eon_game_bot_debug') === '1';
  }

  function botDebugLog() {
    if (botDebugEnabled() && window.console && console.log) {
      try { console.log.apply(console, arguments); } catch (_) {}
    }
  }

  function botDebugWarn() {
    if (botDebugEnabled() && window.console && console.warn) {
      try { console.warn.apply(console, arguments); } catch (_) {}
    }
  }

  function botDebugError() {
    if (botDebugEnabled() && window.console && console.error) {
      try { console.error.apply(console, arguments); } catch (_) {}
    }
  }

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function app() {
    return window.app || null;
  }

  function botHandler() {
    var a = app();
    return a && a.botHandler ? a.botHandler : null;
  }

  function botList() {
    var h = botHandler();
    return h && Array.isArray(h.bots) ? h.bots : [];
  }

  function mapEach(container, fn) {
    if (!container) return;
    if (container instanceof Map && typeof container.forEach === 'function') {
      container.forEach(function(value, key) { fn(value, key); });
      return;
    }
    if (Array.isArray(container)) {
      for (var i = 0; i < container.length; i++) fn(container[i], i);
      return;
    }
    if (typeof container === 'object') {
      Object.keys(container).forEach(function(key) { fn(container[key], key); });
    }
  }

  function mapGet(container, key) {
    if (!container || key === undefined || key === null) return null;
    if (container instanceof Map && typeof container.get === 'function') return container.get(key) || container.get(String(key)) || null;
    return container[key] || container[String(key)] || null;
  }

  function numberOrNull(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clamp(n, min, max) {
    n = Number(n) || min;
    return Math.min(Math.max(n, min), max);
  }

  function safeText(value) {
    return String(value || '').replace(/[<>&"]/g, function(ch) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch];
    });
  }

  function storedUiOpacity() {
    return clamp(localStorage.getItem(STORAGE.uiOpacity) || 100, 35, 100);
  }

  function setUiOpacity(value) {
    value = clamp(value, 35, 100);
    localStorage.setItem(STORAGE.uiOpacity, String(value));
    applyUiOpacity(value);
  }

  function applyUiOpacity(value) {
    value = clamp(value || storedUiOpacity(), 35, 100);
    var root = byId('eon-bot-client');
    var slider = byId('eon-bot-opacity');
    var readout = byId('eon-bot-opacity-value');
    if (root) root.style.opacity = (value / 100).toFixed(2);
    if (slider) slider.value = value;
    if (readout) readout.textContent = value + '%';
  }

  function playerPosition(player) {
    if (!player) return null;
    if (typeof player.x === 'number' && typeof player.y === 'number' && (player.x || player.y)) {
      return { x: Math.round(player.x), y: Math.round(player.y) };
    }

    var cells = player.cells;
    if (!cells || typeof cells.length !== 'number' || !cells.length) return null;
    var x = 0, y = 0, count = 0;
    for (var i = 0; i < cells.length; i++) {
      if (typeof cells[i].x !== 'number' || typeof cells[i].y !== 'number') continue;
      x += cells[i].x;
      y += cells[i].y;
      count++;
    }
    if (!count) return null;
    return { x: Math.round(x / count), y: Math.round(y / count) };
  }

  function playerCells(player) {
    if (!player || !player.cells || typeof player.cells.length !== 'number') return [];
    var cells = [];
    for (var i = 0; i < player.cells.length; i++) {
      if (isCellLike(player.cells[i])) cells.push(player.cells[i]);
    }
    return cells;
  }

  function isCellLike(cell) {
    return !!(cell && typeof cell.x === 'number' && typeof cell.y === 'number');
  }

  function cellRadius(cell) {
    if (!cell) return 0;
    if (typeof cell.r === 'number') return cell.r;
    if (typeof cell.radius === 'number') return cell.radius;
    if (typeof cell.size === 'number') return cell.size;
    return 0;
  }

  function distSq(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function cellKey(cell) {
    if (!cell) return '';
    if (cell.id !== undefined) return 'id:' + cell.id;
    return 'pos:' + Math.round(cell.x / 20) + ':' + Math.round(cell.y / 20) + ':' + Math.round(cellRadius(cell) / 5);
  }

  function addContainerCells(container, out, seen) {
    if (!container) return;
    var values = null;
    if (container instanceof Map) values = Array.from(container.values());
    else if (Array.isArray(container)) values = container;
    else if (typeof container === 'object') values = Object.keys(container).map(function(key) { return container[key]; });
    if (!values) return;

    for (var i = 0; i < values.length; i++) {
      var cell = values[i];
      if (!isCellLike(cell)) continue;
      var key = cell.id !== undefined ? String(cell.id) : (cell.x + ':' + cell.y + ':' + cellRadius(cell));
      if (seen[key]) continue;
      seen[key] = true;
      out.push(cell);
    }
  }

  function knownCells() {
    var a = app();
    var cells = [];
    var seen = {};
    var dc = a && a.dualConnectionHandler;
    var clients = dc && (dc.clients || dc.list) || [];
    var candidates = [
      a && a.cells,
      a && a.world && a.world.cells,
      a && a.stage && a.stage.cells,
      a && a.stage && a.stage.world && a.stage.world.cells,
      a && a.stage && a.stage.renderer && a.stage.renderer.cells,
      clientByRole('current') && clientByRole('current').cells,
      clientByRole('parent') && clientByRole('parent').cells,
      clientByRole('child') && clientByRole('child').cells
    ];

    for (var i = 0; i < clients.length; i++) {
      if (clients[i] && clients[i].cells) candidates.push(clients[i].cells);
    }
    for (var j = 0; j < candidates.length; j++) addContainerCells(candidates[j], cells, seen);
    return cells;
  }

  function isVirusCell(cell) {
    if (!cell || cell.destroyed) return false;
    if (cell.isVirus === true || cell.virus === true) return true;
    if (cell.flags && cell.flags.isVirus === true) return true;
    if (cell.type === 1 || cell.cellType === 1) return true;
    if (String(cell.type || cell.cellType || cell.kind || '').toLowerCase() === 'virus') return true;
    return false;
  }

  function protectedCells() {
    var cells = []
      .concat(playerCells((clientByRole('parent') || {}).player))
      .concat(playerCells((clientByRole('child') || {}).player));
    if (!cells.length) cells = playerCells((clientByRole('current') || {}).player);
    return cells;
  }

  function protectedPosition() {
    var cells = protectedCells();
    if (!cells.length) return null;
    var x = 0, y = 0;
    for (var i = 0; i < cells.length; i++) {
      x += cells[i].x;
      y += cells[i].y;
    }
    return { x: Math.round(x / cells.length), y: Math.round(y / cells.length) };
  }

  function nearestThreatVirus() {
    if (!byId('eon-bot-virus-dodge') || !byId('eon-bot-virus-dodge').checked) return null;
    var owned = protectedCells();
    if (!owned.length) return null;
    var cells = knownCells();
    var limit = VIRUS_SENSOR_RADIUS * VIRUS_SENSOR_RADIUS;
    var best = null;

    for (var i = 0; i < cells.length; i++) {
      var virus = cells[i];
      if (!isVirusCell(virus)) continue;
      for (var j = 0; j < owned.length; j++) {
        var reach = VIRUS_SENSOR_RADIUS + cellRadius(owned[j]) + cellRadius(virus);
        var d = distSq(virus, owned[j]);
        var threshold = Math.max(limit, reach * reach);
        if (d > threshold || (best && d >= best.distance)) continue;
        best = {
          key: cellKey(virus),
          x: Math.round(virus.x),
          y: Math.round(virus.y),
          r: cellRadius(virus),
          distance: d
        };
      }
    }

    return best;
  }

  function autoSplitChecked() {
    var input = byId('eon-bot-auto-split');
    return !!(input && input.checked);
  }

  function holdVirusAutoSplit() {
    var h = botHandler();
    virusDodgeAutoSplitHeld = true;
    if (h && autoSplitChecked()) h.autoSplitter = false;
  }

  function releaseVirusAutoSplit() {
    var h = botHandler();
    if (virusDodgeAutoSplitHeld && h) h.autoSplitter = autoSplitChecked();
    virusDodgeAutoSplitHeld = false;
  }

  function splitOnceForVirus(threat, bots) {
    if (!threat || !autoSplitChecked()) return;
    var key = threat.key || (threat.x + ':' + threat.y);
    bots = bots || botList();
    for (var i = 0; i < bots.length; i++) {
      scheduleVirusSplit(bots[i], threat, key);
    }
  }

  function scheduleVirusSplit(bot, threat, key) {
    if (!bot || !bot.clientReady || !bot.isAlive || typeof bot.sendSplit !== 'function') {
      if (bot && !bot.isAlive) {
        bot._eonVirusSplitKey = '';
        bot._eonVirusSplitPendingKey = '';
      }
      return;
    }
    if (bot._eonVirusSplitKey === key || bot._eonVirusSplitPendingKey === key) return;
    if (!virusSplitReady(bot, threat)) return;

    bot._eonVirusSplitPendingKey = key;
    sendBotCursor(bot, threat);
    setTimeout(function() {
      bot._eonVirusSplitPendingKey = '';
      if (!bot.clientReady || !bot.isAlive || typeof bot.sendSplit !== 'function') return;
      sendBotCursor(bot, threat);
      try {
        bot.sendSplit(1);
        bot._eonVirusSplitKey = key;
      } catch (_) {}
    }, VIRUS_SPLIT_DELAY);
  }

  function virusSplitReady(bot, threat) {
    var pos = botPosition(bot);
    if (!pos) return true;
    var reach = VIRUS_SPLIT_TRIGGER_RADIUS + cellRadius(pos) + (threat.r || 0);
    return distSq(pos, threat) <= reach * reach;
  }

  function handleVirusAutoSplit(threat, bots) {
    if (!threat) return releaseVirusAutoSplit();
    holdVirusAutoSplit();
    splitOnceForVirus(threat, bots);
  }

  function botPosition(bot) {
    if (!bot) return null;
    if (bot.player) {
      var playerPos = playerPosition(bot.player);
      if (playerPos) return playerPos;
    }
    if (typeof bot.x === 'number' && typeof bot.y === 'number') return { x: Math.round(bot.x), y: Math.round(bot.y) };
    return null;
  }

  function botUiKey(bot) {
    if (!bot) return '';
    if (!bot._eonBotUiKey) {
      try {
        Object.defineProperty(bot, '_eonBotUiKey', { value: 'bot-ui-' + botUiIdCounter++, enumerable: false });
      } catch (_) {
        bot._eonBotUiKey = 'bot-ui-' + botUiIdCounter++;
      }
    }
    return bot._eonBotUiKey;
  }

  function findBotByKey(key) {
    var bots = botList();
    for (var i = 0; i < bots.length; i++) {
      if (botUiKey(bots[i]) === key) return bots[i];
    }
    return null;
  }

  function botNumber(bot, fallback) {
    var h = botHandler();
    if (h && h.activeBots && typeof h.activeBots.forEach === 'function') {
      var found = null;
      h.activeBots.forEach(function(value, key) {
        var number = Number(key);
        if (value === bot && Number.isFinite(number)) found = number + 1;
      });
      if (found !== null) return found;
    }
    return fallback + 1;
  }

  function botName(bot, fallback) {
    return (bot && (bot.botName || bot.name || bot.nickname)) || ('Bot' + botNumber(bot, fallback));
  }

  function setBotName(bot, name) {
    if (!bot) return '';
    name = (String(name || '').trim() || 'Bot').slice(0, 18);
    bot.botName = name;
    bot.name = name;
    bot.nickname = name;
    if (bot.player) bot.player.nickname = name;
    try {
      if (bot.clientReady && typeof bot.sendPlayerInfo === 'function') bot.sendPlayerInfo();
    } catch (_) {}
    return name;
  }

  function botCells(bot) {
    if (!bot || !bot.player || !bot.player.cells || typeof bot.player.cells.length !== 'number') return 0;
    return bot.player.cells.length;
  }

  function botMass(bot) {
    if (!bot || !bot.player) return 0;
    if (typeof bot.player.totalMass === 'number' && bot.player.totalMass > 0) return Math.round(bot.player.totalMass);
    var cells = bot.player.cells;
    if (!cells || typeof cells.length !== 'number') return 0;
    var mass = 0;
    for (var i = 0; i < cells.length; i++) {
      if (typeof cells[i].mass === 'number') mass += cells[i].mass;
      else if (typeof cells[i].r === 'number') mass += cells[i].r * cells[i].r;
    }
    return Math.round(mass);
  }

  function botStatus(bot) {
    if (!bot) return 'Missing';
    if (bot.isAlive) return 'Alive';
    if (bot.isDead) return 'Dead';
    if (bot.clientReady) return 'Ready';
    if (bot.isConnected) return 'Connected';
    return 'Connecting';
  }

  function shareReadyBots() {
    var bots = botList();
    var ready = [];
    for (var i = 0; i < bots.length; i++) {
      // Include bots that are connected and have a clientId
      if (bots[i] && bots[i].clientId && bots[i].connected) ready.push(bots[i]);
    }
    return ready;
  }

  function isShareAssignedBot(bot) {
    return !!(bot && bot._eonShareTargetKey && shareAssignments[bot._eonShareTargetKey] > 0);
  }

  function clearShareBotMarks() {
    var bots = botList();
    for (var i = 0; i < bots.length; i++) {
      if (!bots[i]) continue;
      bots[i]._eonShareTargetKey = '';
      bots[i]._eonShareTargetName = '';
    }
  }

  function activeShareCount() {
    var total = 0;
    Object.keys(shareAssignments).forEach(function(key) {
      total += Math.max(0, Number(shareAssignments[key]) || 0);
    });
    return total;
  }

  function shareCellCoord(cell, axis) {
    var target = axis === 'x' ? 'targetX' : 'targetY';
    if (typeof cell[target] === 'number') return cell[target];
    return cell[axis];
  }

  function shareCellMass(cell) {
    if (!cell) return 0;
    if (typeof cell.mass === 'number' && cell.mass > 0) return Math.round(cell.mass);
    var r = cellRadius(cell);
    return Math.round(r * r);
  }

  function colorIntHex(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '#666666';
    return '#' + ('000000' + (n & 0xffffff).toString(16)).slice(-6);
  }

  function sharePlayerName(client, fallbackId) {
    var name = client && (client.nickname || client.nick || client.name || client.playerName);
    name = String(name || '').trim();
    return name || ('unnamed#' + fallbackId);
  }

  function ensureSharePlayer(state, key) {
    if (!state.byKey[key]) {
      state.byKey[key] = {
        key: key,
        name: '',
        clientId: null,
        playerIds: [],
        playerIdMap: {},
        cells: [],
        mass: 0,
        colorInt: null,
        sourceType: ''
      };
      state.list.push(state.byKey[key]);
    }
    return state.byKey[key];
  }

  function addSharePlayerId(player, playerId) {
    playerId = numberOrNull(playerId);
    if (playerId === null || player.playerIdMap[playerId]) return;
    player.playerIdMap[playerId] = true;
    player.playerIds.push(playerId);
  }

  function addShareSource(sources, source) {
    if (!source || sources.indexOf(source) !== -1) return;
    if (!source.playerClients && !source.players && !source.cells && !source.cellsToBeRendered) return;
    sources.push(source);
  }

  function arenaSources() {
    var sources = [];
    var a = app();
    var dc = a && a.dualConnectionHandler;
    if (dc) {
      addShareSource(sources, dc.current);
      addShareSource(sources, dc.primary);
      addShareSource(sources, dc.secondary);
      var clients = dc.clients || dc.list || [];
      for (var i = 0; i < clients.length; i++) addShareSource(sources, clients[i]);
    }

    var bots = botList();
    for (var j = 0; j < bots.length; j++) addShareSource(sources, bots[j]);
    return sources;
  }

  function sourceClientData(source, clientId) {
    return mapGet(source && source.playerClients, clientId);
  }

  function sourcePlayerData(source, playerId) {
    return mapGet(source && source.players, playerId);
  }

  function addArenaClient(state, source, client, keyValue) {
    if (!client || client.isBot) return;
    var clientId = numberOrNull(client.clientId);
    if (clientId === null) clientId = numberOrNull(keyValue);
    if (clientId === null) return;

    var player = ensureSharePlayer(state, 'client:' + clientId);
    player.clientId = clientId;
    player.name = sharePlayerName(client, clientId);
    player.colorInt = client.colorInt !== undefined ? client.colorInt : player.colorInt;
    player.sourceType = source && source.type || player.sourceType;
  }

  function addArenaPlayer(state, source, arenaPlayer, keyValue) {
    if (!arenaPlayer) return;
    var playerId = numberOrNull(arenaPlayer.playerId);
    if (playerId === null) playerId = numberOrNull(keyValue);
    if (playerId === null) return;

    var client = arenaPlayer.playerClient || sourceClientData(source, arenaPlayer.clientId);
    if (client && client.isBot) return;
    var clientId = numberOrNull(arenaPlayer.clientId);
    if (clientId === null && client) clientId = numberOrNull(client.clientId);
    var key = clientId !== null ? 'client:' + clientId : 'player:' + playerId;
    var player = ensureSharePlayer(state, key);
    if (clientId !== null) player.clientId = clientId;
    addSharePlayerId(player, playerId);
    player.name = sharePlayerName(client, playerId);
    player.colorInt = arenaPlayer.colorInt !== undefined ? arenaPlayer.colorInt : player.colorInt;
    player.sourceType = source && source.type || player.sourceType;
  }

  function addArenaCell(state, source, cell) {
    if (!cell || cell.destroyed || !isCellLike(cell) || isVirusCell(cell)) return;
    if (cell.flags && (cell.flags.isEject || cell.flags.isFood || cell.flags.isVirus)) return;

    var playerId = numberOrNull(cell.playerId);
    if (playerId === null) return;
    var arenaPlayer = sourcePlayerData(source, playerId);
    var client = arenaPlayer && arenaPlayer.playerClient;
    if (client && client.isBot) return;

    var clientId = arenaPlayer ? numberOrNull(arenaPlayer.clientId) : null;
    if (clientId === null && client) clientId = numberOrNull(client.clientId);
    var key = clientId !== null ? 'client:' + clientId : 'player:' + playerId;
    var player = ensureSharePlayer(state, key);
    if (clientId !== null) player.clientId = clientId;
    addSharePlayerId(player, playerId);
    player.name = sharePlayerName(client || cell, playerId);
    player.colorInt = cell.colorInt !== undefined ? cell.colorInt : player.colorInt;
    player.cells.push(cell);
    player.mass += shareCellMass(cell);
    player.sourceType = source && source.type || player.sourceType;
  }

  function addArenaSourcePlayers(state, source) {
    mapEach(source && source.playerClients, function(client, key) {
      addArenaClient(state, source, client, key);
    });
    mapEach(source && source.players, function(player, key) {
      addArenaPlayer(state, source, player, key);
    });

    var seenCells = {};
    function addCell(cell) {
      if (!cell) return;
      var key = cell.id !== undefined ? 'id:' + cell.id : (shareCellCoord(cell, 'x') + ':' + shareCellCoord(cell, 'y') + ':' + cellRadius(cell));
      if (seenCells[key]) return;
      seenCells[key] = true;
      addArenaCell(state, source, cell);
    }
    mapEach(source && source.cells, function(cell) { addCell(cell); });
    mapEach(source && source.cellsToBeRendered, function(cell) { addCell(cell); });
    mapEach(source && source.sharedCellsToBeRendered, function(cell) { addCell(cell); });
  }

  function arenaPlayers() {
    var state = { list: [], byKey: {} };
    var sources = arenaSources();
    for (var i = 0; i < sources.length; i++) addArenaSourcePlayers(state, sources[i]);

    state.list.forEach(function(player) {
      player.cells = player.cells.filter(function(cell) {
        return cell && !cell.destroyed && isCellLike(cell);
      });
      player.active = player.cells.length > 0;
      player.status = player.active ? 'Active' : 'Spectating';
      player.mass = Math.round(player.mass || 0);
    });
    state.list.sort(function(a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.mass !== b.mass) return b.mass - a.mass;
      return String(a.name).localeCompare(String(b.name));
    });
    return state.list;
  }

  function pruneShareAssignments(players) {
    var known = {};
    for (var i = 0; i < players.length; i++) known[players[i].key] = true;
    Object.keys(shareAssignments).forEach(function(key) {
      if (!known[key]) delete shareAssignments[key];
    });
  }

  function reconcileShareBots(players) {
    players = players || arenaPlayers();
    pruneShareAssignments(players);
    clearShareBotMarks();

    var ready = shareReadyBots();
    var index = 0;
    for (var i = 0; i < players.length; i++) {
      var target = players[i];
      var count = Math.max(0, Number(shareAssignments[target.key]) || 0);
      for (var j = 0; j < count && index < ready.length; j++) {
        ready[index]._eonShareTargetKey = target.key;
        ready[index]._eonShareTargetName = target.name;
        index++;
      }
    }

    return { ready: ready.length, assigned: index };
  }

  function sharePlayerFeedPosition(player) {
    if (!player || !player.cells || !player.cells.length) return null;
    var best = null;
    for (var i = 0; i < player.cells.length; i++) {
      var cell = player.cells[i];
      if (!cell || cell.destroyed || !isCellLike(cell)) continue;
      if (!best || cellRadius(cell) > cellRadius(best)) best = cell;
    }
    if (!best) return null;
    return {
      x: Math.round(shareCellCoord(best, 'x')),
      y: Math.round(shareCellCoord(best, 'y'))
    };
  }

  function shareFeedTick() {
    if (paused) return;
    
    var players = arenaPlayers();
    reconcileShareBots(players);
    
    var byKey = {};
    for (var i = 0; i < players.length; i++) byKey[players[i].key] = players[i];

    var bots = botList();
    for (var j = 0; j < bots.length; j++) {
      var bot = bots[j];
      if (!bot || !bot._eonShareTargetKey || !bot.connected) continue;
      
      var target = byKey[bot._eonShareTargetKey];
      if (!target) {
        // Target player not found in arena - log it
        botDebugLog('[SHARE] Target key ' + bot._eonShareTargetKey + ' not found in arena');
        continue;
      }
      
      var pos = sharePlayerFeedPosition(target);
      
      if (!pos) {
        // Player has no visible cells - bot should still move toward last known position
        botDebugLog('[SHARE] Target ' + target.name + ' has no cells, using last position');
        // Try to find any position for the target player
        var cell = target.cells && target.cells[0];
        if (cell) {
          pos = {
            x: Math.round(shareCellCoord(cell, 'x')),
            y: Math.round(shareCellCoord(cell, 'y'))
          };
        }
        if (!pos) continue;
      }
      
      // Move bot to target position
      sendBotCursor(bot, pos);
      
      // Send feed command - bots should always try to feed assigned player
      try { 
        bot.sendFeed(); 
      } catch (_) {
        // If sendFeed fails, try alternative feed method
        try {
          if (bot.feed) bot.feed();
        } catch (_2) {}
      }
    }
  }

  function updateShareFeedTimer() {
    if (!activeShareCount()) {
      if (shareTimer) clearInterval(shareTimer);
      shareTimer = null;
      clearShareBotMarks();
      return;
    }
    if (!shareTimer) shareTimer = setInterval(shareFeedTick, 50);
  }

  function setShareAssignment(key, count) {
    var ready = shareReadyBots().length;
    count = clamp(count, 0, Math.max(ready, 0));
    if (!ready || count <= 0) delete shareAssignments[key];
    else shareAssignments[key] = count;
    updateShareFeedTimer();
    renderSharePlayers();
  }

  function clearShareAssignments(quiet) {
    shareAssignments = {};
    updateShareFeedTimer();
    renderSharePlayers();
    if (!quiet) setMessage('Share assignments cleared');
  }

  function shortServerUrl() {
    var a = app();
    return (a && a.player && a.player.serverUrl) || 'No server';
  }

  function botConsoleLog(level, text, bot) {
    var entry = {
      id: botConsoleSeq++,
      time: new Date(),
      level: level || 'info',
      text: String(text || ''),
      bot: bot ? botName(bot, 0) : ''
    };
    botConsoleEntries.push(entry);
    if (botConsoleEntries.length > 160) botConsoleEntries.shift();
    requestBotConsoleRender();
  }

  function requestBotConsoleRender() {
    if (botConsoleRenderQueued) return;
    botConsoleRenderQueued = true;
    var schedule = window.requestAnimationFrame || function(fn) { return setTimeout(fn, 0); };
    schedule(function() {
      botConsoleRenderQueued = false;
      renderBotConsole();
    });
  }

  function formatConsoleTime(date) {
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function renderBotConsole() {
    var out = byId('eon-bot-console-log');
    if (!out) return;
    if (!botConsoleEntries.length) {
      out.innerHTML = '<div class="eon-bot-console-empty">No bot events yet</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < botConsoleEntries.length; i++) {
      var e = botConsoleEntries[i];
      html += '<div class="eon-bot-console-line ' + safeText(e.level) + '">' +
        '<span class="eon-bot-console-time">' + formatConsoleTime(e.time) + '</span>' +
        '<span class="eon-bot-console-level">' + safeText(e.level) + '</span>' +
        '<span class="eon-bot-console-bot">' + safeText(e.bot || '-') + '</span>' +
        '<span class="eon-bot-console-text">' + safeText(e.text) + '</span>' +
      '</div>';
    }
    out.innerHTML = html;
    out.scrollTop = out.scrollHeight;
  }

  function setCaptchaStatus(text, warn) {
    var status = byId('eon-bot-captcha-status');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('warn', !!warn);
  }

  function rememberCaptchaOptions() {
    var sitekey = byId('eon-bot-captcha-sitekey');
    var action = byId('eon-bot-captcha-action');
    var cData = byId('eon-bot-captcha-cdata');
    localStorage.setItem(STORAGE.captchaSitekey, sitekey ? sitekey.value.trim() : '');
    localStorage.setItem(STORAGE.captchaAction, action ? action.value.trim() : '');
    localStorage.setItem(STORAGE.captchaCData, cData ? cData.value.trim() : '');
  }

  function loadTurnstile(callback) {
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      callback();
      return;
    }

    turnstileCallbacks.push(callback);
    if (turnstileLoading) return;
    turnstileLoading = true;
    setCaptchaStatus('Loading Turnstile...');

    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = function() {
      turnstileLoading = false;
      setCaptchaStatus('Turnstile loaded');
      var callbacks = turnstileCallbacks.slice();
      turnstileCallbacks.length = 0;
      for (var i = 0; i < callbacks.length; i++) callbacks[i]();
    };
    script.onerror = function() {
      turnstileLoading = false;
      turnstileCallbacks.length = 0;
      setCaptchaStatus('Turnstile script failed to load', true);
      botConsoleLog('error', 'Turnstile script failed to load');
    };
    document.head.appendChild(script);
  }

  function clearCaptchaWidget() {
    var box = byId('eon-bot-captcha-widget');
    if (window.turnstile && captchaWidgetId !== null && typeof window.turnstile.remove === 'function') {
      try { window.turnstile.remove(captchaWidgetId); } catch (_) {}
    }
    captchaWidgetId = null;
    if (box) box.innerHTML = '';
  }

  function renderCaptchaWidget() {
    var sitekeyInput = byId('eon-bot-captcha-sitekey');
    var actionInput = byId('eon-bot-captcha-action');
    var cDataInput = byId('eon-bot-captcha-cdata');
    var box = byId('eon-bot-captcha-widget');
    var sitekey = sitekeyInput ? sitekeyInput.value.trim() : '';
    var action = actionInput ? actionInput.value.trim() : '';
    var cData = cDataInput ? cDataInput.value.trim() : '';

    rememberCaptchaOptions();
    if (!box) return;
    if (!sitekey) {
      setCaptchaStatus('Paste a Turnstile sitekey first', true);
      return;
    }
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      setCaptchaStatus('Turnstile needs http:// or https://', true);
      return;
    }

    loadTurnstile(function() {
      if (!window.turnstile || typeof window.turnstile.render !== 'function') {
        setCaptchaStatus('Turnstile API is unavailable', true);
        return;
      }

      clearCaptchaWidget();
      setCaptchaStatus('Rendering challenge...');

      var options = {
        sitekey: sitekey,
        theme: 'dark',
        size: 'normal',
        callback: function() {
          setCaptchaStatus('Solved: token received');
          botConsoleLog('ok', 'Turnstile widget solved');
        },
        'expired-callback': function() {
          setCaptchaStatus('Expired: render again', true);
          botConsoleLog('warn', 'Turnstile token expired');
        },
        'timeout-callback': function() {
          setCaptchaStatus('Timed out: render again', true);
          botConsoleLog('warn', 'Turnstile challenge timed out');
        },
        'error-callback': function(code) {
          setCaptchaStatus('Turnstile error' + (code ? ': ' + code : ''), true);
          botConsoleLog('error', 'Turnstile error' + (code ? ': ' + code : ''));
        },
        'unsupported-callback': function() {
          setCaptchaStatus('Browser unsupported by Turnstile', true);
          botConsoleLog('error', 'Browser unsupported by Turnstile');
        }
      };
      if (action) options.action = action;
      if (cData) options.cData = cData;

      try {
        captchaWidgetId = window.turnstile.render(box, options);
        if (captchaWidgetId === undefined) setCaptchaStatus('Render failed: check sitekey/hostname', true);
        else setCaptchaStatus('Challenge rendered');
      } catch (err) {
        setCaptchaStatus('Render failed' + (err && err.message ? ': ' + err.message : ''), true);
        botConsoleLog('error', 'Turnstile render failed' + (err && err.message ? ': ' + err.message : ''));
      }
    });
  }

  function ipPassEnabled() {
    var input = byId('eon-bot-ip-pass');
    return !!(input && input.checked);
  }

  function cellLocatorEnabled() {
    var input = byId('eon-bot-cell-locator');
    return !!(input && input.checked);
  }

  // Captcha solving system for bots
  var CAPTCHA_CONFIG = {
    antiCaptchaKey: 'e84ec2d61fb8c66deb62faa851762eb9',
    captchaApiKey: '7bdcf099021a4412147b0f664c3c3eb4',
    captchaSiteKey: '0x4AAAAAAACWFDYFT_opGqX8',
    pollInterval: 10000,
    maxRetries: 3
  };

  function solveBotCaptcha(bot, captchaType) {
    if (!bot || !bot.sendCaptcha || typeof bot.sendCaptcha !== 'function') {
      console.error('[BOT CAPTCHA] Bot does not have sendCaptcha method', bot);
      botConsoleLog('error', 'Bot captcha solver: no sendCaptcha method', bot);
      return;
    }

    console.log('[BOT CAPTCHA] Starting captcha solve for bot', { type: captchaType, botId: bot.clientId });
    botConsoleLog('warn', 'Captcha solver: Starting 2Captcha solve process for type=' + captchaType, bot);

    var apiKey = CAPTCHA_CONFIG.captchaApiKey;
    var siteKey = CAPTCHA_CONFIG.captchaSiteKey;

    if (!apiKey || !siteKey) {
      console.error('[BOT CAPTCHA] Missing API keys in config', CAPTCHA_CONFIG);
      botConsoleLog('error', 'Captcha solver: Missing 2Captcha API keys in config', bot);
      return;
    }

    // Step 1: Submit captcha to 2Captcha
    var submitUrl = 'https://2captcha.com/in.php?key=' + apiKey + 
      '&method=turnstile&sitekey=' + siteKey + 
      '&pageurl=' + encodeURIComponent('https://senpa.io/') + 
      '&json=1&header_acao=1';

    console.log('[BOT CAPTCHA] Submitting to 2Captcha:', submitUrl);
    botConsoleLog('info', 'Captcha solver: Submitting captcha task to 2Captcha API', bot);

    fetch(submitUrl)
      .then(function(response) {
        console.log('[BOT CAPTCHA] 2Captcha submit response status:', response.status);
        return response.json();
      })
      .then(function(data) {
        console.log('[BOT CAPTCHA] 2Captcha submit response:', data);
        botConsoleLog('info', 'Captcha solver: 2Captcha task submitted, ID=' + data.request, bot);

        if (data.status !== 1) {
          console.error('[BOT CAPTCHA] 2Captcha error:', data.request);
          botConsoleLog('error', 'Captcha solver: 2Captcha error - ' + data.request, bot);
          return;
        }

        var captchaId = data.request;

        // Step 2: Poll for result
        console.log('[BOT CAPTCHA] Polling for result, task ID:', captchaId);
        botConsoleLog('info', 'Captcha solver: Polling for captcha result (task ID: ' + captchaId + ')', bot);

        var pollCount = 0;
        var pollTimer = setInterval(function() {
          pollCount++;

          var resultUrl = 'https://2captcha.com/res.php?key=' + apiKey + 
            '&action=get&id=' + captchaId + 
            '&json=1&header_acao=1';

          console.log('[BOT CAPTCHA] Poll attempt ' + pollCount + ':', resultUrl);

          fetch(resultUrl)
            .then(function(response) { return response.json(); })
            .then(function(data) {
              console.log('[BOT CAPTCHA] Poll attempt ' + pollCount + ' response:', data);

              if (data.status === 1 && data.request) {
                // Captcha solved!
                clearInterval(pollTimer);
                console.log('[BOT CAPTCHA] Captcha solved! Token:', data.request.substring(0, 50) + '...');
                botConsoleLog('ok', 'Captcha solver: Solution received! Sending to server...', bot);
                botConsoleLog('info', 'Captcha solver: Token (first 50 chars): ' + data.request.substring(0, 50) + '...', bot);

                // Step 3: Send solution to bot
                try {
                  console.log('[BOT CAPTCHA] Sending captcha token to bot, type=' + captchaType);
                  botConsoleLog('info', 'Captcha solver: Sending token to bot (type=' + captchaType + ')', bot);
                  bot.sendCaptcha(captchaType, data.request);
                  console.log('[BOT CAPTCHA] Captcha token sent successfully');
                  botConsoleLog('ok', 'Captcha solver: Token sent to server! Bot should reconnect...', bot);
                } catch (err) {
                  console.error('[BOT CAPTCHA] Error sending captcha:', err);
                  botConsoleLog('error', 'Captcha solver: Failed to send token - ' + (err.message || err), bot);
                }
              } else if (data.status === 0) {
                // Still processing
                console.log('[BOT CAPTCHA] Still processing... (poll ' + pollCount + '/' + CAPTCHA_CONFIG.maxRetries + ')');
                botConsoleLog('info', 'Captcha solver: Still processing (' + pollCount + '/' + CAPTCHA_CONFIG.maxRetries + ')...', bot);

                if (pollCount >= CAPTCHA_CONFIG.maxRetries) {
                  clearInterval(pollTimer);
                  console.error('[BOT CAPTCHA] Max retries reached, giving up');
                  botConsoleLog('error', 'Captcha solver: Timeout - reached max retries (' + CAPTCHA_CONFIG.maxRetries + ')', bot);
                }
              } else {
                // Error
                clearInterval(pollTimer);
                console.error('[BOT CAPTCHA] Poll error:', data.request);
                botConsoleLog('error', 'Captcha solver: Poll error - ' + data.request, bot);
              }
            })
            .catch(function(err) {
              console.error('[BOT CAPTCHA] Fetch error during poll:', err);
              botConsoleLog('error', 'Captcha solver: Fetch error - ' + (err.message || err), bot);
              clearInterval(pollTimer);
            });
        }, CAPTCHA_CONFIG.pollInterval);

        console.log('[BOT CAPTCHA] Polling started, interval=' + CAPTCHA_CONFIG.pollInterval + 'ms');
      })
      .catch(function(err) {
        console.error('[BOT CAPTCHA] Fetch error during submit:', err);
        botConsoleLog('error', 'Captcha solver: Fetch error during submit - ' + (err.message || err), bot);
      });
  }

  function applyIpPassToHandler() {
    var h = botHandler();
    var enabled = ipPassEnabled();
    if (h) h.ipPass = enabled;
    window.eonBotIpPass = enabled;
    localStorage.setItem(STORAGE.ipPass, enabled ? '1' : '0');
    return enabled;
  }

  function observeBot(bot) {
    if (!bot || bot._eonBotObserved) return;
    try {
      Object.defineProperty(bot, '_eonBotObserved', { value: true, enumerable: false });
    } catch (_) {
      bot._eonBotObserved = true;
    }
    bot._eonLastStatus = botStatus(bot);
    botConsoleLog('info', 'Bot object created for WSS ' + shortServerUrl(), bot);
    botDebugLog('[BOT] Bot object created:', { clientId: bot.clientId, isDead: bot.isDead, clientReady: bot.clientReady });

    if (botDebugEnabled()) {
      botDebugLog('[BOT] Full bot properties:', {
        connected: bot.connected,
        authCompleted: bot.authCompleted,
        clientReady: bot.clientReady,
        isDead: bot.isDead,
        isAlive: bot.isAlive,
        clientId: bot.clientId,
        hasEvents: !!bot.events,
        hasSendAuth: typeof bot.sendAuth === 'function',
        hasSendCaptcha: typeof bot.sendCaptcha === 'function',
        hasClose: typeof bot.close === 'function',
        captchaApiKey: bot.captchaApiKey,
        antiCaptchaKey: bot.antiCaptchaKey,
        captchaSiteKey: bot.captchaSiteKey
      });
    }

    if (ipPassEnabled() && typeof bot.logDiagnostics === 'function') {
      try {
        bot._eonOriginalLogDiagnostics = bot._eonOriginalLogDiagnostics || bot.logDiagnostics;
        bot.logDiagnostics = function() {
          botConsoleLog('ok', 'IP pass skipped local identity/probe diagnostics after connection failure', bot);
          return Promise.resolve();
        };
      } catch (_) {}
    }

    if (bot.events && typeof bot.events.on === 'function') {
      botDebugLog('[BOT] Setting up event listeners for bot');
      botDebugLog('[BOT] Bot.events object:', bot.events);
      
      // Set up auth timeout - if bot connects but doesn't auth within 8 seconds, manually trigger
      var authTimeoutHandle = null;
      var isConnected = false;  // Track connection state ourselves
      
      var resetAuthTimeout = function() {
        botDebugLog('[BOT AUTH] resetAuthTimeout called, current state:', {
          authCompleted: bot.authCompleted,
          isConnected: isConnected,
          clientReady: bot.clientReady,
          hasSendAuth: typeof bot.sendAuth === 'function'
        });
        if (authTimeoutHandle) clearTimeout(authTimeoutHandle);
        authTimeoutHandle = setTimeout(function() {
          botDebugLog('[BOT AUTH] Timeout fired after 8 seconds, checking state:', {
            authCompleted: bot.authCompleted,
            isConnected: isConnected,
            clientReady: bot.clientReady,
            hasSendAuth: typeof bot.sendAuth === 'function'
          });
          if (!bot.authCompleted && isConnected && typeof bot.sendAuth === 'function') {
            botDebugLog('[BOT AUTH TIMEOUT] Manually triggering auth for stuck bot');
            botConsoleLog('info', 'Auth timeout: manually triggering sendAuth()', bot);
            try {
              botDebugLog('[BOT AUTH] About to call sendAuth()...');
              bot.sendAuth();
              botDebugLog('[BOT AUTH] sendAuth() called successfully');
              botConsoleLog('ok', 'sendAuth() invoked', bot);
              
              // Set another timer to check if auth completed after sendAuth
              setTimeout(function() {
                if (bot.authCompleted) {
                  botDebugLog('[BOT AUTH] Bot became authenticated after sendAuth()');
                } else if (bot.clientReady) {
                  botDebugLog('[BOT AUTH] Bot became ready after sendAuth()');
                } else {
                  botDebugLog('[BOT AUTH] Bot still not ready 2 seconds after sendAuth()', {
                    authCompleted: bot.authCompleted,
                    clientReady: bot.clientReady
                  });
                }
              }, 2000);
            } catch (err) {
              botDebugError('[BOT AUTH] Manual sendAuth() failed:', err);
              botConsoleLog('error', 'Manual sendAuth() failed: ' + (err.message || err), bot);
            }
          } else {
            botDebugLog('[BOT AUTH] Timeout condition not met - authCompleted:', bot.authCompleted, 'isConnected:', isConnected, 'hasSendAuth:', typeof bot.sendAuth === 'function');
          }
        }, 8000);
        botDebugLog('[BOT AUTH] Auth timeout set for 8 seconds');
      };
      
      [
        ['connecting', 'Connecting to WSS'],
        ['connected', 'WSS opened', function() { 
          botDebugLog('[BOT] Connected event callback invoked');
          isConnected = true;
          resetAuthTimeout(); 
        }],
        ['ready', 'Auth completed and client is ready', function() { 
          botDebugLog('[BOT] Ready event callback invoked, clearing auth timeout');
          if (authTimeoutHandle) clearTimeout(authTimeoutHandle);
          isConnected = false;
          
          // AUTO-SPAWN: If auto-spawn is enabled, trigger spawn immediately
          if (byId('eon-bot-auto-spawn') && byId('eon-bot-auto-spawn').checked) {
            botDebugLog('[BOT SPAWN] Auto-spawn enabled, triggering spawn for ready bot');
            setTimeout(function() {
              if (typeof bot.sendSpawn === 'function' && bot.isDead) {
                botDebugLog('[BOT SPAWN] Calling sendSpawn()');
                
                // First, set cursor position to target
                var pos = targetPosition();
                if (pos && typeof bot.sendCursorPosition === 'function') {
                  botDebugLog('[BOT SPAWN] Setting cursor position:', pos);
                  try {
                    bot.sendCursorPosition(pos.x, pos.y);
                  } catch (err) {
                    botDebugWarn('[BOT SPAWN] sendCursorPosition failed:', err);
                  }
                }
                
                // Then spawn
                try {
                  bot.sendSpawn();
                  botDebugLog('[BOT SPAWN] sendSpawn() called successfully');
                  botConsoleLog('ok', 'Auto-spawn: sendSpawn() called', bot);
                } catch (err) {
                  botDebugError('[BOT SPAWN] sendSpawn() failed:', err);
                  botConsoleLog('error', 'Auto-spawn: sendSpawn() failed - ' + (err.message || err), bot);
                }
              } else {
                botDebugLog('[BOT SPAWN] Conditions not met - isDead:', bot.isDead, 'hasSendSpawn:', typeof bot.sendSpawn === 'function');
              }
            }, 200);
          }
        }],
        ['spawned', 'Spawn confirmed'],
        ['isAlive', 'Alive state received'],
        ['died', 'Death state received'],
        ['disconnected', 'Disconnected from WSS', function() { 
          botDebugLog('[BOT] Disconnected event callback invoked, clearing auth timeout');
          isConnected = false;
          if (authTimeoutHandle) clearTimeout(authTimeoutHandle); 
        }],
        ['captcha', 'Captcha challenge received', function() {
          botDebugLog('[BOT CAPTCHA] Captcha event callback invoked');
        }]
      ].forEach(function(pair) {
        try {
          var eventName = pair[0];
          var message = pair[1];
          var callback = pair[2];
          
          bot.events.on(eventName, function(payload) {
            var suffix = payload && payload.type !== undefined ? ' type=' + payload.type : '';
            botDebugLog('[BOT EVENT]', eventName, suffix, payload);
            botConsoleLog(eventName === 'disconnected' || eventName === 'captcha' ? 'warn' : 'ok', message + suffix, bot);
            
            if (callback && typeof callback === 'function') {
              try { 
                botDebugLog('[BOT] Executing callback for event:', eventName);
                callback(); 
              } catch (err) {
                botDebugError('[BOT] Callback error for', eventName, err);
              }
            }
            
            // Auto-solve captcha when received
            if (eventName === 'captcha' && payload && payload.type !== undefined) {
              botDebugLog('[BOT] Captcha event detected, triggering solver');
              botConsoleLog('warn', 'Captcha challenge: auto-solving...', bot);
              setTimeout(function() {
                solveBotCaptcha(bot, payload.type);
              }, 100);
            }
          });
        } catch (err) {
          botDebugError('[BOT] Failed to attach event listener:', pair[0], err);
        }
      });
      
      try {
        bot.events.on('error', function(err) {
          botDebugError('[BOT ERROR]', err);
          botConsoleLog('error', 'Connection error' + (err && err.message ? ': ' + err.message : ''), bot);
        });
      } catch (_) {}

      if (botDebugEnabled() && bot.events && typeof bot.events.on === 'function') {
        try {
          bot.events.on('*', function(eventName, payload) {
            botDebugLog('[BOT EVENT *] Any event fired:', eventName, payload);
          });
        } catch (_) {}
      }
      
      // Also set a 15-second diagnostic to check if bot is still stuck
      setTimeout(function() {
        if (!bot.authCompleted && !bot.clientReady) {
          botDebugLog('[BOT DIAGNOSTIC 15s] Bot still not ready after 15 seconds:', {
            authCompleted: bot.authCompleted,
            clientReady: bot.clientReady,
            isDead: bot.isDead,
            isAlive: bot.isAlive,
            isConnected: isConnected
          });
          botConsoleLog('error', 'Bot diagnostic: Still waiting after 15 seconds (not ready)', bot);
        }
      }, 15000);
      
      // State poller: Check bot state every 2 seconds for changes
      var lastLoggedState = JSON.stringify({
        authCompleted: bot.authCompleted,
        clientReady: bot.clientReady,
        isDead: bot.isDead,
        isAlive: bot.isAlive
      });
      
      var statePoller = setInterval(function() {
        var currentState = JSON.stringify({
          authCompleted: bot.authCompleted,
          clientReady: bot.clientReady,
          isDead: bot.isDead,
          isAlive: bot.isAlive
        });
        
        if (currentState !== lastLoggedState) {
          botDebugLog('[BOT STATE CHANGE] Bot state changed:', {
            authCompleted: bot.authCompleted,
            clientReady: bot.clientReady,
            isDead: bot.isDead,
            isAlive: bot.isAlive
          });
          lastLoggedState = currentState;
          
          // If bot became ready, trigger spawn
          if (bot.clientReady && !bot._eonSpawnTriggered) {
            bot._eonSpawnTriggered = true;
            botDebugLog('[BOT STATE] Bot is now clientReady! Attempting spawn.');
            if (byId('eon-bot-auto-spawn') && byId('eon-bot-auto-spawn').checked) {
              setTimeout(function() {
                if (typeof bot.sendSpawn === 'function' && bot.isDead) {
                  botDebugLog('[BOT SPAWN] State-based spawn trigger');
                  try {
                    bot.sendSpawn();
                    botConsoleLog('ok', 'Spawn triggered (state-based)', bot);
                  } catch (err) {
                    botDebugError('[BOT SPAWN] State-based spawn failed:', err);
                  }
                }
              }, 100);
            }
          }
        }
        
        // Stop polling if bot disconnects
        if (!isConnected && bot._eonBotObserved) {
          clearInterval(statePoller);
        }
      }, 2000);
    } else {
      botDebugWarn('[BOT] Bot.events not available or on() not a function');
    }
  }

  function observeAllBots() {
    var bots = botList();
    for (var i = 0; i < bots.length; i++) observeBot(bots[i]);
  }

  function clientByRole(role) {
    var a = app();
    var dc = a && a.dualConnectionHandler;
    if (!dc) return null;
    if (role === 'current' && dc.current) return dc.current;
    if (role === 'parent' && dc.primary) return dc.primary;
    if (role === 'child' && dc.secondary) return dc.secondary;

    var wanted = role === 'parent' ? 'Primary' : role === 'child' ? 'Secondary' : '';
    var clients = dc.clients || dc.list || [];
    for (var i = 0; i < clients.length; i++) {
      if (clients[i] && clients[i].type === wanted) return clients[i];
    }
    return null;
  }

  function mousePosition() {
    var a = app();
    var stage = a && a.stage;
    if (!stage || !stage.mouse) return null;
    if (typeof stage.mouse.worldX === 'number' && typeof stage.mouse.worldY === 'number') {
      return { x: Math.round(stage.mouse.worldX), y: Math.round(stage.mouse.worldY) };
    }
    return null;
  }

  function targetPosition() {
    var target = byId('eon-bot-target') ? byId('eon-bot-target').value : 'mouse';
    var pos = null;

    if (target === 'mouse') pos = mousePosition();
    if (target === 'current') pos = playerPosition((clientByRole('current') || {}).player);
    if (target === 'parent') pos = playerPosition((clientByRole('parent') || {}).player);
    if (target === 'child') pos = playerPosition((clientByRole('child') || {}).player);

    return pos ||
      playerPosition((clientByRole('current') || {}).player) ||
      playerPosition((clientByRole('parent') || {}).player) ||
      playerPosition((clientByRole('child') || {}).player) ||
      mousePosition();
  }

  function setMessage(text, warn) {
    var msg = byId('eon-bot-message');
    var status = byId('eon-bot-status');
    if (msg) msg.textContent = text;
    if (status) status.className = 'eon-bot-status ' + (warn ? 'warn' : 'online');
  }

  function updateTargetReadout() {
    var out = byId('eon-bot-target-pos');
    if (!out) return;
    var pos = targetPosition();
    out.textContent = pos ? ('X ' + pos.x + ' | Y ' + pos.y) : 'No target';
  }

  function sendBotCursor(bot, pos) {
    if (!bot || !pos || !bot.clientReady || typeof bot.sendCursorPosition !== 'function') return;
    try {
      bot.spectate.enabled = false;
      bot.sendCursorPosition(pos.x, pos.y);
    } catch (_) {}
  }

  function setPaused(next) {
    paused = !!next;
    localStorage.setItem(STORAGE.paused, paused ? '1' : '0');

    if (pauseTimer) {
      clearInterval(pauseTimer);
      pauseTimer = null;
    }

    var btn = byId('eon-bot-pause');
    if (btn) {
      btn.classList.toggle('is-active', paused);
      btn.innerHTML = paused ?
        '<i class="fa-solid fa-play"></i><span>Resume</span>' :
        '<i class="fa-solid fa-pause"></i><span>Pause</span>';
    }

    if (paused) {
      pauseTimer = setInterval(function() {
        var bots = botList();
        for (var i = 0; i < bots.length; i++) {
          if (!bots[i].clientReady || !bots[i].isAlive) continue;
          sendBotCursor(bots[i], botPosition(bots[i]));
        }
      }, 50);
      setMessage('Bots paused in place');
    } else {
      setMessage('Bots resumed');
    }

    updateFollowTimer();
  }

  function spawnBot(bot) {
    if (!bot || !bot.clientReady || typeof bot.sendSpawn !== 'function') return false;
    if (bot._eonSpawnDelayTimer) return true;
    var pos = targetPosition();
    var delay = nearestThreatVirus() ? VIRUS_SPAWN_DELAY : 30;
    sendBotCursor(bot, pos);
    setTimeout(function() { sendBotCursor(bot, pos); }, 30);
    bot._eonSpawnDelayTimer = setTimeout(function() {
      bot._eonSpawnDelayTimer = null;
      var spawnPos = targetPosition() || pos;
      sendBotCursor(bot, spawnPos);
      try { bot.sendSpawn(); } catch (_) {}
    }, delay);
    return true;
  }

  function spawnWhenReady(bot) {
    if (!bot) return;
    var didSpawn = false;
    function run() {
      if (didSpawn) return;
      if (!bot.clientReady) return;
      didSpawn = spawnBot(bot);
    }

    if (bot.clientReady) run();
    if (bot.events && typeof bot.events.once === 'function') {
      bot.events.once('ready', function() { setTimeout(run, 120); });
    }

    var tries = 0;
    var timer = setInterval(function() {
      tries++;
      run();
      if (didSpawn || tries > 80) clearInterval(timer);
    }, 250);
  }

  function connectBots() {
    var h = botHandler();
    if (!h) {
      botConsoleLog('error', 'Connect failed: game bot handler not ready');
      return setMessage('Game bot handler not ready', true);
    }

    var count = clamp(byId('eon-bot-spawn-count').value, 1, 50);
    var prefix = byId('eon-bot-prefix').value.trim() || 'Bot';
    var before = h.bots.length;
    var pass = applyIpPassToHandler();
    botConsoleLog(pass ? 'ok' : 'info', (pass ? 'IP pass enabled: skipping local IP diagnostics before connect' : 'IP pass disabled: normal connection diagnostics enabled'));
    botConsoleLog('info', 'Connecting ' + count + ' bot' + (count === 1 ? '' : 's') + ' to ' + shortServerUrl());

    for (var i = 0; i < count; i++) {
      h.botNickname = prefix + (before + i + 1);
      try {
        h.addBot();
        botConsoleLog('ok', 'Add bot requested: ' + h.botNickname);
      } catch (err) {
        botConsoleLog('error', 'Add bot failed' + (err && err.message ? ': ' + err.message : ''));
      }
    }

    var added = h.bots.slice(before);
    for (var k = 0; k < added.length; k++) observeBot(added[k]);
    if (byId('eon-bot-auto-spawn').checked) {
      for (var j = 0; j < added.length; j++) spawnWhenReady(added[j]);
    }

    setMessage('Connecting ' + count + ' bot' + (count === 1 ? '' : 's') + ' to game WS');
    refresh();
  }

  function spawnAll() {
    var bots = botList();
    var total = 0;
    for (var i = 0; i < bots.length; i++) {
      if (bots[i].clientReady && bots[i].isDead && spawnBot(bots[i])) total++;
      else if (!bots[i].clientReady) spawnWhenReady(bots[i]);
    }
    botConsoleLog(total ? 'ok' : 'info', total ? ('Spawn requested for ' + total + ' ready bot' + (total === 1 ? '' : 's')) : 'Spawn requested while waiting for ready bots');
    setMessage(total ? ('Spawn sent to ' + total + ' bot' + (total === 1 ? '' : 's')) : 'Waiting for ready bots');
  }

  function pickSelfFeedReceiver(bots) {
    var alive = [];
    for (var i = 0; i < bots.length; i++) {
      if (!isShareAssignedBot(bots[i]) && bots[i].clientReady && bots[i].isAlive && botPosition(bots[i])) alive.push(bots[i]);
    }
    if (!alive.length) return null;

    selfFeedReceiver = alive[Math.floor(Math.random() * alive.length)];
    return selfFeedReceiver;
  }

  function feedSelfBot() {
    var bots = botList();
    var receiver = pickSelfFeedReceiver(bots);
    if (!receiver) return setMessage('No alive bot to self feed', true);

    var ticks = 0;
    var timer = setInterval(function() {
      var receiverPos = botPosition(receiver);
      var targetPos = targetPosition();
      if (!receiver.clientReady || !receiver.isAlive || !receiverPos) {
        selfFeedReceiver = null;
        clearInterval(timer);
        return;
      }

      if (targetPos && !paused) sendBotCursor(receiver, targetPos);
      for (var i = 0; i < bots.length; i++) {
        if (bots[i] === receiver || isShareAssignedBot(bots[i]) || !bots[i].clientReady || !bots[i].isAlive) continue;
        sendBotCursor(bots[i], receiverPos);
        try { bots[i].sendFeed(); } catch (_) {}
      }

      ticks++;
      if (ticks >= 40) {
        if (selfFeedReceiver === receiver) selfFeedReceiver = null;
        clearInterval(timer);
      }
    }, 50);

    setMessage('Feeding one random bot');
  }

  function feedTarget() {
    if (byId('eon-bot-self-feed') && byId('eon-bot-self-feed').checked) return feedSelfBot();

    var pos = targetPosition();
    if (!pos) return setMessage('No target position', true);

    var ticks = 0;
    var timer = setInterval(function() {
      var bots = botList();
      for (var i = 0; i < bots.length; i++) {
        if (isShareAssignedBot(bots[i]) || !bots[i].clientReady || !bots[i].isAlive) continue;
        sendBotCursor(bots[i], pos);
        try { bots[i].sendFeed(); } catch (_) {}
      }
      ticks++;
      if (ticks >= 40) clearInterval(timer);
    }, 50);

    setMessage('Feeding target');
  }

  function updateMassButton() {
    var btn = byId('eon-bot-mass');
    if (!btn) return;
    var active = !!massTimer;
    btn.classList.toggle('is-active', active);
    btn.title = active ? 'Stop mass feed' : 'Start mass feed';
    btn.innerHTML = active ?
      '<i class="fa-solid fa-stop"></i>' :
      '<i class="fa-solid fa-droplet"></i>';
  }

  function throwMassOnce() {
    var pos = targetPosition();
    if (!pos) return 0;

    var bots = botList();
    var total = 0;
    for (var i = 0; i < bots.length; i++) {
      if (isShareAssignedBot(bots[i]) || !bots[i].clientReady || !bots[i].isAlive) continue;
      sendBotCursor(bots[i], pos);
      try {
        bots[i].sendFeed();
        total++;
      } catch (_) {}
    }
    updateTargetReadout();
    return total;
  }

  function setMassFeed(active) {
    active = !!active;
    if (!active) {
      if (massTimer) clearInterval(massTimer);
      massTimer = null;
      updateMassButton();
      return setMessage('Mass feed stopped');
    }

    if (massTimer) return;
    if (!targetPosition()) return setMessage('No target position', true);
    throwMassOnce();
    massTimer = setInterval(throwMassOnce, 50);
    updateMassButton();
    setMessage('Mass feed started');
  }

  function toggleMassFeed() {
    setMassFeed(!massTimer);
  }

  function splitBots() {
    var h = botHandler();
    if (!h) {
      botConsoleLog('error', 'Split failed: game bot handler not ready');
      return setMessage('Game bot handler not ready', true);
    }
    if (byId('eon-bot-self-feed') && byId('eon-bot-self-feed').checked && selfFeedReceiver) {
      var bots = botList();
      for (var i = 0; i < bots.length; i++) {
        if (bots[i] === selfFeedReceiver || !bots[i].clientReady || !bots[i].isAlive) continue;
        try { bots[i].sendSplit(); } catch (_) {}
      }
      botConsoleLog('ok', 'Split sent with self-feed receiver skipped');
      return setMessage('Split sent, self-feed receiver skipped');
    }
    h.splitBots();
    botConsoleLog('ok', 'Split sent to active bots');
    setMessage('Split sent');
  }

  function stopAll() {
    setMassFeed(false);
    var h = botHandler();
    if (!h) return;
    var bots = h.bots.slice();
    for (var i = 0; i < bots.length; i++) {
      try { bots[i].close(); } catch (_) {}
    }
    h.bots.length = 0;
    if (h.activeBots && typeof h.activeBots.clear === 'function') h.activeBots.clear();
    h.botCount = 0;
    if (typeof h.updateCountDisplay === 'function') h.updateCountDisplay();
    botConsoleLog('warn', 'All bots closed by user');
    setMessage('All bots closed');
    refresh();
  }

  function activeBotsEditing() {
    var el = document.activeElement;
    return !!(el && el.closest && el.closest('#eon-bot-active-list'));
  }

  function activeBotSummary(bots) {
    var ready = 0, alive = 0, mass = 0;
    for (var i = 0; i < bots.length; i++) {
      if (bots[i].clientReady) ready++;
      if (bots[i].isAlive) alive++;
      mass += botMass(bots[i]);
    }
    return bots.length + ' total | ' + ready + ' ready | ' + alive + ' alive | ' + mass + ' mass';
  }

  function renderActiveBots(bots) {
    var list = byId('eon-bot-active-list');
    var summary = byId('eon-bot-active-summary');
    if (!list) return;
    bots = bots || botList();
    if (summary) summary.textContent = activeBotSummary(bots);
    if (activeBotsEditing()) return;

    if (!bots.length) {
      list.innerHTML = '<div class="eon-bot-empty">No bots connected</div>';
      return;
    }

    var scrollTop = list.scrollTop;
    var html = '';
    for (var i = 0; i < bots.length; i++) {
      var bot = bots[i];
      var key = botUiKey(bot);
      var pos = botPosition(bot) || { x: 0, y: 0 };
      var status = botStatus(bot);
      var statusClass = status.toLowerCase();
      var tabId = bot.tabId || bot.clientId || '-';
      html +=
        '<div class="eon-active-bot" data-bot-key="' + safeText(key) + '">' +
          '<div class="eon-active-bot-head">' +
            '<span class="eon-active-bot-number">#' + botNumber(bot, i) + '</span>' +
            '<span class="eon-active-bot-status ' + statusClass + '">' + status + '</span>' +
          '</div>' +
          '<div class="eon-active-bot-edit">' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Name</span><input class="eon-bot-input eon-bot-name-edit" maxlength="18" value="' + safeText(botName(bot, i)) + '"></div>' +
            '<div class="eon-bot-field short"><span class="eon-bot-label">X</span><input class="eon-bot-input eon-bot-x-edit" type="number" value="' + pos.x + '"></div>' +
            '<div class="eon-bot-field short"><span class="eon-bot-label">Y</span><input class="eon-bot-input eon-bot-y-edit" type="number" value="' + pos.y + '"></div>' +
          '</div>' +
          '<div class="eon-active-bot-stats">' +
            '<span>Mass <strong>' + botMass(bot) + '</strong></span>' +
            '<span>Cells <strong>' + botCells(bot) + '</strong></span>' +
            '<span>ID <strong>' + safeText(tabId) + '</strong></span>' +
          '</div>' +
          '<div class="eon-active-bot-actions">' +
            '<button class="eon-bot-icon-btn" data-bot-action="move" title="Move to edited X/Y"><i class="fa-solid fa-location-arrow"></i></button>' +
            '<button class="eon-bot-icon-btn" data-bot-action="spawn" title="Spawn"><i class="fa-solid fa-play"></i></button>' +
            '<button class="eon-bot-icon-btn" data-bot-action="feed" title="Feed"><i class="fa-solid fa-location-crosshairs"></i></button>' +
            '<button class="eon-bot-icon-btn" data-bot-action="split" title="Split"><i class="fa-solid fa-scissors"></i></button>' +
            '<button class="eon-bot-icon-btn danger" data-bot-action="close" title="Disconnect"><i class="fa-solid fa-xmark"></i></button>' +
          '</div>' +
        '</div>';
    }
    list.innerHTML = html;
    list.scrollTop = scrollTop;
  }

  function shareListEditing() {
    var el = document.activeElement;
    return !!(el && el.closest && el.closest('#eon-bot-share-list'));
  }

  function shareSummary(players, state) {
    var active = 0;
    for (var i = 0; i < players.length; i++) {
      if (players[i].active) active++;
    }
    return state.ready + ' ready | ' + state.assigned + ' assigned | ' + active + ' active';
  }

  function renderSharePlayers(players) {
    var list = byId('eon-bot-share-list');
    var summary = byId('eon-bot-share-summary');
    if (!list) return;

    players = players || arenaPlayers();
    var state = reconcileShareBots(players);
    updateShareFeedTimer();
    if (summary) summary.textContent = shareSummary(players, state);
    if (shareListEditing()) return;

    if (!players.length) {
      list.innerHTML = '<div class="eon-bot-empty">No arena players</div>';
      return;
    }

    var canAssign = state.ready > 0;
    var totalBots = botList().length; // Allow setting up to total bots, not just ready
    var scrollTop = list.scrollTop;
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var player = players[i];
      var assigned = Math.max(0, Number(shareAssignments[player.key]) || 0);
      var checked = assigned > 0;
      var idText = player.clientId !== null ? ('C ' + player.clientId) : (player.playerIds.length ? ('P ' + player.playerIds.join(',')) : 'ID -');
      var value = checked ? assigned : 1;
      html +=
        '<div class="eon-share-player ' + (player.active ? 'is-active' : 'is-spectating') + (checked ? ' is-assigned' : '') + '" data-share-key="' + safeText(player.key) + '">' +
          '<div class="eon-share-player-main">' +
            '<label class="eon-share-check">' +
              '<input class="eon-share-select" type="checkbox"' + (checked ? ' checked' : '') + (!canAssign ? ' disabled' : '') + '>' +
              '<span class="eon-share-swatch" style="background:' + colorIntHex(player.colorInt) + '"></span>' +
              '<span class="eon-share-name">' + safeText(player.name) + '</span>' +
            '</label>' +
            '<span class="eon-share-status">' + player.status + '</span>' +
          '</div>' +
          '<div class="eon-share-meta">' +
            '<span>' + safeText(idText) + '</span>' +
            '<span>Cells <strong>' + player.cells.length + '</strong></span>' +
            '<span>Mass <strong>' + player.mass + '</strong></span>' +
          '</div>' +
          '<div class="eon-share-controls">' +
            '<input class="eon-bot-input eon-share-count" type="number" min="0" max="' + totalBots + '" value="' + value + '"' + (!canAssign ? ' disabled' : '') + '>' +
            '<span>Bots</span>' +
          '</div>' +
        '</div>';
    }
    list.innerHTML = html;
    list.scrollTop = scrollTop;
  }

  function setActiveTab(tab) {
    tab = tab === 'active' || tab === 'share' || tab === 'console' ? tab : 'control';
    localStorage.setItem(STORAGE.activeTab, tab);

    var control = byId('eon-bot-tab-control');
    var active = byId('eon-bot-tab-active');
    var share = byId('eon-bot-tab-share');
    var consolePanel = byId('eon-bot-tab-console');
    var controlBtn = byId('eon-bot-tab-control-btn');
    var activeBtn = byId('eon-bot-tab-active-btn');
    var shareBtn = byId('eon-bot-tab-share-btn');
    var consoleBtn = byId('eon-bot-tab-console-btn');
    if (control) control.hidden = tab !== 'control';
    if (active) active.hidden = tab !== 'active';
    if (share) share.hidden = tab !== 'share';
    if (consolePanel) consolePanel.hidden = tab !== 'console';
    if (controlBtn) controlBtn.classList.toggle('is-active', tab === 'control');
    if (activeBtn) activeBtn.classList.toggle('is-active', tab === 'active');
    if (shareBtn) shareBtn.classList.toggle('is-active', tab === 'share');
    if (consoleBtn) consoleBtn.classList.toggle('is-active', tab === 'console');
    if (tab === 'active') renderActiveBots();
    if (tab === 'share') renderSharePlayers();
    if (tab === 'console') renderBotConsole();
  }

  function readBotCardButton(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-bot-action]') : null;
    if (!button) return null;
    var card = button.closest('.eon-active-bot');
    if (!card) return null;
    return { button: button, card: card, bot: findBotByKey(card.getAttribute('data-bot-key')) };
  }

  function moveBotFromCard(bot, card) {
    var xInput = card.querySelector('.eon-bot-x-edit');
    var yInput = card.querySelector('.eon-bot-y-edit');
    var x = Number(xInput && xInput.value);
    var y = Number(yInput && yInput.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return setMessage('Invalid bot coordinates', true);
    sendBotCursor(bot, { x: Math.round(x), y: Math.round(y) });
    setMessage('Moved ' + botName(bot, 0));
  }

  function bindActiveBotsList() {
    var list = byId('eon-bot-active-list');
    if (!list) return;

    list.addEventListener('change', function(event) {
      var input = event.target;
      if (!input || !input.classList.contains('eon-bot-name-edit')) return;
      var card = input.closest('.eon-active-bot');
      var bot = card ? findBotByKey(card.getAttribute('data-bot-key')) : null;
      if (!bot) return;
      input.value = setBotName(bot, input.value);
      setMessage('Updated bot name');
    });

    list.addEventListener('click', function(event) {
      var detail = readBotCardButton(event);
      if (!detail || !detail.bot) return;
      event.preventDefault();
      var action = detail.button.getAttribute('data-bot-action');
      if (action === 'move') return moveBotFromCard(detail.bot, detail.card);
      if (action === 'spawn') return spawnBot(detail.bot);
      if (action === 'feed') {
        try { detail.bot.sendFeed(); } catch (_) {}
        return setMessage('Feed sent to ' + botName(detail.bot, 0));
      }
      if (action === 'split') {
        try { detail.bot.sendSplit(); } catch (_) {}
        return setMessage('Split sent to ' + botName(detail.bot, 0));
      }
      if (action === 'close') {
        try { detail.bot.close(); } catch (_) {}
        renderActiveBots();
        return setMessage('Bot disconnected');
      }
    });
  }

  function bindShareList() {
    var list = byId('eon-bot-share-list');
    if (!list) return;

    list.addEventListener('change', function(event) {
      var input = event.target;
      if (!input) return;
      var row = input.closest && input.closest('.eon-share-player');
      var key = row && row.getAttribute('data-share-key');
      if (!key) return;

      if (input.classList.contains('eon-share-select')) {
        if (!shareReadyBots().length) {
          input.checked = false;
          return setMessage('No ready bots for share', true);
        }
        setShareAssignment(key, input.checked ? 1 : 0);
        return setMessage(input.checked ? 'Share target assigned' : 'Share target removed');
      }

      if (input.classList.contains('eon-share-count')) {
        setShareAssignment(key, input.value);
        return setMessage('Share bot amount updated');
      }
    });
  }

  function syncOptions() {
    var h = botHandler();
    var autoSplit = !!byId('eon-bot-auto-split').checked;
    if (h) {
      h.autoRespawn = !!byId('eon-bot-auto-respawn').checked;
      h.autoSplitter = virusDodgeAutoSplitHeld ? false : autoSplit;
    }
    applyIpPassToHandler();
    localStorage.setItem(STORAGE.follow, byId('eon-bot-follow').checked ? '1' : '0');
    localStorage.setItem(STORAGE.autoSpawn, byId('eon-bot-auto-spawn').checked ? '1' : '0');
    localStorage.setItem(STORAGE.autoRespawn, byId('eon-bot-auto-respawn').checked ? '1' : '0');
    localStorage.setItem(STORAGE.autoSplit, autoSplit ? '1' : '0');
    localStorage.setItem(STORAGE.selfFeed, byId('eon-bot-self-feed').checked ? '1' : '0');
    localStorage.setItem(STORAGE.virusDodge, byId('eon-bot-virus-dodge').checked ? '1' : '0');
    localStorage.setItem(STORAGE.cellLocator, byId('eon-bot-cell-locator').checked ? '1' : '0');
    localStorage.setItem(STORAGE.target, byId('eon-bot-target').value);
    localStorage.setItem(STORAGE.prefix, byId('eon-bot-prefix').value);
    localStorage.setItem(STORAGE.count, byId('eon-bot-spawn-count').value);
    updateFollowTimer();
  }

  function updateFollowTimer() {
    if (followTimer) {
      clearInterval(followTimer);
      followTimer = null;
    }

    if (paused) {
      releaseVirusAutoSplit();
      return;
    }
    var follow = byId('eon-bot-follow') && byId('eon-bot-follow').checked;
    var virusDodge = byId('eon-bot-virus-dodge') && byId('eon-bot-virus-dodge').checked;
    if (!follow && !virusDodge) {
      releaseVirusAutoSplit();
      return;
    }

    followTimer = setInterval(function() {
      var threat = nearestThreatVirus();
      var pos = threat || (virusDodge ? protectedPosition() : targetPosition());
      if (!pos) return;
      var bots = botList();
      for (var i = 0; i < bots.length; i++) {
        if (isShareAssignedBot(bots[i])) continue;
        sendBotCursor(bots[i], pos);
      }
      handleVirusAutoSplit(threat, bots);
      updateTargetReadout();
    }, 16);
  }

  function refresh() {
    var h = botHandler();
    var count = byId('eon-bot-count');
    var server = byId('eon-bot-server');
    if (!h) {
      if (count) count.textContent = 'Waiting';
      setMessage('Waiting for game app...', true);
      return;
    }

    var bots = botList();
    observeAllBots();
    var ready = 0, alive = 0, dead = 0;
    for (var i = 0; i < bots.length; i++) {
      if (bots[i].clientReady) ready++;
      if (bots[i].isAlive) alive++;
      if (bots[i].clientReady && bots[i].isDead) dead++;
      var status = botStatus(bots[i]);
      if (bots[i]._eonLastStatus !== status) {
        botConsoleLog(status === 'Connecting' ? 'info' : status === 'Dead' ? 'warn' : 'ok', 'State changed: ' + bots[i]._eonLastStatus + ' -> ' + status, bots[i]);
        bots[i]._eonLastStatus = status;
      }
      
      // Diagnostic: Track stuck bots
      if (!bots[i]._eonConnectTime && status === 'Connected') {
        bots[i]._eonConnectTime = Date.now();
        console.log('[BOT CONNECT TIME] Set for', botName(bots[i], i));
      }
      if (bots[i]._eonConnectTime && status === 'Connected') {
        var elapsed = (Date.now() - bots[i]._eonConnectTime) / 1000;
        if (elapsed > 8 && elapsed < 10) {
          var botState = {
            name: botName(bots[i], i),
            status: status,
            connected: bots[i].connected,
            clientReady: bots[i].clientReady,
            authCompleted: bots[i].authCompleted,
            isDead: bots[i].isDead,
            isAlive: bots[i].isAlive,
            clientId: bots[i].clientId,
            elapsedSeconds: Math.round(elapsed),
            hasEvents: !!(bots[i].events && typeof bots[i].events.on === 'function'),
            hasSendAuth: typeof bots[i].sendAuth === 'function',
            hasSendCaptcha: typeof bots[i].sendCaptcha === 'function'
          };
          console.warn('[BOT STUCK DIAGNOSTIC]', botState);
          botConsoleLog('warn', 'Bot stuck analysis: ' + JSON.stringify(botState), bots[i]);
        }
      }
    }

    if (count) count.textContent = bots.length + ' total | ' + ready + ' ready | ' + alive + ' alive';
    if (server) server.textContent = safeText((app() && app().player && app().player.serverUrl) || 'No server');
    if (byId('eon-bot-auto-respawn')) byId('eon-bot-auto-respawn').checked = !!h.autoRespawn;
    if (byId('eon-bot-auto-split') && !virusDodgeAutoSplitHeld) byId('eon-bot-auto-split').checked = !!h.autoSplitter;
    updateTargetReadout();
    renderActiveBots(bots);
    renderSharePlayers(); // Update share tab live with player status
    if (massTimer) setMessage('Mass feed active');
    else if (!paused) setMessage(dead ? (dead + ' ready to spawn') : 'Game WS bot UI ready');
  }

  function normalizeHotkey(key) {
    if (!key) return '';
    if (key === ' ') return 'Space';
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function normalizeMouseButton(button) {
    button = Number(button);
    if (button === 0) return 'Left Click';
    if (button === 1) return 'Middle Click';
    if (button === 2) return 'Right Click';
    if (button === 3) return 'Mouse 4';
    if (button === 4) return 'Mouse 5';
    return Number.isFinite(button) ? ('Mouse ' + button) : '';
  }

  function setHotkey(action, key) {
    var value = normalizeHotkey(key);
    var storage = STORAGE[action + 'Hotkey'];
    var input = byId('eon-bot-' + action + '-hotkey');
    if (!storage) return;
    localStorage.setItem(storage, value);
    if (input) input.value = value;
  }

  function setMouseBinding(action, button) {
    var value = button === '' ? '' : normalizeMouseButton(button);
    var storage = STORAGE[action + 'Mouse'];
    var input = byId('eon-bot-' + action + '-mouse');
    if (!storage) return;
    localStorage.setItem(storage, value);
    if (input) input.value = value;
  }

  function shouldIgnoreHotkey(event) {
    var target = event.target;
    if (!target) return false;
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
  }

  function shouldIgnoreMouseBinding(event) {
    var target = event.target;
    if (!target) return false;
    if (target.closest && target.closest('#eon-bot-client')) return true;
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
  }

  function runBotAction(action) {
    if (action === 'spawn') return spawnAll();
    if (action === 'split') return splitBots();
    if (action === 'mass') return toggleMassFeed();
  }

  function bindHotkeyInput(action) {
    var input = byId('eon-bot-' + action + '-hotkey');
    if (!input) return;
    input.addEventListener('keydown', function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') return setHotkey(action, '');
      setHotkey(action, event.key);
    });
  }

  function bindMouseInput(action) {
    var input = byId('eon-bot-' + action + '-mouse');
    if (!input) return;
    input.addEventListener('mousedown', function(event) {
      event.preventDefault();
      event.stopPropagation();
      setMouseBinding(action, event.button);
    });
    input.addEventListener('contextmenu', function(event) {
      event.preventDefault();
    });
    input.addEventListener('keydown', function(event) {
      if (event.key !== 'Escape' && event.key !== 'Backspace' && event.key !== 'Delete') return;
      event.preventDefault();
      event.stopPropagation();
      setMouseBinding(action, '');
    });
  }

  function mouseBindingInUse(label) {
    for (var i = 0; i < BINDABLE_ACTIONS.length; i++) {
      if (localStorage.getItem(STORAGE[BINDABLE_ACTIONS[i] + 'Mouse']) === label) return true;
    }
    return false;
  }

  function bindGlobalInputs() {
    document.addEventListener('keydown', function(event) {
      if (shouldIgnoreHotkey(event)) return;
      var key = normalizeHotkey(event.key);
      for (var i = 0; i < BINDABLE_ACTIONS.length; i++) {
        var action = BINDABLE_ACTIONS[i];
        if (key && localStorage.getItem(STORAGE[action + 'Hotkey']) === key) {
          event.preventDefault();
          runBotAction(action);
          return;
        }
      }
    });

    document.addEventListener('mousedown', function(event) {
      if (shouldIgnoreMouseBinding(event)) return;
      var button = normalizeMouseButton(event.button);
      for (var i = 0; i < BINDABLE_ACTIONS.length; i++) {
        var action = BINDABLE_ACTIONS[i];
        if (button && localStorage.getItem(STORAGE[action + 'Mouse']) === button) {
          event.preventDefault();
          event.stopPropagation();
          runBotAction(action);
          return;
        }
      }
    }, true);

    document.addEventListener('contextmenu', function(event) {
      if (!shouldIgnoreMouseBinding(event) && mouseBindingInUse('Right Click')) event.preventDefault();
    }, true);
  }

  function bindUi(root) {
    byId('eon-bot-collapse').addEventListener('click', function() {
      root.classList.toggle('is-collapsed');
      localStorage.setItem(STORAGE.collapsed, root.classList.contains('is-collapsed') ? '1' : '0');
    });
    byId('eon-bot-tab-control-btn').addEventListener('click', function() { setActiveTab('control'); });
    byId('eon-bot-tab-active-btn').addEventListener('click', function() { setActiveTab('active'); });
    byId('eon-bot-tab-share-btn').addEventListener('click', function() { setActiveTab('share'); });
    byId('eon-bot-tab-console-btn').addEventListener('click', function() { setActiveTab('console'); });

    byId('eon-bot-connect').addEventListener('click', connectBots);
    byId('eon-bot-spawn').addEventListener('click', spawnAll);
    byId('eon-bot-feed').addEventListener('click', feedTarget);
    byId('eon-bot-split').addEventListener('click', splitBots);
    byId('eon-bot-mass').addEventListener('click', toggleMassFeed);
    byId('eon-bot-pause').addEventListener('click', function() { setPaused(!paused); });
    byId('eon-bot-stop').addEventListener('click', stopAll);
    byId('eon-bot-opacity').addEventListener('input', function(event) {
      setUiOpacity(event.target.value);
    });
    byId('eon-bot-console-clear').addEventListener('click', function() {
      botConsoleEntries.length = 0;
      renderBotConsole();
      botConsoleLog('info', 'Console cleared');
    });
    byId('eon-bot-share-clear').addEventListener('click', function() {
      clearShareAssignments();
    });
    BINDABLE_ACTIONS.forEach(function(action) {
      bindHotkeyInput(action);
      bindMouseInput(action);
    });

    ['eon-bot-target', 'eon-bot-follow', 'eon-bot-auto-spawn', 'eon-bot-auto-respawn', 'eon-bot-auto-split', 'eon-bot-self-feed', 'eon-bot-virus-dodge', 'eon-bot-ip-pass', 'eon-bot-cell-locator', 'eon-bot-prefix', 'eon-bot-spawn-count'].forEach(function(id) {
      byId(id).addEventListener('change', syncOptions);
    });

    bindGlobalInputs();
    bindActiveBotsList();
    bindShareList();
  }

  function createUi() {
    if (byId('eon-bot-client')) return;

    var target = localStorage.getItem(STORAGE.target) || 'mouse';
    var follow = localStorage.getItem(STORAGE.follow) !== '0';
    var autoSpawn = localStorage.getItem(STORAGE.autoSpawn) !== '0';
    var autoRespawn = localStorage.getItem(STORAGE.autoRespawn) === '1';
    var autoSplit = localStorage.getItem(STORAGE.autoSplit) === '1';
    var selfFeed = localStorage.getItem(STORAGE.selfFeed) === '1';
    var virusDodge = localStorage.getItem(STORAGE.virusDodge) === '1';
    var ipPass = localStorage.getItem(STORAGE.ipPass) === '1';
    var spawnHotkey = localStorage.getItem(STORAGE.spawnHotkey) || '';
    var spawnMouse = localStorage.getItem(STORAGE.spawnMouse) || '';
    var splitHotkey = localStorage.getItem(STORAGE.splitHotkey) || '';
    var splitMouse = localStorage.getItem(STORAGE.splitMouse) || '';
    var massHotkey = localStorage.getItem(STORAGE.massHotkey) || '';
    var massMouse = localStorage.getItem(STORAGE.massMouse) || '';
    var prefix = safeText(localStorage.getItem(STORAGE.prefix) || 'Bot');
    var spawnCount = safeText(localStorage.getItem(STORAGE.count) || '5');
    var captchaSitekey = safeText(localStorage.getItem(STORAGE.captchaSitekey) || '');
    var captchaAction = safeText(localStorage.getItem(STORAGE.captchaAction) || '');
    var captchaCData = safeText(localStorage.getItem(STORAGE.captchaCData) || '');
    var uiOpacity = storedUiOpacity();
    var activeTab = localStorage.getItem(STORAGE.activeTab) || 'control';
    var collapsed = localStorage.getItem(STORAGE.collapsed) === '1';

    var root = document.createElement('div');
    root.id = 'eon-bot-client';
    if (collapsed) root.classList.add('is-collapsed');
    root.innerHTML =
      '<div class="eon-bot-shell">' +
        '<div class="eon-bot-header">' +
          '<div class="eon-bot-title"><span class="eon-bot-status" id="eon-bot-status"></span><i class="fa-solid fa-robot"></i><span>Game Bots</span></div>' +
          '<div class="eon-bot-meta"><span id="eon-bot-count">Waiting</span><button class="eon-bot-icon-btn" id="eon-bot-collapse" title="Collapse"><i class="fa-solid fa-chevron-down"></i></button></div>' +
        '</div>' +
        '<div class="eon-bot-body">' +
          '<div class="eon-bot-tabs">' +
            '<button class="eon-bot-tab" id="eon-bot-tab-control-btn" type="button">Controls</button>' +
            '<button class="eon-bot-tab" id="eon-bot-tab-active-btn" type="button">Active Bots</button>' +
            '<button class="eon-bot-tab" id="eon-bot-tab-share-btn" type="button">Share</button>' +
            '<button class="eon-bot-tab" id="eon-bot-tab-console-btn" type="button">Console</button>' +
          '</div>' +
          '<div class="eon-bot-tab-panel" id="eon-bot-tab-control">' +
          '<div class="eon-bot-row">' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Name</span><input class="eon-bot-input" id="eon-bot-prefix" maxlength="18" value="' + prefix + '"></div>' +
            '<div class="eon-bot-field short"><span class="eon-bot-label">Count</span><input class="eon-bot-input" id="eon-bot-spawn-count" type="number" min="1" max="50" value="' + spawnCount + '"></div>' +
          '</div>' +
          '<div class="eon-bot-row">' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Target</span><select class="eon-bot-select" id="eon-bot-target"><option value="mouse">Mouse</option><option value="current">Current</option><option value="parent">Parent</option><option value="child">Child</option></select></div>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-follow" type="checkbox"' + (follow ? ' checked' : '') + '>Follow</label>' +
          '</div>' +
          '<div class="eon-bot-slider-row">' +
            '<span class="eon-bot-label">Panel opacity</span>' +
            '<input class="eon-bot-range" id="eon-bot-opacity" type="range" min="35" max="100" step="5" value="' + uiOpacity + '">' +
            '<strong id="eon-bot-opacity-value">' + uiOpacity + '%</strong>' +
          '</div>' +
          '<div class="eon-bot-bind-grid">' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Spawn key</span><input class="eon-bot-input" id="eon-bot-spawn-hotkey" readonly placeholder="Press key" value="' + safeText(spawnHotkey) + '"></div>' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Spawn mouse</span><input class="eon-bot-input" id="eon-bot-spawn-mouse" readonly placeholder="Click button" value="' + safeText(spawnMouse) + '"></div>' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Split key</span><input class="eon-bot-input" id="eon-bot-split-hotkey" readonly placeholder="Press key" value="' + safeText(splitHotkey) + '"></div>' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Split mouse</span><input class="eon-bot-input" id="eon-bot-split-mouse" readonly placeholder="Click button" value="' + safeText(splitMouse) + '"></div>' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Mass key</span><input class="eon-bot-input" id="eon-bot-mass-hotkey" readonly placeholder="Press key" value="' + safeText(massHotkey) + '"></div>' +
            '<div class="eon-bot-field"><span class="eon-bot-label">Mass mouse</span><input class="eon-bot-input" id="eon-bot-mass-mouse" readonly placeholder="Click button" value="' + safeText(massMouse) + '"></div>' +
          '</div>' +
          '<div class="eon-bot-actions">' +
            '<button class="eon-bot-btn primary" id="eon-bot-connect"><i class="fa-solid fa-plug"></i><span>Connect</span></button>' +
            '<button class="eon-bot-btn neutral" id="eon-bot-spawn"><i class="fa-solid fa-play"></i><span>Spawn</span></button>' +
            '<button class="eon-bot-btn feed" id="eon-bot-feed" title="Feed target"><i class="fa-solid fa-location-crosshairs"></i></button>' +
            '<button class="eon-bot-btn neutral" id="eon-bot-split" title="Split"><i class="fa-solid fa-scissors"></i></button>' +
            '<button class="eon-bot-btn neutral" id="eon-bot-mass" title="Start mass feed"><i class="fa-solid fa-droplet"></i></button>' +
          '</div>' +
          '<div class="eon-bot-row options">' +
            '<label class="eon-bot-toggle"><input id="eon-bot-auto-spawn" type="checkbox"' + (autoSpawn ? ' checked' : '') + '>Auto spawn</label>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-auto-respawn" type="checkbox"' + (autoRespawn ? ' checked' : '') + '>Respawn</label>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-auto-split" type="checkbox"' + (autoSplit ? ' checked' : '') + '>Auto split</label>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-self-feed" type="checkbox"' + (selfFeed ? ' checked' : '') + '>Self feed</label>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-virus-dodge" type="checkbox"' + (virusDodge ? ' checked' : '') + '>Virus dodge</label>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-ip-pass" type="checkbox"' + (ipPass ? ' checked' : '') + '>ip pass</label>' +
            '<label class="eon-bot-toggle"><input id="eon-bot-cell-locator" type="checkbox" checked>Cell locator</label>' +
          '</div>' +
          '<div class="eon-bot-row">' +
            '<button class="eon-bot-btn neutral" id="eon-bot-pause"><i class="fa-solid fa-pause"></i><span>Pause</span></button>' +
            '<button class="eon-bot-btn danger" id="eon-bot-stop"><i class="fa-solid fa-stop"></i><span>Stop All</span></button>' +
          '</div>' +
          '<div class="eon-bot-readout"><span id="eon-bot-message">Ready</span><strong id="eon-bot-target-pos">No target</strong></div>' +
          '<div class="eon-bot-server" id="eon-bot-server">No server</div>' +
          '</div>' +
          '<div class="eon-bot-tab-panel" id="eon-bot-tab-active">' +
            '<div class="eon-bot-readout"><span>Active bots</span><strong id="eon-bot-active-summary">0 total</strong></div>' +
            '<div class="eon-active-list" id="eon-bot-active-list"><div class="eon-bot-empty">No bots connected</div></div>' +
          '</div>' +
          '<div class="eon-bot-tab-panel" id="eon-bot-tab-share">' +
            '<div class="eon-bot-readout"><span>Share</span><strong id="eon-bot-share-summary">0 ready</strong></div>' +
            '<div class="eon-share-toolbar">' +
              '<button class="eon-bot-mini-btn" id="eon-bot-share-clear" type="button">Clear</button>' +
            '</div>' +
            '<div class="eon-share-list" id="eon-bot-share-list"><div class="eon-bot-empty">No arena players</div></div>' +
          '</div>' +
          '<div class="eon-bot-tab-panel" id="eon-bot-tab-console">' +
            '<div class="eon-bot-readout"><span>Bot console</span><button class="eon-bot-mini-btn" id="eon-bot-console-clear" type="button">Clear</button></div>' +
            '<div class="eon-bot-console-log" id="eon-bot-console-log"><div class="eon-bot-console-empty">No bot events yet</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);
    byId('eon-bot-target').value = target;
    applyUiOpacity(uiOpacity);
    bindUi(root);
    botUiReady = true;
    setActiveTab(activeTab);
    syncOptions();
    setPaused(paused);
    updateMassButton();
  }

  function boot() {
    createUi();
    refresh();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 500);
  }

  ready(function() {
    boot();
    var tries = 0;
    var timer = setInterval(function() {
      tries++;
      if (botHandler()) {
        if (!botUiReady) boot();
        syncOptions();
        refresh();
        clearInterval(timer);
      }
      if (tries > 80) clearInterval(timer);
    }, 250);
  });
})();
