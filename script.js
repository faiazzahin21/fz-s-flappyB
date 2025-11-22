const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const container = document.getElementById("game-container");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");

// ---------------------------
// Game constants
// ---------------------------
const GRAVITY = 0.45;
const FLAP = -8.5;
const GROUND_H = 80;

const OBSTACLE_WIDTH = 70;
const GAP_HEIGHT = 160;
const OBSTACLE_SPEED = 2.6;
const SPAWN_INTERVAL = 1500;

const PLAYER_RADIUS = 22;
const PLAYER_DRAW_SIZE = 60;

// ---------------------------
// Difficulty scaling
// ---------------------------
const SCORE_PER_LEVEL = 5;
const SPEED_STEP = 0.25;
const GAP_STEP = 6;
const MIN_GAP_HEIGHT = 110;

function getDifficulty() {
  const level = Math.floor(score / SCORE_PER_LEVEL);
  const speed = OBSTACLE_SPEED + level * SPEED_STEP;
  const gap = Math.max(MIN_GAP_HEIGHT, GAP_HEIGHT - level * GAP_STEP);
  return { level, speed, gap };
}

// ---------------------------
// Best score (localStorage)
// ---------------------------
let bestScore = 0;
try {
  bestScore = parseInt(localStorage.getItem("flappy_best") || "0", 10) || 0;
} catch {}

function saveBestScore() {
  try {
    localStorage.setItem("flappy_best", String(bestScore));
  } catch {}
}

// ---------------------------
// Background (city.jpg) + scroll
// ---------------------------
const bgImage = new Image();
bgImage.src = "assets/city.jpg";

let bgX = 0;
const BG_SPEED = 0.6;

function updateBackground() {
  if (gameState === "playing") {
    bgX -= BG_SPEED;
    if (bgX <= -canvas.width) bgX = 0;
  }
}

function drawBackground() {
  if (bgImage.complete && bgImage.naturalWidth !== 0) {
    ctx.drawImage(bgImage, bgX, 0, canvas.width, canvas.height);
    ctx.drawImage(bgImage, bgX + canvas.width, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// ---------------------------
// Explosion image (optional)
// ---------------------------
const explosionImg = new Image();
explosionImg.src = "assets/explosion/boom.png";

// ---------------------------
// Audio (BGM + endings + bomb + flap)
// ---------------------------
const VOLS = {
  bgm: 0.35,
  ending: 0.8,
  bomb: 0.9,
  flap: 0.6,
};

const bgm = new Audio("assets/audio/bgm.mp3");
bgm.loop = true;
bgm.volume = VOLS.bgm;

const endingAudios = [
  new Audio("assets/audio/random-ending1.mp3"),
  new Audio("assets/audio/random-ending2.mp3"),
  new Audio("assets/audio/random-ending3.mp3"),
];
endingAudios.forEach(a => (a.volume = VOLS.ending));

const bombAudio = new Audio("assets/audio/bomb-blast.mp3");
bombAudio.volume = VOLS.bomb;

const flapAudio = new Audio("assets/audio/flap.mp3");
flapAudio.volume = VOLS.flap;
flapAudio.preload = "auto";

let audioReady = false;
let bgmWanted = false;
let muted = false;

function applyMuteState() {
  if (muted) {
    bgm.volume = 0;
    endingAudios.forEach(a => (a.volume = 0));
    bombAudio.volume = 0;
    flapAudio.volume = 0;
  } else {
    bgm.volume = VOLS.bgm;
    endingAudios.forEach(a => (a.volume = VOLS.ending));
    bombAudio.volume = VOLS.bomb;
    flapAudio.volume = VOLS.flap;
  }
}

// unlock on first user gesture
function initAudioFromGesture() {
  if (audioReady) return;
  audioReady = true;

  [bgm, bombAudio, flapAudio, ...endingAudios].forEach(a => a.load());

  // play/pause unlock trick
  const unlockOne = (a) =>
    a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
  unlockOne(bgm);
  unlockOne(bombAudio);
  unlockOne(flapAudio);
  endingAudios.forEach(unlockOne);

  applyMuteState();
  if (bgmWanted) playBgm();
}

function playBgm() {
  bgmWanted = true;
  if (!audioReady || muted) return;
  if (!bgm.paused) return;

  bgm.currentTime = 0;
  bgm.play().catch(() => {});
}

function stopBgm() {
  bgm.pause();
  bgm.currentTime = 0;
  bgmWanted = false;
}

function stopAllAudio() {
  stopBgm();

  endingAudios.forEach(a => {
    a.pause();
    a.currentTime = 0;
    a.onended = null;
  });

  bombAudio.pause();
  bombAudio.currentTime = 0;
  bombAudio.onended = null;

  flapAudio.pause();
  flapAudio.currentTime = 0;
}

// ---------------------------
// Game state
// ---------------------------
let gameState = "ready"; // "ready" | "playing" | "paused" | "crash" | "gameover"
let score = 0;
let crashSequence = null;

// ---------------------------
// Screen shake
// ---------------------------
let shake = { time: 0, duration: 0, intensity: 0 };

function startShake(intensity, durationMs) {
  shake.time = durationMs;
  shake.duration = durationMs;
  shake.intensity = intensity;
}

function updateShake(dt) {
  if (shake.time <= 0) return { x: 0, y: 0 };
  shake.time = Math.max(0, shake.time - dt);

  const k = shake.duration > 0 ? (shake.time / shake.duration) : 0;
  const mag = shake.intensity * k;

  return {
    x: (Math.random() * 2 - 1) * mag,
    y: (Math.random() * 2 - 1) * mag,
  };
}

// ---------------------------
// Heads (normalized)
// ---------------------------
const headSpritePaths = [
  "assets/heads/head1.png",
  "assets/heads/head2.png",
  "assets/heads/head3.png",
];

const headSprites = headSpritePaths.map(p => {
  const img = new Image();
  img.src = p;
  return img;
});

const headMeta = new Map();

function computeVisibleBBox(img) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const off = document.createElement("canvas");
  off.width = iw;
  off.height = ih;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0);

  let data;
  try {
    data = octx.getImageData(0, 0, iw, ih).data;
  } catch {
    return { sx: 0, sy: 0, sw: iw, sh: ih };
  }

  let minX = iw, minY = ih, maxX = -1, maxY = -1;
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const a = data[(y * iw + x) * 4 + 3];
      if (a > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { sx: 0, sy: 0, sw: iw, sh: ih };
  }

  const sw = maxX - minX + 1;
  const sh = maxY - minY + 1;

  const pad = 0.05;
  const padX = sw * pad;
  const padY = sh * pad;

  const sx = Math.max(0, minX - padX);
  const sy = Math.max(0, minY - padY);
  const ex = Math.min(iw, maxX + padX);
  const ey = Math.min(ih, maxY + padY);

  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

headSprites.forEach(img => {
  img.onload = () => {
    headMeta.set(img, computeVisibleBBox(img));
  };
});

function randomHeadSprite() {
  return headSprites[Math.floor(Math.random() * headSprites.length)];
}

function drawNormalizedHead(img, cx, cy, size) {
  const meta = headMeta.get(img);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const sx = meta ? meta.sx : 0;
  const sy = meta ? meta.sy : 0;
  const sw = meta ? meta.sw : iw;
  const sh = meta ? meta.sh : ih;

  const scale = Math.max(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;

  ctx.drawImage(img, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
}

// ---------------------------
// Player
// ---------------------------
const player = {
  x: 120,
  y: canvas.height / 2,
  radius: PLAYER_RADIUS,
  vy: 0,
  sprite: null,
};

function resetPlayer() {
  player.y = canvas.height / 2;
  player.vy = 0;
  player.sprite = randomHeadSprite();
}

// ---------------------------
// Obstacles (variety + wobble)
// ---------------------------
const obstacleSpritePaths = [
  "assets/obstacles/obs1.png",
  "assets/obstacles/obs2.png",
  "assets/obstacles/obs3.png",
];

const obstacleSprites = obstacleSpritePaths.map(p => {
  const img = new Image();
  img.src = p;
  return img;
});

let obstacles = [];
let lastSpawnTime = 0;
let nextSpawnDelay = SPAWN_INTERVAL;

function randomObstacleSprite() {
  return obstacleSprites[Math.floor(Math.random() * obstacleSprites.length)];
}

function spawnObstacle() {
  const groundY = canvas.height - GROUND_H;
  const { speed, gap } = getDifficulty();

  const minGapY = 120;
  const maxGapY = groundY - 120;
  const gapY = minGapY + Math.random() * (maxGapY - minGapY);

  const width = OBSTACLE_WIDTH * (0.9 + Math.random() * 0.3);

  const moving = Math.random() < 0.15;
  const driftAmp = moving ? (18 + Math.random() * 12) : 0;
  const driftSpeed = moving ? (0.002 + Math.random() * 0.0015) : 0;

  obstacles.push({
    x: canvas.width,
    width,
    gapY,
    gapY0: gapY,
    gapHeight: gap,
    speed,

    driftAmp,
    driftSpeed,
    bornAt: performance.now(),

    topSprite: randomObstacleSprite(),
    bottomSprite: randomObstacleSprite(),
    scored: false,
  });
}

// ---------------------------
// Overlay helpers
// ---------------------------
function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.remove("hidden");
}
function hideOverlay() {
  overlay.classList.add("hidden");
}

// ---------------------------
// Collision helpers
// ---------------------------
function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

// ---------------------------
// Crash sequence
// ---------------------------
function startCrashSequence(timestamp) {
  if (gameState !== "playing") return;
  gameState = "crash";

  stopBgm();

  const endingAudio = endingAudios[Math.floor(Math.random() * endingAudios.length)];
  endingAudio.currentTime = 0;
  if (!muted) endingAudio.play().catch(() => {});

  crashSequence = {
    phase: "ending",
    endingAudio,
    explosionStartTime: null,
    bombFallbackEnd: null,
  };

  endingAudio.onended = () => {
    if (!crashSequence || gameState !== "crash") return;
    startBombPhase(performance.now());
  };

  if (muted) startBombPhase(performance.now());
}

function startBombPhase(timestamp) {
  crashSequence.phase = "bomb";
  crashSequence.explosionStartTime = timestamp;

  const fallbackMs =
    bombAudio.duration && !isNaN(bombAudio.duration)
      ? bombAudio.duration * 1000
      : 900;

  startShake(10, fallbackMs);

  bombAudio.currentTime = 0;
  if (!muted) bombAudio.play().catch(() => {});
  bombAudio.onended = () => {
    if (gameState === "crash") finishGameOver();
  };

  crashSequence.bombFallbackEnd = timestamp + fallbackMs;
}

function finishGameOver() {
  gameState = "gameover";
  overlay.classList.add("bloody");
  showOverlay(
    "Chumt ke chakkar mey barbadh!",
    `Score: ${score} | Best: ${bestScore} — Tap/Space to Restart`
  );
}

// ---------------------------
// Mute button + Mobile-safe input
// ---------------------------
const muteBtn = { x: canvas.width - 95, y: 8, w: 85, h: 28 };

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function getCanvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function toggleMute() {
  muted = !muted;
  applyMuteState();
  if (muted) stopBgm();
  else if (gameState === "playing") playBgm();
}

function flap() {
  initAudioFromGesture();

  if (gameState === "paused") {
    gameState = "playing";
    if (bgmWanted && !muted && bgm.paused) playBgm();
  }

  if (gameState === "ready") {
    gameState = "playing";
    hideOverlay();
    lastSpawnTime = performance.now();
    nextSpawnDelay = SPAWN_INTERVAL;
    bgX = 0;
    playBgm();
  }

  if (gameState === "playing") {
    player.vy = FLAP;

    if (audioReady && !muted) {
      flapAudio.currentTime = 0;
      flapAudio.play().catch(() => {});
    }
  }

  if (gameState === "gameover") {
    restartGame();
  }
}

function handleTap(clientX, clientY) {
  if (clientX != null && clientY != null) {
    const { x, y } = getCanvasCoords(clientX, clientY);
    if (pointInRect(x, y, muteBtn)) {
      toggleMute();
      return;
    }
  }
  flap();
}

function onTapEvent(e) {
  e.preventDefault();

  if (e.touches && e.touches.length > 0) {
    const t = e.touches[0];
    handleTap(t.clientX, t.clientY);
    return;
  }

  if (e.clientX != null && e.clientY != null) {
    handleTap(e.clientX, e.clientY);
    return;
  }

  flap();
}

if (window.PointerEvent) {
  container.addEventListener("pointerdown", onTapEvent, { passive: false });
} else {
  container.addEventListener("touchstart", onTapEvent, { passive: false });
  container.addEventListener("mousedown", onTapEvent);
}

window.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    flap();
  }
  if (e.code === "KeyP" && (gameState === "playing" || gameState === "paused")) {
    e.preventDefault();
    gameState = gameState === "playing" ? "paused" : "playing";
    if (gameState === "playing" && bgmWanted && !muted) playBgm();
  }
});

// ---------------------------
// Update
// ---------------------------
function update(timestamp) {
  updateBackground();

  // auto-retry bgm if blocked
  if (gameState === "playing" && bgmWanted && audioReady && bgm.paused && !muted) {
    bgm.play().catch(() => {});
  }

  if (gameState === "paused") return;

  if (gameState === "playing") {
    player.vy += GRAVITY;
    player.y += player.vy;

    const groundY = canvas.height - GROUND_H;

    if (player.y + player.radius >= groundY) {
      player.y = groundY - player.radius;
      startCrashSequence(timestamp);
      return;
    }

    if (player.y - player.radius <= 0) {
      player.y = player.radius;
      player.vy = 0;
    }

    if (timestamp - lastSpawnTime > nextSpawnDelay) {
      spawnObstacle();
      lastSpawnTime = timestamp;

      const { level } = getDifficulty();
      const base = Math.max(900, SPAWN_INTERVAL - level * 40);
      nextSpawnDelay = base * (0.85 + Math.random() * 0.3);
    }

    obstacles.forEach(ob => {
      ob.x -= ob.speed;

      if (ob.driftAmp > 0) {
        const t = timestamp - ob.bornAt;
        ob.gapY = ob.gapY0 + Math.sin(t * ob.driftSpeed) * ob.driftAmp;

        const minGapY = 120;
        const maxGapY = groundY - 120;
        ob.gapY = Math.max(minGapY, Math.min(maxGapY, ob.gapY));
      }

      const topH = ob.gapY - ob.gapHeight / 2;
      const bottomY = ob.gapY + ob.gapHeight / 2;
      const bottomH = groundY - bottomY;

      if (circleRectCollision(player.x, player.y, player.radius, ob.x, 0, ob.width, topH)) {
        startCrashSequence(timestamp);
      }
      if (circleRectCollision(player.x, player.y, player.radius, ob.x, bottomY, ob.width, bottomH)) {
        startCrashSequence(timestamp);
      }

      if (!ob.scored && ob.x + ob.width < player.x) {
        ob.scored = true;
        score += 1;

        if (score > bestScore) {
          bestScore = score;
          saveBestScore();
        }
      }
    });

    obstacles = obstacles.filter(ob => ob.x + ob.width > 0);
  }

  if (gameState === "crash" && crashSequence?.phase === "bomb") {
    if (timestamp >= crashSequence.bombFallbackEnd) {
      finishGameOver();
    }
  }
}

// ---------------------------
// Draw
// ---------------------------
function drawGround() {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, canvas.height - GROUND_H, canvas.width, GROUND_H);
}

function drawPlayer() {
  const img = player.sprite;

  if (img && img.complete && img.naturalWidth !== 0) {
    drawNormalizedHead(img, player.x, player.y, PLAYER_DRAW_SIZE);
  } else {
    ctx.beginPath();
    ctx.fillStyle = "#ffd166";
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawObstacleSpriteOrRect(img, x, y, w, h) {
  if (img && img.complete && img.naturalWidth !== 0) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.fillStyle = "#ff6b6b";
    ctx.fillRect(x, y, w, h);
  }
}

function drawObstacles() {
  const groundY = canvas.height - GROUND_H;
  obstacles.forEach(ob => {
    const topH = ob.gapY - ob.gapHeight / 2;
    const bottomY = ob.gapY + ob.gapHeight / 2;
    const bottomH = groundY - bottomY;

    drawObstacleSpriteOrRect(ob.topSprite, ob.x, 0, ob.width, topH);
    drawObstacleSpriteOrRect(ob.bottomSprite, ob.x, bottomY, ob.width, bottomH);
  });
}

function drawExplosion(timestamp) {
  if (!crashSequence || crashSequence.phase !== "bomb") return;

  const duration = crashSequence.bombFallbackEnd - crashSequence.explosionStartTime;
  const t = (timestamp - crashSequence.explosionStartTime) / duration;
  const progress = Math.min(Math.max(t, 0), 1);

  if (explosionImg.complete && explosionImg.naturalWidth !== 0) {
    const maxSize = 420;
    const size = maxSize * (0.3 + 0.7 * progress);
    ctx.globalAlpha = 1 - progress * 0.2;
    ctx.drawImage(
      explosionImg,
      canvas.width / 2 - size / 2,
      canvas.height / 2 - size / 2,
      size,
      size
    );
    ctx.globalAlpha = 1;
    return;
  }

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = 260 * progress;

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.fillStyle = "#ffb703"; ctx.arc(cx, cy, maxR, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.fillStyle = "#fb8500"; ctx.arc(cx, cy, maxR * 0.65, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.fillStyle = "#ff006e"; ctx.arc(cx, cy, maxR * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawMuteButton() {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = muted ? "#7a0f0f" : "#0f7a2a";
  ctx.fillRect(muteBtn.x, muteBtn.y, muteBtn.w, muteBtn.h);

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "14px Arial";
  ctx.fillText(muted ? "MUTED" : "SOUND ON", muteBtn.x + 10, muteBtn.y + 19);
  ctx.restore();
}

function drawUI() {
  // score
  ctx.fillStyle = "#fff";
  ctx.font = "22px Arial";
  ctx.fillText(score, canvas.width / 2 - 5, 50);

  // level + best
  const { level } = getDifficulty();
  ctx.font = "14px Arial";
  ctx.fillText(`Level: ${level + 1}`, 10, 20);
  ctx.fillText(`Best: ${bestScore}`, 10, 40);

  // ready text
  if (gameState === "ready") {
    ctx.font = "16px Arial";
    ctx.fillText("Tap / Space to Start", 120, 120);
    ctx.font = "14px Arial";
    ctx.fillText(`Best: ${bestScore}`, 120, 145);
  }

  // paused overlay
  if (gameState === "paused") {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "28px Arial";
    ctx.fillText("PAUSED", canvas.width / 2 - 60, canvas.height / 2);
    ctx.font = "14px Arial";
    ctx.fillText("Press P to Resume", canvas.width / 2 - 70, canvas.height / 2 + 25);
    ctx.restore();
  }

  drawMuteButton();
}

// ---------------------------
// Restart
// ---------------------------
function restartGame() {
  gameState = "ready";
  score = 0;
  obstacles = [];
  crashSequence = null;
  lastSpawnTime = 0;
  nextSpawnDelay = SPAWN_INTERVAL;

  stopAllAudio();
  resetPlayer();
  bgX = 0;

  overlay.classList.remove("bloody");
  showOverlay("Ready", "Tap / Space to Start");
}

// ---------------------------
// Main loop
// ---------------------------
let prevTimestamp = 0;
function gameLoop(timestamp) {
  const dt = timestamp - prevTimestamp;
  prevTimestamp = timestamp;

  update(timestamp);

  const offset =
    gameState === "crash" && crashSequence?.phase === "bomb"
      ? updateShake(dt)
      : { x: 0, y: 0 };

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(offset.x, offset.y);

  drawBackground();
  drawExplosion(timestamp);
  drawObstacles();
  drawGround();
  drawPlayer();
  drawUI();

  ctx.restore();
  requestAnimationFrame(gameLoop);
}

// ---------------------------
// Start
// ---------------------------
restartGame();
requestAnimationFrame(gameLoop);
