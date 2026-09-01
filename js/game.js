(function () {
  'use strict';

  const WIDTH = 960;
  const HEIGHT = 540;
  const GRAVITY_START = 0.07;
  const GRAVITY_MAX = 0.28;
  const FLAP_HEIGHT = 40;
  const SCROLL_START = 0.85;
  const SCROLL_MAX = 3.6;
  const GAP_START = 320;
  const GAP_MIN = 150;
  const WAVE_START = 0.12;
  const WAVE_MAX = 1;
  const DIFFICULTY_SCORE = 1800;
  const GAP_NARROW_SCORE = 5800;
  const CHANNEL_INTRO_START = 320;
  const CHANNEL_INTRO_END = 1200;
  const PLAYER_X = 200;
  const PLAYER_SIZE = 36;
  const HITBOX_PAD = 6;
  const CHANNEL_STEP = 8;
  const LABEL_SPACING = 300;
  const BOMB_SIZE = 46;
  const BOMB_FIRST = 700;
  const BOMB_SPACING = 560;
  const FARM_DECOR_SPACING = 340;
  const HORIZON_Y = 402;
  const SLAP_IMPACT_AT = 16;
  const SLAP_TEXT_AT = 44;
  const BEST_KEY = 'pklap-best-score';
  const LEADERBOARD_SIZE = 10;
  const LEADERBOARD_API =
    'https://crudcrud.com/api/4fe0dcc1fe994c67b40c6d568278c3f9/leaderboard';
  const LEADERBOARD_DOC_ID = '6a970433188cb503e8368310';

  const COMMODITIES = [
    { id: 'corn', name: 'Corn', color: '#f4d03f' },
    { id: 'soybean', name: 'Soybean', color: '#7cb342' },
    { id: 'sunflower', name: 'Sunflower', color: '#f9a825' },
    { id: 'wheat', name: 'Wheat', color: '#d4a017' },
  ];

  const STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover' };

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  let state = STATE.MENU;
  let selectedCommodity = 0;
  let paused = false;
  let lastTime = 0;
  let scrollX = 0;
  let scrollSpeed = SCROLL_START;
  let score = 0;
  let bestScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  let channelGap = GAP_START;
  let waveScale = WAVE_START;
  let currentGravity = GRAVITY_START;
  let hasFlapped = false;
  let slapTime = 0;
  let shakeMag = 0;
  let channelPoints = [];
  let leaderboard = [];
  let leaderboardOk = false;
  let nameEntry = false;
  let askedForInitials = false;
  let saveStatus = '';

  const player = {
    y: HEIGHT / 2,
    vy: 0,
    rotation: 0,
    knockX: 0,
    hoverOffset: 0,
    hoverDir: 1,
  };

  const clouds = [];

  function initBackground() {
    clouds.length = 0;
    for (let i = 0; i < 7; i++) {
      clouds.push({
        x: Math.random() * WIDTH * 1.5,
        y: 18 + Math.random() * 110,
        w: 60 + Math.random() * 80,
        speed: 0.3 + Math.random() * 0.4,
      });
    }
  }

  function hashInt(n) {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return (n ^ (n >>> 16)) >>> 0;
  }

  function ease01(x, a, b) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function channelCenterAt(worldX) {
    const t = worldX * 0.004;
    const intro = ease01(worldX, CHANNEL_INTRO_START, CHANNEL_INTRO_END);
    const amp = intro * waveScale;
    const base = HEIGHT * 0.5;
    const wave =
      Math.sin(t * 1.3) * 55 +
      Math.sin(t * 2.7 + 1.2) * 28 +
      Math.sin(t * 0.6 + 2.5) * 18;
    return base + wave * amp;
  }

  function rebuildChannel() {
    channelPoints = [];
    const startX = Math.floor(scrollX / CHANNEL_STEP) * CHANNEL_STEP - CHANNEL_STEP * 4;
    const endX = scrollX + WIDTH + CHANNEL_STEP * 8;
    for (let wx = startX; wx <= endX; wx += CHANNEL_STEP) {
      const center = channelCenterAt(wx);
      const halfGap = channelGap / 2;
      channelPoints.push({
        worldX: wx,
        importY: center - halfGap,
        exportY: center + halfGap,
      });
    }
  }

  function sampleChannel(screenX) {
    const worldX = scrollX + screenX;
    if (channelPoints.length < 2) return { importY: 0, exportY: HEIGHT };

    let lo = 0;
    let hi = channelPoints.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (channelPoints[mid].worldX <= worldX) lo = mid;
      else hi = mid;
    }

    const a = channelPoints[lo];
    const b = channelPoints[Math.min(lo + 1, channelPoints.length - 1)];
    const span = b.worldX - a.worldX || 1;
    const t = (worldX - a.worldX) / span;
    return {
      importY: a.importY + (b.importY - a.importY) * t,
      exportY: a.exportY + (b.exportY - a.exportY) * t,
    };
  }

  function eachBomb(callback) {
    const minI = Math.max(0, Math.floor((scrollX - BOMB_SIZE - BOMB_FIRST) / BOMB_SPACING));
    const maxI = Math.floor((scrollX + WIDTH + BOMB_SIZE - BOMB_FIRST) / BOMB_SPACING);
    if (maxI < 0) return;

    for (let i = minI; i <= maxI; i++) {
      const worldX = BOMB_FIRST + i * BOMB_SPACING;
      const center = channelCenterAt(worldX);
      const half = channelGap / 2;
      const bombR = BOMB_SIZE / 2;
      const maxOff = Math.max(22, half - bombR - 16);
      const side = i % 2 === 0 ? -1 : 1;
      const tightness = 0.58 + (hashInt(i + 9) % 22) / 100;
      callback(worldX, center + side * maxOff * tightness, i);
    }
  }

  function resetGame() {
    scrollX = 0;
    scrollSpeed = SCROLL_START;
    score = 0;
    channelGap = GAP_START;
    waveScale = WAVE_START;
    currentGravity = GRAVITY_START;
    hasFlapped = false;
    slapTime = 0;
    shakeMag = 0;
    player.y = HEIGHT / 2;
    player.vy = 0;
    player.rotation = 0;
    player.knockX = 0;
    nameEntry = false;
    askedForInitials = false;
    saveStatus = '';
    hideInitialsOverlay();
    rebuildChannel();
  }

  function normalizeInitials(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
  }

  function sanitizeLeaderboard(raw) {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw && raw.scores) ? raw.scores : [];
    return list
      .map(function (row) {
        return {
          initials: normalizeInitials(row && row.initials),
          score: Math.floor(Number(row && row.score) || 0),
        };
      })
      .filter(function (row) {
        return row.initials.length === 2 && row.score >= 0 && row.score < 10000000;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, LEADERBOARD_SIZE);
  }

  function qualifiesForLeaderboard(value) {
    if (!leaderboardOk) return false;
    if (leaderboard.length < LEADERBOARD_SIZE) return value > 0;
    return value > leaderboard[leaderboard.length - 1].score;
  }

  function fetchLeaderboard(signal) {
    return fetch(LEADERBOARD_API, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: signal,
    }).then(function (res) {
      if (!res.ok) throw new Error('leaderboard http ' + res.status);
      return res.json();
    }).then(function (data) {
      if (Array.isArray(data)) {
        const doc =
          data.filter(function (row) {
            return row && row._id === LEADERBOARD_DOC_ID;
          })[0] || data[0];
        return sanitizeLeaderboard(doc || { scores: [] });
      }
      return sanitizeLeaderboard(data);
    });
  }

  function loadLeaderboard() {
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 4000);

    const req = fetchLeaderboard(ctrl && ctrl.signal);
    return req
      .then(function (rows) {
        leaderboard = rows;
        leaderboardOk = true;
      })
      .catch(function () {
        leaderboardOk = false;
        leaderboard = [];
      })
      .then(function () {
        clearTimeout(timer);
      });
  }

  function saveScore(initials, value) {
    const entry = { initials: normalizeInitials(initials), score: Math.floor(value) };
    if (entry.initials.length !== 2) return Promise.resolve(false);

    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 4000);

    return fetchLeaderboard(ctrl && ctrl.signal)
      .then(function (latest) {
        const next = latest.slice();
        const tenth = next.length === LEADERBOARD_SIZE ? next[next.length - 1].score : -1;
        if (next.length >= LEADERBOARD_SIZE && entry.score <= tenth) {
          leaderboard = next;
          leaderboardOk = true;
          return false;
        }
        next.push(entry);
        const trimmed = sanitizeLeaderboard(next);
        return fetch(LEADERBOARD_API + '/' + LEADERBOARD_DOC_ID, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ scores: trimmed }),
          signal: ctrl && ctrl.signal,
        }).then(function (res) {
          if (!res.ok) throw new Error('save http ' + res.status);
          leaderboard = trimmed;
          leaderboardOk = true;
          return true;
        });
      })
      .catch(function () {
        return false;
      })
      .then(function (ok) {
        clearTimeout(timer);
        return ok;
      });
  }

  function showInitialsOverlay() {
    const overlay = document.getElementById('initials-overlay');
    const input = document.getElementById('initials-input');
    if (!overlay || !input) return;
    overlay.hidden = false;
    input.value = '';
    setTimeout(function () {
      input.focus();
      input.select();
    }, 30);
  }

  function hideInitialsOverlay() {
    const overlay = document.getElementById('initials-overlay');
    const input = document.getElementById('initials-input');
    if (overlay) overlay.hidden = true;
    if (input) input.blur();
    canvas.focus();
  }

  function finishNameEntry() {
    nameEntry = false;
    hideInitialsOverlay();
  }

  function submitInitials(raw) {
    const initials = normalizeInitials(raw);
    if (initials.length !== 2 || saveStatus === 'saving') return;
    saveStatus = 'saving';
    saveScore(initials, Math.floor(score)).then(function (ok) {
      saveStatus = ok ? 'saved' : 'failed';
      finishNameEntry();
    });
  }

  function startPlaying() {
    state = STATE.PLAYING;
    resetGame();
  }

  function flapForce() {
    return -Math.sqrt(2 * currentGravity * FLAP_HEIGHT);
  }

  function flap() {
    if (state === STATE.MENU) {
      startPlaying();
      return;
    }
    if (state === STATE.PLAYING) {
      hasFlapped = true;
      player.vy = flapForce();
    }
    if (state === STATE.GAMEOVER) {
      if (nameEntry || slapTime < SLAP_TEXT_AT) return;
      state = STATE.PLAYING;
      resetGame();
    }
  }

  function die() {
    if (state !== STATE.PLAYING) return;
    state = STATE.GAMEOVER;
    slapTime = 0;
    shakeMag = 0;
    if (Math.floor(score) > bestScore) {
      bestScore = Math.floor(score);
      localStorage.setItem(BEST_KEY, String(bestScore));
    }
  }

  function checkCollision() {
    const top = player.y - PLAYER_SIZE / 2 + HITBOX_PAD;
    const bottom = player.y + PLAYER_SIZE / 2 - HITBOX_PAD;
    const left = PLAYER_X - PLAYER_SIZE / 2 + HITBOX_PAD;
    const right = PLAYER_X + PLAYER_SIZE / 2 - HITBOX_PAD;

    if (top <= 0 || bottom >= HEIGHT) {
      die();
      return;
    }

    const samples = [left, PLAYER_X, right];
    for (const sx of samples) {
      const ch = sampleChannel(sx);
      if (top < ch.importY || bottom > ch.exportY) {
        die();
        return;
      }
    }

    const px = PLAYER_X;
    const py = player.y;
    const pr = PLAYER_SIZE / 2 - HITBOX_PAD;
    const br = BOMB_SIZE / 2 - 7;
    let hitBomb = false;
    eachBomb(function (worldX, bombY) {
      if (hitBomb) return;
      const dx = worldX - scrollX - px;
      const dy = bombY - py;
      if (dx * dx + dy * dy < (pr + br) * (pr + br)) {
        hitBomb = true;
      }
    });
    if (hitBomb) die();
  }

  function update(dt) {
    if (paused || state === STATE.MENU) {
      player.hoverOffset += player.hoverDir * dt * 0.08;
      if (player.hoverOffset > 8) player.hoverDir = -1;
      if (player.hoverOffset < -8) player.hoverDir = 1;
      return;
    }

    if (state === STATE.PLAYING) {
      const t = Math.min(score / DIFFICULTY_SCORE, 1);
      const gapT = Math.min(score / GAP_NARROW_SCORE, 1);
      currentGravity = GRAVITY_START + t * (GRAVITY_MAX - GRAVITY_START);
      scrollSpeed = SCROLL_START + t * (SCROLL_MAX - SCROLL_START);
      channelGap = GAP_START - gapT * (GAP_START - GAP_MIN);
      waveScale = WAVE_START + t * (WAVE_MAX - WAVE_START);

      if (!hasFlapped) {
        player.vy = 0;
        player.rotation = 0;
      } else {
        player.vy += currentGravity * dt;
        player.y += player.vy * dt;
        player.rotation = Math.max(-0.5, Math.min(1.2, player.vy * 0.08));
      }

      scrollX += scrollSpeed * dt;
      score += scrollSpeed * dt * 0.5;

      rebuildChannel();
      checkCollision();

      clouds.forEach((c) => {
        c.x -= c.speed * scrollSpeed * dt * 0.3;
        if (c.x + c.w < -50) c.x = WIDTH + 50;
      });
    }

    if (state === STATE.GAMEOVER) {
      slapTime += dt;
      if (slapTime >= SLAP_IMPACT_AT && slapTime < SLAP_IMPACT_AT + 10) {
        shakeMag = 26 * (1 - (slapTime - SLAP_IMPACT_AT) / 10);
        player.knockX += 14 * dt;
        player.rotation = Math.min(player.rotation + 0.28 * dt, 2.6);
      } else if (slapTime >= SLAP_IMPACT_AT) {
        shakeMag *= 0.82;
        player.knockX += 3 * dt;
      }
      if (slapTime >= SLAP_TEXT_AT && !askedForInitials) {
        askedForInitials = true;
        if (qualifiesForLeaderboard(Math.floor(score))) {
          nameEntry = true;
          saveStatus = '';
          showInitialsOverlay();
        }
      }
    }
  }

  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    grad.addColorStop(0, '#5aaed8');
    grad.addColorStop(0.4, '#8ecdeb');
    grad.addColorStop(0.78, '#c5e3c0');
    grad.addColorStop(1, '#d7e6b8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HORIZON_Y);
  }

  function drawClouds(parallax) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    clouds.forEach((c) => {
      const x = ((c.x - scrollX * parallax) % (WIDTH + 200)) - 50;
      drawPixelCloud(x, c.y, c.w);
    });
  }

  function drawPixelCloud(x, y, w) {
    const h = w * 0.35;
    ctx.fillRect(x, y + h * 0.4, w, h * 0.5);
    ctx.fillRect(x + w * 0.15, y, w * 0.35, h * 0.7);
    ctx.fillRect(x + w * 0.45, y + h * 0.15, w * 0.4, h * 0.65);
  }

  function drawFarm(parallax) {
    drawHills(parallax * 0.18);
    drawHorizonSilos(parallax * 0.22);
    drawFields(parallax);
    drawFarmDecor(parallax);
  }

  function drawHills(parallax) {
    const base = HORIZON_Y + 6;
    ctx.beginPath();
    ctx.moveTo(-30, base + 20);
    ctx.lineTo(-30, base);
    for (let x = -30; x <= WIDTH + 40; x += 10) {
      const wx = x + scrollX * parallax;
      const y =
        base -
        16 -
        Math.sin(wx * 0.011) * 11 -
        Math.sin(wx * 0.006 + 1.4) * 8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WIDTH + 40, base + 20);
    ctx.closePath();
    ctx.fillStyle = '#7a9a58';
    ctx.fill();
    ctx.fillStyle = '#8aab68';
    ctx.beginPath();
    ctx.moveTo(-30, base + 20);
    for (let x = -30; x <= WIDTH + 40; x += 12) {
      const wx = x + scrollX * parallax * 1.15 + 80;
      const y = base - 8 - Math.sin(wx * 0.015 + 2) * 6;
      if (x === -30) ctx.lineTo(-30, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(WIDTH + 40, base + 20);
    ctx.closePath();
    ctx.fill();
  }

  function drawHorizonSilos(parallax) {
    const spacing = 260;
    const viewStart = scrollX * parallax - 50;
    const first = Math.floor(viewStart / spacing);
    const last = Math.ceil((scrollX * parallax + WIDTH + 50) / spacing);

    for (let i = first; i <= last; i++) {
      if (i < 0) continue;
      const h = hashInt(i * 19 + 3);
      if (h % 5 === 0) continue;
      const jitter = (h % 90) - 20;
      const sx = i * spacing + jitter - scrollX * parallax;
      const count = 1 + (h % 3);
      const scale = 0.28 + (h % 7) * 0.02;
      for (let s = 0; s < count; s++) {
        drawSilo(sx + s * Math.round(16 * scale * 2.2), HORIZON_Y + 3, scale, true);
      }
    }
  }

  function drawFields(parallax) {
    const groundTop = HORIZON_Y;
    const groundH = HEIGHT - groundTop;
    const colors = [
      '#6b9a3e',
      '#c5a032',
      '#4e7c32',
      '#d4b84a',
      '#5a8c38',
      '#a67c1a',
      '#3f6e2a',
      '#8f9a40',
    ];

    const soil = ctx.createLinearGradient(0, groundTop, 0, HEIGHT);
    soil.addColorStop(0, '#8eaa62');
    soil.addColorStop(0.4, '#5d8a3c');
    soil.addColorStop(1, '#3a5e24');
    ctx.fillStyle = soil;
    ctx.fillRect(0, groundTop, WIDTH, groundH);

    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const t0 = r / rows;
      const t1 = (r + 1) / rows;
      const y0 = Math.round(groundTop + groundH * Math.pow(t0, 1.28));
      const y1 = Math.round(groundTop + groundH * Math.pow(t1, 1.28));
      const h = Math.max(y1 - y0, 7);
      const baseW = 110 + r * 78;
      const speed = 0.22 + r * 0.14;
      const period = baseW + 14;
      let x = -((scrollX * parallax * speed) % period) - period;
      x += (r * 41) % 70;
      let col = 0;
      while (x < WIDTH + 80) {
        const hh = hashInt(r * 97 + col + 11);
        const w = baseW + (hh % 56) - 12;
        const inset = Math.max(3, (5 - r) * 4);
        ctx.fillStyle = colors[(hh + r) % colors.length];
        ctx.beginPath();
        ctx.moveTo(x + inset, y0);
        ctx.lineTo(x + w - inset, y0);
        ctx.lineTo(x + w + 6, y0 + h);
        ctx.lineTo(x - 6, y0 + h);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        const furrow = 4 + r;
        for (let fy = y0 + 3; fy < y0 + h - 2; fy += furrow) {
          ctx.fillRect(x + inset, fy, w - inset * 2, 1);
        }

        x += w + 5 + (hh % 8);
        col++;
      }
    }

    ctx.fillStyle = '#6b5428';
    ctx.fillRect(0, HEIGHT - 20, WIDTH, 6);
    ctx.fillStyle = '#2e5a22';
    ctx.fillRect(0, HEIGHT - 14, WIDTH, 14);
    ctx.fillStyle = '#3d7a30';
    const tuftOff = -((scrollX * parallax) % 18);
    for (let i = tuftOff; i < WIDTH; i += 18) {
      ctx.fillRect(i, HEIGHT - 18, 9, 5);
    }
  }

  function drawFarmDecor(parallax) {
    const groundY = HEIGHT - 14;
    const viewStart = scrollX * parallax - 90;
    const viewEnd = scrollX * parallax + WIDTH + 90;
    const first = Math.floor(viewStart / FARM_DECOR_SPACING);
    const last = Math.ceil(viewEnd / FARM_DECOR_SPACING);

    for (let i = first; i <= last; i++) {
      if (i < 0) continue;
      const h = hashInt(i * 13 + 7);
      const kind = h % 6;
      if (kind > 2) continue;
      const jitter = (h % 70) - 10;
      const sx = i * FARM_DECOR_SPACING + jitter - scrollX * parallax;
      if (kind === 0) drawSilo(sx, groundY, 0.82, false);
      else if (kind === 1) drawTractor(sx, groundY);
      else {
        drawSilo(sx, groundY, 0.7, false);
        drawSilo(sx + 28, groundY, 0.88, false);
      }
    }
  }

  function drawSilo(x, groundY, scale, distant) {
    scale = scale == null ? 1 : scale;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(groundY));
    ctx.scale(scale, scale);

    const body = distant ? '#c5cbb8' : '#cfd8dc';
    const shade = distant ? '#9aa392' : '#90a4ae';
    const band = distant ? '#7e8878' : '#78909c';
    const cap = distant ? '#d5d8cc' : '#eceff1';
    const door = distant ? '#6a7368' : '#546e7a';

    ctx.fillStyle = body;
    ctx.fillRect(0, -86, 30, 86);
    ctx.fillStyle = shade;
    ctx.fillRect(24, -86, 6, 86);
    ctx.fillStyle = band;
    ctx.fillRect(0, -64, 30, 4);
    ctx.fillRect(0, -38, 30, 4);
    ctx.fillStyle = cap;
    ctx.fillRect(2, -96, 26, 12);
    ctx.fillRect(8, -102, 14, 8);
    if (!distant) {
      ctx.fillStyle = door;
      ctx.fillRect(11, -18, 8, 18);
      ctx.fillStyle = '#37474f';
      ctx.fillRect(32, -70, 3, 50);
      for (let rung = 0; rung < 8; rung++) {
        ctx.fillRect(30, -68 + rung * 6, 7, 2);
      }
    }
    ctx.restore();
  }

  function drawTractor(x, groundY) {
    const gx = Math.round(x);
    const gy = Math.round(groundY);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(gx + 10, gy - 24, 30, 12);
    ctx.fillRect(gx + 24, gy - 36, 18, 14);
    ctx.fillStyle = '#81d4fa';
    ctx.fillRect(gx + 27, gy - 33, 12, 8);
    ctx.fillStyle = '#37474f';
    ctx.fillRect(gx + 14, gy - 32, 4, 8);
    ctx.fillStyle = '#212121';
    ctx.fillRect(gx + 4, gy - 18, 16, 18);
    ctx.fillRect(gx + 30, gy - 12, 12, 12);
    ctx.fillStyle = '#616161';
    ctx.fillRect(gx + 8, gy - 13, 8, 8);
    ctx.fillRect(gx + 33, gy - 8, 6, 6);
    ctx.fillStyle = '#fdd835';
    ctx.fillRect(gx + 40, gy - 20, 4, 4);
  }

  function drawChannel() {
    if (channelPoints.length < 2) return;

    ctx.beginPath();
    let started = false;
    for (const pt of channelPoints) {
      const sx = pt.worldX - scrollX;
      if (sx < -CHANNEL_STEP || sx > WIDTH + CHANNEL_STEP) continue;
      if (!started) {
        ctx.moveTo(sx, pt.importY);
        started = true;
      } else {
        ctx.lineTo(sx, pt.importY);
      }
    }
    for (let i = channelPoints.length - 1; i >= 0; i--) {
      const pt = channelPoints[i];
      const sx = pt.worldX - scrollX;
      if (sx < -CHANNEL_STEP || sx > WIDTH + CHANNEL_STEP) continue;
      ctx.lineTo(sx, pt.exportY);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 248, 220, 0.35)';
    ctx.fill();

    drawChannelLine('import');
    drawChannelLine('export');
    drawChannelLabels();
  }

  function drawChannelLine(kind) {
    const isImport = kind === 'import';
    ctx.strokeStyle = isImport ? '#c0392b' : '#27ae60';
    ctx.lineWidth = 4;
    ctx.beginPath();
    let started = false;
    for (const pt of channelPoints) {
      const sx = pt.worldX - scrollX;
      if (sx < -CHANNEL_STEP || sx > WIDTH + CHANNEL_STEP) continue;
      const y = isImport ? pt.importY : pt.exportY;
      if (!started) {
        ctx.moveTo(sx, y);
        started = true;
      } else {
        ctx.lineTo(sx, y);
      }
    }
    ctx.stroke();

    ctx.fillStyle = isImport ? '#e74c3c' : '#2ecc71';
    const tickOffset = isImport ? 0 : LABEL_SPACING / 2;
    const firstTick = Math.floor((scrollX + tickOffset) / LABEL_SPACING);
    const lastTick = Math.ceil((scrollX + WIDTH + tickOffset) / LABEL_SPACING);
    for (let i = firstTick; i <= lastTick; i++) {
      const worldX = i * LABEL_SPACING + tickOffset;
      const sx = worldX - scrollX;
      if (sx < 0 || sx > WIDTH) continue;
      const ch = sampleChannel(sx);
      const y = isImport ? ch.importY : ch.exportY;
      ctx.fillRect(sx - 2, y - 2, 4, 4);
    }
  }

  function drawChannelLabels() {
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const first = Math.floor(scrollX / LABEL_SPACING) - 1;
    const last = Math.ceil((scrollX + WIDTH) / LABEL_SPACING) + 1;

    for (let i = first; i <= last; i++) {
      const importWorldX = i * LABEL_SPACING + LABEL_SPACING * 0.2;
      const exportWorldX = i * LABEL_SPACING + LABEL_SPACING * 0.7;

      drawLabel('IMPORT', importWorldX, '#c0392b', -16, 'import');
      drawLabel('EXPORT', exportWorldX, '#1e8449', 26, 'export');
    }
  }

  function drawLabel(text, worldX, color, yOffset, kind) {
    const sx = worldX - scrollX;
    if (sx < 80 || sx > WIDTH - 80) return;

    const ch = sampleChannel(sx);
    const y = (kind === 'import' ? ch.importY : ch.exportY) + yOffset;
    if (y < 28 || y > HEIGHT - 16) return;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(text, sx + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, sx, y);
  }

  function drawBombs() {
    eachBomb(function (worldX, bombY) {
      drawBomb(worldX - scrollX, bombY);
    });
  }

  function drawBomb(x, y) {
    const s = BOMB_SIZE / 40;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));

    ctx.fillStyle = '#5d4037';
    ctx.fillRect(Math.round(1 * s), Math.round(-22 * s), Math.round(4 * s), Math.round(8 * s));

    const sparkOn = Math.floor(Date.now() / 120) % 2 === 0;
    ctx.fillStyle = sparkOn ? '#ff6f00' : '#ffeb3b';
    ctx.fillRect(Math.round(-2 * s), Math.round(-27 * s), Math.round(8 * s), Math.round(5 * s));
    ctx.fillStyle = sparkOn ? '#fff59d' : '#ff6f00';
    ctx.fillRect(Math.round(0), Math.round(-31 * s), Math.round(4 * s), Math.round(4 * s));

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(Math.round(-14 * s), Math.round(-12 * s), Math.round(28 * s), Math.round(24 * s));
    ctx.fillRect(Math.round(-18 * s), Math.round(-8 * s), Math.round(36 * s), Math.round(16 * s));
    ctx.fillRect(Math.round(-10 * s), Math.round(-16 * s), Math.round(20 * s), Math.round(32 * s));
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(Math.round(-12 * s), Math.round(-10 * s), Math.round(8 * s), Math.round(8 * s));

    ctx.fillStyle = '#ffeb3b';
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AMIM', 0, Math.round(2 * s));
    ctx.restore();
  }

  function drawCommoditySprite(type, x, y, size, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const s = size / 36;

    switch (type) {
      case 'corn':
        drawCorn(s);
        break;
      case 'soybean':
        drawSoybean(s);
        break;
      case 'sunflower':
        drawSunflower(s);
        break;
      case 'wheat':
        drawWheat(s);
        break;
      default:
        drawCorn(s);
    }

    ctx.restore();
  }

  function drawCorn(s) {
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(-6 * s, -14 * s, 12 * s, 24 * s);
    ctx.fillStyle = '#f39c12';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillRect((-4 + col * 8) * s, (-10 + row * 5) * s, 3 * s, 3 * s);
      }
    }
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(-2 * s, -18 * s, 4 * s, 6 * s);
    ctx.fillRect(4 * s, -16 * s, 8 * s, 3 * s);
  }

  function drawSoybean(s) {
    ctx.fillStyle = '#7cb342';
    ctx.beginPath();
    ctx.ellipse(0, 0, 10 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#558b2f';
    ctx.beginPath();
    ctx.ellipse(-3 * s, -2 * s, 4 * s, 6 * s, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4 * s, 2 * s, 4 * s, 6 * s, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8bc34a';
    ctx.fillRect(-2 * s, -16 * s, 4 * s, 6 * s);
  }

  function drawSunflower(s) {
    ctx.fillStyle = '#f9a825';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.fillRect(Math.cos(a) * 10 * s - 3 * s, Math.sin(a) * 10 * s - 3 * s, 6 * s, 6 * s);
    }
    ctx.fillStyle = '#5d4037';
    ctx.beginPath();
    ctx.arc(0, 0, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#33691e';
    ctx.fillRect(-2 * s, 12 * s, 4 * s, 10 * s);
  }

  function drawWheat(s) {
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(-2 * s, -4 * s, 4 * s, 20 * s);
    ctx.fillStyle = '#f1c40f';
    for (let i = 0; i < 5; i++) {
      const yy = (-12 + i * 5) * s;
      ctx.fillRect(-8 * s, yy, 6 * s, 3 * s);
      ctx.fillRect(2 * s, yy + 2 * s, 6 * s, 3 * s);
    }
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(-1 * s, 14 * s, 2 * s, 6 * s);
  }

  function drawPlayer() {
    const commodity = COMMODITIES[selectedCommodity];
    const y =
      state === STATE.MENU
        ? HEIGHT / 2 + player.hoverOffset
        : player.y;
    const x = PLAYER_X + (player.knockX || 0);
    drawCommoditySprite(
      commodity.id,
      x,
      y,
      PLAYER_SIZE,
      state === STATE.MENU ? Math.sin(Date.now() * 0.003) * 0.1 : player.rotation
    );
  }

  function drawHUD() {
    if (state === STATE.MENU || state === STATE.GAMEOVER) return;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(12, 12, 180, 36);
    ctx.fillStyle = '#fff';
    ctx.font = '14px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Score: ' + Math.floor(score), 24, 36);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(WIDTH - 140, 12, 128, 28);
    ctx.fillStyle = '#ffe082';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillText('Best: ' + bestScore, WIDTH - 24, 30);
  }

  function drawMenu() {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f1c40f';
    ctx.font = '36px "Press Start 2P", monospace';
    ctx.fillText('P-Klap', WIDTH / 2, 70);

    ctx.fillStyle = '#ecf0f1';
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.fillText('Choose your commodity', WIDTH / 2, 110);

    const btnW = 180;
    const btnH = 52;
    const startX = (WIDTH - (btnW * 2 + 24)) / 2;
    const startY = 140;

    COMMODITIES.forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const bx = startX + col * (btnW + 24);
      const by = startY + row * (btnH + 16);
      const selected = i === selectedCommodity;

      ctx.fillStyle = selected ? '#27ae60' : '#34495e';
      ctx.fillRect(bx, by, btnW, btnH);
      ctx.strokeStyle = selected ? '#f1c40f' : '#7f8c8d';
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, btnW, btnH);

      drawCommoditySprite(c.id, bx + 36, by + btnH / 2, 28, 0);
      ctx.fillStyle = '#fff';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(c.name, bx + 64, by + btnH / 2 + 4);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#bdc3c7';
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillText('Space / Click / Tap to fly', WIDTH / 2, HEIGHT - 60);
    ctx.fillStyle = '#95a5a6';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillText('Stay between IMPORT and EXPORT', WIDTH / 2, HEIGHT - 36);
    ctx.fillText('Dodge the AMIM bombs', WIDTH / 2, HEIGHT - 18);

    drawLeaderboard(WIDTH / 2, 286);
  }

  function drawLeaderboard(centerX, topY) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f1c40f';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillText('TOP 10', centerX, topY);

    if (!leaderboardOk) {
      ctx.fillStyle = '#7f8c8d';
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText('scores unavailable', centerX, topY + 22);
      return;
    }

    if (!leaderboard.length) {
      ctx.fillStyle = '#95a5a6';
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText('no scores yet', centerX, topY + 22);
      return;
    }

    ctx.font = '8px "Press Start 2P", monospace';
    const colW = 210;
    for (let i = 0; i < leaderboard.length; i++) {
      const col = i < 5 ? 0 : 1;
      const row = i < 5 ? i : i - 5;
      const x = centerX + (col === 0 ? -colW / 2 : colW / 2);
      const y = topY + 20 + row * 16;
      const rank = String(i + 1).padStart(2, ' ');
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 0 ? '#f1c40f' : '#ecf0f1';
      ctx.fillText(rank + ' ' + leaderboard[i].initials, x - 88, y);
      ctx.textAlign = 'right';
      ctx.fillText(String(leaderboard[i].score), x + 88, y);
    }
  }

  function drawSlapHand() {
    const impactT = Math.min(slapTime / SLAP_IMPACT_AT, 1);
    const whip = impactT * impactT * impactT;
    const recoil = slapTime > SLAP_IMPACT_AT
      ? Math.min((slapTime - SLAP_IMPACT_AT) / 14, 1)
      : 0;
    const targetY = player.y || HEIGHT / 2;
    const x = WIDTH + 340 - whip * (WIDTH + 340 - (PLAYER_X + 120)) + recoil * 55;
    const y = targetY - 8 - (1 - whip) * 100;
    const rot = -1.2 + whip * 1.65 + recoil * 0.22;
    const scale = 2.35 + whip * 0.45;

    if (whip > 0.15 && slapTime < SLAP_IMPACT_AT + 6) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + whip * 0.4) + ')';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(PLAYER_X + 40, targetY, 70 + whip * 40, -0.8, 0.6);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);

    const skin = '#f1c27d';
    const skinDark = '#d4a574';
    const skinLight = '#f8d7b0';

    ctx.fillStyle = '#8e1b1b';
    ctx.fillRect(52, -30, 40, 62);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(48, -26, 36, 54);

    ctx.fillStyle = skinDark;
    ctx.fillRect(28, -22, 28, 46);

    ctx.fillStyle = skin;
    ctx.fillRect(-38, -42, 76, 88);
    ctx.fillStyle = skinLight;
    ctx.fillRect(-30, -34, 26, 22);
    ctx.fillStyle = skinDark;
    ctx.fillRect(-38, 34, 76, 12);

    const fingers = [
      { x: -98, y: -40, w: 64, h: 20 },
      { x: -108, y: -14, w: 74, h: 22 },
      { x: -102, y: 14, w: 68, h: 20 },
      { x: -82, y: 38, w: 52, h: 18 },
    ];
    fingers.forEach(function (f, i) {
      ctx.fillStyle = i % 2 ? skin : skinLight;
      ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = skinDark;
      ctx.fillRect(f.x, f.y + f.h - 4, f.w, 4);
    });

    ctx.fillStyle = skin;
    ctx.fillRect(-16, -82, 30, 46);
    ctx.fillRect(-34, -82, 24, 24);
    ctx.fillStyle = skinDark;
    ctx.fillRect(-34, -82, 24, 6);

    ctx.restore();

    if (slapTime >= SLAP_IMPACT_AT && slapTime < SLAP_IMPACT_AT + 12) {
      const burst = 1 - (slapTime - SLAP_IMPACT_AT) / 12;
      ctx.save();
      ctx.translate(PLAYER_X + 30 + player.knockX, targetY);
      ctx.fillStyle = 'rgba(255, 236, 179,' + (0.9 * burst) + ')';
      ctx.font = '22px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SLAP!', 20, -40 * burst);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.8 * burst) + ')';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillRect(Math.cos(a) * 50 * (1.2 - burst) - 4, Math.sin(a) * 36 * (1.2 - burst) - 4, 8, 8);
      }
      ctx.restore();
    }
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f1c40f';
    ctx.font = '24px "Press Start 2P", monospace';
    ctx.fillText('You got a P-Klap!', WIDTH / 2, HEIGHT / 2 - 110);

    ctx.fillStyle = '#ffffff';
    ctx.font = '32px "Press Start 2P", monospace';
    ctx.fillText(String(Math.floor(score)), WIDTH / 2, HEIGHT / 2 - 58);

    ctx.fillStyle = '#ffe082';
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.fillText('Best: ' + Math.floor(bestScore), WIDTH / 2, HEIGHT / 2 - 24);

    if (nameEntry) {
      ctx.fillStyle = '#2ecc71';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText('New top 10 score!', WIDTH / 2, HEIGHT / 2 + 8);
    } else {
      if (saveStatus === 'saved') {
        ctx.fillStyle = '#2ecc71';
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.fillText('Leaderboard updated', WIDTH / 2, HEIGHT / 2 + 6);
      } else if (saveStatus === 'failed') {
        ctx.fillStyle = '#e74c3c';
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.fillText('Could not save score', WIDTH / 2, HEIGHT / 2 + 6);
      } else if (saveStatus === 'saving') {
        ctx.fillStyle = '#bdc3c7';
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.fillText('Saving...', WIDTH / 2, HEIGHT / 2 + 6);
      }

      drawLeaderboard(WIDTH / 2, HEIGHT / 2 + 28);

      ctx.fillStyle = '#bdc3c7';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText('Space / Tap to retry', WIDTH / 2, HEIGHT - 48);
      ctx.fillStyle = '#95a5a6';
      ctx.fillText('Press C to change commodity', WIDTH / 2, HEIGHT - 24);
    }
  }

  function render() {
    ctx.save();
    if (shakeMag > 0.5) {
      ctx.translate(
        (Math.random() - 0.5) * shakeMag,
        (Math.random() - 0.5) * shakeMag
      );
    }

    drawSky();
    drawClouds(0.15);
    drawFarm(0.4);

    if (state !== STATE.MENU) {
      drawChannel();
      drawBombs();
    }

    drawPlayer();
    if (state === STATE.GAMEOVER) drawSlapHand();
    ctx.restore();

    drawHUD();

    if (state === STATE.GAMEOVER && slapTime >= SLAP_IMPACT_AT && slapTime < SLAP_TEXT_AT) {
      const flash = Math.max(0, 1 - (slapTime - SLAP_IMPACT_AT) / 8);
      if (flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + flash * 0.4 + ')';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    }

    if (state === STATE.MENU) drawMenu();
    if (state === STATE.GAMEOVER && slapTime >= SLAP_TEXT_AT) drawGameOver();
  }

  function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / (1000 / 60), 3);
    lastTime = timestamp;

    if (!paused) {
      update(dt);
      render();
    }

    requestAnimationFrame(gameLoop);
  }

  function resizeCanvas() {
    const container = document.getElementById('game-container');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / WIDTH, ch / HEIGHT);
    canvas.style.width = WIDTH * scale + 'px';
    canvas.style.height = HEIGHT * scale + 'px';
  }

  function handleMenuClick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    const btnW = 180;
    const btnH = 52;
    const startX = (WIDTH - (btnW * 2 + 24)) / 2;
    const startY = 140;

    for (let i = 0; i < COMMODITIES.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const bx = startX + col * (btnW + 24);
      const by = startY + row * (btnH + 16);
      if (x >= bx && x <= bx + btnW && y >= by && y <= by + btnH) {
        selectedCommodity = i;
        return true;
      }
    }
    return false;
  }

  function onPointerDown(e) {
    if (nameEntry) return;
    e.preventDefault();
    canvas.focus();

    if (state === STATE.MENU) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const hitButton = handleMenuClick(clientX, clientY);
      if (!hitButton) flap();
      return;
    }

    flap();
  }

  function onKeyDown(e) {
    if (nameEntry) {
      if (e.code === 'Escape') {
        e.preventDefault();
        finishNameEntry();
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      flap();
    }
    if (e.code === 'KeyC' && state === STATE.GAMEOVER && slapTime >= SLAP_TEXT_AT) {
      state = STATE.MENU;
      resetGame();
    }
  }

  function initInitialsOverlay() {
    const overlay = document.getElementById('initials-overlay');
    const input = document.getElementById('initials-input');
    const skip = document.getElementById('initials-skip');
    if (!overlay || !input) return;

    overlay.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    overlay.addEventListener('touchstart', function (e) {
      e.stopPropagation();
    }, { passive: true });

    input.addEventListener('input', function () {
      const cleaned = normalizeInitials(input.value);
      if (input.value !== cleaned) input.value = cleaned;
      if (cleaned.length === 2) submitInitials(cleaned);
    });

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.code === 'Enter') {
        e.preventDefault();
        submitInitials(input.value);
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        finishNameEntry();
      }
    });

    if (skip) {
      skip.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        finishNameEntry();
      });
    }
  }

  function initLogo() {
    const logo = document.getElementById('logo');
    if (!logo) return;
    function hideBrokenLogo() {
      logo.style.display = 'none';
    }
    logo.addEventListener('error', hideBrokenLogo);
    if (logo.complete && logo.naturalWidth === 0) hideBrokenLogo();
  }

  function init() {
    initBackground();
    rebuildChannel();
    initLogo();
    initInitialsOverlay();
    loadLeaderboard();
    resizeCanvas();

    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
      if (!paused) lastTime = performance.now();
    });

    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    canvas.focus();
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
  }

  init();
})();
