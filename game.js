// ===== FIREBASE SETUP =====
// Keep config placeholders. IMPORTANT: enforce DB rules on the server to avoid spoofed scores.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== UI Elements =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 480, H = 640, DPR = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  const maxW = Math.min(window.innerWidth - 38, 720);
  const scale = Math.min(1, maxW / W);
  canvas.width = Math.round(W * DPR * scale);
  canvas.height = Math.round(H * DPR * scale);
  canvas.style.width = (W * scale) + 'px';
  canvas.style.height = (H * scale) + 'px';
  ctx.setTransform(DPR * scale, 0, 0, DPR * scale, 0, 0);
}
resizeCanvas(); window.addEventListener('resize', resizeCanvas);

const overlay = document.getElementById('overlay');
const menuContent = document.getElementById('menu-content');
const startBtn = document.getElementById('start');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const levelEl = document.getElementById('level');
const muteBtn = document.getElementById('muteBtn');
const musicBtn = document.getElementById('musicBtn');
const shareBtn = document.getElementById('shareBtn');
const installBtn = document.getElementById('installBtn');
const howBtn = document.getElementById('how');
const leaderboardBtn = document.getElementById('leaderboardBtn');
const worldList = document.getElementById('worldList');
const playerNameInput = document.getElementById('playerName');
const bgMusic = document.getElementById('bgMusic');

let best = parseInt(localStorage.getItem('shadowjump_best') || '0', 10);
if (!Number.isFinite(best)) best = 0;
bestEl.textContent = best;
let running = false, paused = false, musicOn = true, soundOn = true;
let playerName = '';
let raf = null;
let lastSubmitTs = 0;            // simple client-side throttle timestamp
const MIN_SUBMIT_INTERVAL = 1500; // ms between allowed pushes

const PIPE_TEXTURE = new Image();
PIPE_TEXTURE.src = 'assets/pipe-texture.png';

// ===== Helpers =====
function clamp(a, b, c) { return Math.max(b, Math.min(a, c)); }
function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX, dy = cy - closestY;
  return (dx * dx + dy * dy) < r * r;
}

// Escape string for safe text insertion (prevents XSS)
function escapeText(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sanitize and limit player name
function sanitizePlayerName(name) {
  let n = String(name || '').trim();
  // replace runs of whitespace with single space
  n = n.replace(/\s+/g, ' ');
  // allow only a limited safe charset, fallback to slicing if necessary
  const matched = n.match(/[A-Za-z0-9 _\-.]{1,20}/);
  if (matched) return matched[0];
  // if name contains other allowed unicode (like emojis), fall back to safe length-limited escape
  return escapeText(n).slice(0, 20) || 'Player';
}

// ===== LEVEL SYSTEM =====
const LEVELS = [
  { score: 0,    speed: 2.5, gap: 140, gravity: 0.52, name: 'Easy' },
  { score: 10,   speed: 2.9, gap: 130, gravity: 0.56, name: 'Medium' },
  { score: 20,   speed: 3.3, gap: 120, gravity: 0.60, name: 'Hard' },
  { score: 35,   speed: 3.7, gap: 110, gravity: 0.65, name: 'Expert' },
  { score: 50,   speed: 4.1, gap: 98,  gravity: 0.72, name: 'Insane' }
];

// ===== GAME STATE =====
let state = {};
function getLevel(score) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].score) return i;
  }
  return 0;
}
function reset() {
  state = {
    bird: { x: W * 0.28, y: H / 2, r: Math.max(14, Math.round(W * 0.032)), vy: 0 },
    pipes: [],
    level: 0,
    gravity: LEVELS[0].gravity,
    flap: -10,
    pipeW: 72,
    gap: LEVELS[0].gap,
    speed: LEVELS[0].speed,
    frame: 0,
    score: 0,
    gameOver: false
  };
  scoreEl.textContent = state.score;
  bestEl.textContent = best;
  levelEl.textContent = LEVELS[state.level].name;
}

function spawn() {
  // compute safe top range based on current gap and H
  const marginTop = 40;
  const marginBottom = 120;
  const maxTop = Math.max(marginTop, H - state.gap - marginBottom);
  const topH = marginTop + Math.random() * Math.max(0, maxTop - marginTop);
  state.pipes.push({ x: W + state.pipeW, top: Math.round(topH), passed: false });
}

// ===== UPDATE =====
function update() {
  if (!running || paused || state.gameOver) return;
  state.frame++;

  // LEVEL UP LOGIC (safe clamped)
  const currentLevel = getLevel(state.score);
  if (currentLevel !== state.level) {
    state.level = currentLevel;
    state.speed = clamp(LEVELS[state.level].speed, 0.5, 12);
    state.gap = clamp(LEVELS[state.level].gap, 60, H - 200);
    state.gravity = clamp(LEVELS[state.level].gravity, 0.1, 5);
    levelEl.textContent = LEVELS[state.level].name;
  }

  // spawn interval (clamp so interval never becomes too small)
  const spawnInterval = Math.max(50, Math.round(180 - clamp(state.speed, 0.5, 12) * 20));
  if (state.frame % spawnInterval === 0) spawn();

  for (const p of state.pipes) p.x -= state.speed;
  state.pipes = state.pipes.filter(p => p.x + state.pipeW > -20);

  // physics
  state.bird.vy += state.gravity;
  state.bird.y += state.bird.vy;

  // Prevent NaN / corrupt bird values
  if (isNaN(state.bird.x) || isNaN(state.bird.y) || isNaN(state.bird.vy)) {
    state.bird.x = W * 0.28;
    state.bird.y = H / 2;
    state.bird.vy = 0;
  }

  // Clamp bird inside canvas
  state.bird.y = clamp(state.bird.y, state.bird.r + 8, H - 8 - state.bird.r);

  // End game if bird hits top/ground
  if (state.bird.y + state.bird.r >= H - 8 || state.bird.y - state.bird.r <= 8) {
    die();
  }

  // collision & scoring
  for (const p of state.pipes) {
    if (
      circleRect(state.bird.x, state.bird.y, state.bird.r, p.x, 0, state.pipeW, p.top) ||
      circleRect(state.bird.x, state.bird.y, state.bird.r, p.x, p.top + state.gap, state.pipeW, H - p.top - state.gap - 8)
    ) {
      die();
    }
    if (!p.passed && (p.x + state.pipeW) < state.bird.x) {
      p.passed = true;
      state.score = Math.max(0, Math.floor(state.score + 1));
      if (state.score > best) {
        best = state.score;
        try { localStorage.setItem('shadowjump_best', String(best)); } catch (e) {}
        bestEl.textContent = best;
      }
    }
  }
  scoreEl.textContent = state.score;
}

// ===== RENDER =====
function render() {
  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#09082a');
  bg.addColorStop(1, '#18153a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // grid lines
  ctx.save(); ctx.globalAlpha = 0.04; ctx.strokeStyle = '#00fff2';
  for (let y = 0; y < H; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();

  // ground
  ctx.fillStyle = '#18153a'; ctx.fillRect(0, H - 8, W, 8);
  ctx.strokeStyle = 'rgba(0,255,242,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, H - 8); ctx.lineTo(W, H - 8); ctx.stroke();

  // pipes (gradient + texture guarded)
  for (const p of state.pipes) {
    let grad = ctx.createLinearGradient(p.x, 0, p.x + state.pipeW, 0);
    grad.addColorStop(0, "#00fff2");
    grad.addColorStop(0.5, "#1a1853");
    grad.addColorStop(1, "#00fff2");
    ctx.fillStyle = grad;
    ctx.save(); ctx.shadowColor = "#00fff2"; ctx.shadowBlur = 16;
    ctx.fillRect(p.x, 0, state.pipeW, p.top);
    ctx.fillRect(p.x, p.top + state.gap, state.pipeW, H - p.top - state.gap - 8);
    ctx.restore();
    if (PIPE_TEXTURE.complete) {
      try {
        const pattern = ctx.createPattern(PIPE_TEXTURE, 'repeat');
        if (pattern) {
          ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = pattern;
          ctx.fillRect(p.x, 0, state.pipeW, p.top);
          ctx.fillRect(p.x, p.top + state.gap, state.pipeW, H - p.top - state.gap - 8);
          ctx.restore();
        }
      } catch (err) {
        console.warn('Pattern creation failed (image may be cross-origin):', err);
      }
    }
  }

  // bird
  let b = state.bird;
  let birdGrad = ctx.createRadialGradient(b.x, b.y, b.r * 0.2, b.x, b.y, b.r);
  birdGrad.addColorStop(0, "#fff");
  birdGrad.addColorStop(0.3, "#ff3ea9");
  birdGrad.addColorStop(1, "#6a004d");
  ctx.save();
  ctx.shadowColor = 'rgba(255,62,169,0.95)';
  ctx.shadowBlur = 18;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fillStyle = birdGrad; ctx.fill();
  ctx.restore();

  // score + level
  ctx.font = "28px monospace"; ctx.fillStyle = 'rgba(0,255,242,0.95)'; ctx.textAlign = 'center';
  ctx.fillText(state.score, W / 2, 44);
  ctx.font = "20px monospace"; ctx.fillStyle = 'rgba(255,62,169,0.95)';
  const lvlName = LEVELS[state.level] && LEVELS[state.level].name ? LEVELS[state.level].name : 'N/A';
  ctx.fillText(`Level: ${lvlName}`, W / 2, 72);
}

// ===== MAIN LOOP =====
function loop() {
  update();
  render();
  if (running) raf = requestAnimationFrame(loop);
}

// ===== CONTROLS =====
function flap() {
  if (!running && !state.gameOver) { start(); return; }
  if (state.gameOver) return;
  state.bird.vy = state.flap;
}

function start() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  playerName = sanitizePlayerName(playerNameInput.value || 'Player');
  running = true; paused = false; state.gameOver = false;
  overlay.style.display = 'none';
  if (musicOn) { try { bgMusic.play().catch(()=>{}); } catch(e) {} }
  reset();
  raf = requestAnimationFrame(loop);
}

function die() {
  if (state.gameOver) return;
  state.gameOver = true;
  running = false;
  if (musicOn) { try { bgMusic.pause(); } catch(e) {} }
  setTimeout(() => {
    overlay.style.display = 'flex';
    // Build safe DOM (no innerHTML with user data)
    menuContent.innerHTML = ''; // clear
    const h2 = document.createElement('h2'); h2.textContent = '💀 Game Over';
    const pScore = document.createElement('p'); pScore.className = 'muted'; pScore.textContent = `Score: ${state.score}`;
    const pBest = document.createElement('p'); pBest.className = 'muted'; pBest.textContent = `Best: ${best}`;
    const pLevel = document.createElement('p'); pLevel.className = 'muted'; pLevel.textContent = `Level: ${LEVELS[state.level] ? LEVELS[state.level].name : 'N/A'}`;
    const restartBtn = document.createElement('button'); restartBtn.className = 'big-btn'; restartBtn.id = 'restartBtn'; restartBtn.textContent = 'Restart';
    const submitBtn = document.createElement('button'); submitBtn.className = 'small'; submitBtn.id = 'submitScore'; submitBtn.textContent = 'Submit Score';
    menuContent.appendChild(h2); menuContent.appendChild(pScore); menuContent.appendChild(pBest); menuContent.appendChild(pLevel);
    menuContent.appendChild(restartBtn); menuContent.appendChild(submitBtn);

    restartBtn.onclick = () => { overlay.style.display = 'none'; start(); };
    submitBtn.onclick = async () => {
      // throttle client-side
      const now = Date.now();
      if (now - lastSubmitTs < MIN_SUBMIT_INTERVAL) {
        alert('Please wait a moment before submitting again.');
        return;
      }
      lastSubmitTs = now;
      submitBtn.disabled = true;
      try {
        await submitScoreFirebase(playerName, state.score);
        alert('Score submitted!');
        fetchLeaderboard();
      } catch (err) {
        console.error('Submit failed:', err);
        alert('Submit failed. Try again later.');
      } finally {
        setTimeout(() => { submitBtn.disabled = false; }, 2000);
      }
    };
  }, 350);
}

// ===== LEADERBOARD (Firebase) =====
async function submitScoreFirebase(name, score) {
  // Client-side validation (server must also validate via rules/cloud functions)
  const safeName = sanitizePlayerName(name || 'Player');
  let safeScore = Number(score);
  if (!Number.isFinite(safeScore) || safeScore < 0) safeScore = 0;
  safeScore = clamp(Math.floor(safeScore), 0, 1000000); // cap to 1,000,000

  // soft per-client rate-limiting stored locally
  const lastPush = Number(localStorage.getItem('shadowjump_last_push_ts') || '0');
  const now = Date.now();
  if (now - lastPush < 1200) throw new Error('Too many submissions from this client.');
  try { localStorage.setItem('shadowjump_last_push_ts', String(now)); } catch (e) {}

  // push to firebase with error handling
  const payload = { name: safeName, score: safeScore, ts: now };
  try {
    const ref = db.ref('scores').push();
    await ref.set(payload);
    return true;
  } catch (err) {
    console.error('Firebase push error', err);
    throw err;
  }
}

function fetchLeaderboard() {
  db.ref('scores').orderByChild('score').limitToLast(10).once('value', snap => {
    const arr = [];
    snap.forEach(child => {
      const v = child.val();
      if (!v) return;
      arr.push({
        name: (typeof v.name === 'string') ? sanitizePlayerName(v.name) : 'Player',
        score: Number(v.score) || 0,
        ts: Number(v.ts) || 0
      });
    });
    arr.sort((a, b) => b.score - a.score);
    // safe DOM build
    worldList.innerHTML = '';
    arr.forEach((d, i) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = `#${i + 1} ${d.name}`;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(` — ${d.score}`));
      worldList.appendChild(li);
    });
  }, err => {
    console.warn('fetchLeaderboard error', err);
  });
}

// ===== UI EVENTS =====
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); flap(); } });
canvas.addEventListener('mousedown', flap);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); flap(); }, { passive: false });
startBtn.onclick = () => { overlay.style.display = 'none'; start(); };
muteBtn.onclick = () => { soundOn = !soundOn; muteBtn.textContent = soundOn ? '🔊' : '🔇'; };
musicBtn.onclick = () => {
  musicOn = !musicOn; musicBtn.textContent = musicOn ? '🎵' : '🎶';
  try { if (musicOn) bgMusic.play().catch(()=>{}); else bgMusic.pause(); } catch (e) {}
};
shareBtn.onclick = () => {
  const text = `I scored ${state.score} on Shadow Jump+! Play here: ${location.href}`;
  if (navigator.share) { navigator.share({ title: 'Shadow Jump+', text }).catch(() => {}); }
  else { prompt('Copy and share:', text); }
};
installBtn.onclick = () => {
  if (window.deferredPrompt) {
    window.deferredPrompt.prompt();
    window.deferredPrompt.userChoice.then(() => { window.deferredPrompt = null; installBtn.style.display = 'none'; }).catch(()=>{});
  } else alert('Install not supported. Use Add to Home Screen.');
};
howBtn.onclick = () => { alert('Tap / Click / Space to Flap\nAvoid the neon pipes!\nLevels unlock as you score higher!\nSubmit your score to global leaderboard.'); };
leaderboardBtn.onclick = () => { fetchLeaderboard(); worldList.scrollIntoView({ behavior: 'smooth' }); };

// INIT
reset();
render();
fetchLeaderboard();
overlay.style.display = 'flex';

// PWA install prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; window.deferredPrompt = e; installBtn.style.display = 'inline-block';
});