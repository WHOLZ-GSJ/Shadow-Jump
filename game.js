// ===== LEVEL SETTINGS =====
const LEVELS = {
  1: {gap:200, gravity:0.45, flap:-11, name:"Easy"},
  2: {gap:150, gravity:0.52, flap:-10, name:"Medium"},
  3: {gap:100, gravity:0.62, flap:-9, name:"Hard"},
  4: {gap:75,  gravity:0.75, flap:-8, name:"Impossible"}
};

let currentLevel = 1;

// ===== CANVAS & UI =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 480, H = 640, DPR = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  const maxW = Math.min(window.innerWidth - 38, 720);
  const scale = Math.min(1, maxW / W);
  canvas.width = Math.round(W * DPR * scale);
  canvas.height = Math.round(H * DPR * scale);
  canvas.style.width = (W*scale) + 'px';
  canvas.style.height = (H*scale) + 'px';
  ctx.setTransform(DPR*scale,0,0,DPR*scale,0,0);
}
resizeCanvas(); window.addEventListener('resize', resizeCanvas);

// ====== UI Elements ======
const overlay = document.getElementById('overlay');
const menuContent = document.getElementById('menu-content');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const muteBtn = document.getElementById('muteBtn');
const musicBtn = document.getElementById('musicBtn');
const pauseBtn = document.getElementById('pauseBtn');
const howBtn = document.getElementById('how');
const levelLabel = document.getElementById('levelLabel');

let best = Number(localStorage.getItem('shadowjump_best_level'+currentLevel)||0);
bestEl.textContent = best;
let running=false, paused=false, musicOn=false, soundOn=true;

// ====== Game State ======
let state = {};
function setLevel(level) {
  currentLevel = level;
  let lvl = LEVELS[currentLevel];
  state = {
    bird: { x: W*0.28, y: H/2, r: Math.max(12, Math.round(W*0.03)), vy:0 },
    pipes: [],
    gravity: lvl.gravity,
    flap: lvl.flap,
    pipeW:70,
    gap:lvl.gap,
    speed:2.8,
    frame:0,
    score:0,
    gameOver:false
  };
  best = Number(localStorage.getItem('shadowjump_best_level'+currentLevel)||0);
  bestEl.textContent = best;
  scoreEl.textContent = 0;
  levelLabel.textContent = "Level "+currentLevel+" ("+lvl.name+")";
}

function reset() {
  setLevel(currentLevel);
}

// ====== Sound & Music ======
let audioCtx, padOsc, musicOsc;
function ensureAudio() { if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }
function startPad() {
  if(!soundOn) return; ensureAudio();
  stopPad();
  padOsc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  padOsc.type='sawtooth';
  padOsc.frequency.value=110;
  g.gain.value=0.03;
  padOsc.connect(g); g.connect(audioCtx.destination);
  padOsc.start();
}
function stopPad() { try{ padOsc && padOsc.stop(); }catch(e){} padOsc=null; }
function flapSound() {
  if(!soundOn) return; ensureAudio();
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='square'; o.frequency.value=980; g.gain.value=0.07;
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.07);
}
function pointSound() {
  if(!soundOn) return; ensureAudio();
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='sine'; o.frequency.value=700; g.gain.value=0.04;
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.09);
}
function crashSound() {
  if(!soundOn) return; ensureAudio();
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type='sawtooth'; o.frequency.value=50; g.gain.value=0.15;
  o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.18);
}
function startMusic() {
  if(!musicOn) return; ensureAudio();
  stopMusic();
  musicOsc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  musicOsc.type='triangle';
  musicOsc.frequency.value=220;
  g.gain.value=0.09;
  musicOsc.connect(g); g.connect(audioCtx.destination);
  musicOsc.start();
}
function stopMusic() { try{ musicOsc && musicOsc.stop(); }catch(e){} musicOsc=null; }

// ====== Helpers ======
function clamp(a,b,c){return Math.max(b,Math.min(a,c));}
function circleRect(cx,cy,r,rx,ry,rw,rh){
  const closestX = clamp(cx,rx,rx+rw);
  const closestY = clamp(cy,ry,ry+rh);
  const dx = cx-closestX, dy = cy-closestY;
  return (dx*dx+dy*dy) < r*r;
}

// ====== Game Functions ======
function spawn(){
  const topH = 60 + Math.random() * (H - state.gap - 160);
  state.pipes.push({x:W + state.pipeW, top: Math.round(topH), passed:false});
}
function update(){
  if(!running || paused || state.gameOver) return;
  state.frame++;
  if(state.frame % Math.max(90, Math.round(180 - state.speed*20)) === 0) spawn();
  // move pipes
  for(const p of state.pipes) p.x -= state.speed;
  state.pipes = state.pipes.filter(p=>p.x + state.pipeW > -20);
  // physics
  state.bird.vy += state.gravity;
  state.bird.y += state.bird.vy;
  // floor / ceiling
  if(state.bird.y + state.bird.r > H - 8){
    state.bird.y = H - 8 - state.bird.r; die();
  }
  if(state.bird.y - state.bird.r < 8){
    state.bird.y = 8 + state.bird.r; state.bird.vy = 0;
  }
  // pipes collision & scoring
  for(const p of state.pipes){
    if(circleRect(state.bird.x,state.bird.y,state.bird.r,p.x,0,state.pipeW,p.top)) die();
    if(circleRect(state.bird.x,state.bird.y,state.bird.r,p.x,p.top + state.gap,state.pipeW,H - p.top - state.gap - 8)) die();
    if(!p.passed && (p.x + state.pipeW) < state.bird.x){
      p.passed = true;
      state.score++;
      pointSound();
      if(state.score > best){
        best = state.score;
        localStorage.setItem('shadowjump_best_level'+currentLevel, String(best));
        bestEl.textContent = best;
      }
      if(state.score % 10 === 0) state.speed += 0.18;
    }
  }
  scoreEl.textContent = state.score;
}

function die(){
  if(state.gameOver) return;
  state.gameOver = true;
  running=false;
  crashSound();
  setTimeout(()=>{
    overlay.style.display = 'flex';
    menuContent.innerHTML = `
      <h2>💀 Game Over</h2>
      <p class="muted">Score: <strong>${state.score}</strong></p>
      <p class="muted">Best: <strong>${best}</strong></p>
      <button class="big-btn" id="restartBtn">Restart</button>
      <button class="small" id="menuBtn">Menu</button>
    `;
    document.getElementById('restartBtn').onclick = ()=>{ overlay.style.display='none'; reset(); start(); };
    document.getElementById('menuBtn').onclick = ()=>{ location.reload(); };
  },350);
}

function render(){
  // background
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#09082a'); bg.addColorStop(1,'#18153a');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

  // grid lines
  ctx.save(); ctx.globalAlpha = 0.04; ctx.strokeStyle = '#00fff2';
  for(let y=0;y<H;y+=14){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();

  // ground
  ctx.fillStyle = '#18153a'; ctx.fillRect(0,H-8,W,8);
  ctx.strokeStyle = 'rgba(0,255,242,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0,H-8); ctx.lineTo(W,H-8); ctx.stroke();

  // pipes
  for(const p of state.pipes){
    ctx.shadowColor = 'rgba(0,255,242,0.9)'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#00fff2'; ctx.fillRect(p.x,0,state.pipeW,p.top);
    ctx.fillRect(p.x,p.top + state.gap, state.pipeW, H - p.top - state.gap - 8);
    ctx.shadowBlur = 0;
  }

  // bird
  ctx.beginPath(); ctx.arc(state.bird.x, state.bird.y, state.bird.r, 0, Math.PI*2);
  ctx.fillStyle = '#ff3ea9'; ctx.shadowColor = 'rgba(255,62,169,0.95)'; ctx.shadowBlur = 18; ctx.fill();
  ctx.shadowBlur = 0;

  // center score
  ctx.font = "28px monospace"; ctx.fillStyle = 'rgba(0,255,242,0.95)'; ctx.textAlign='center';
  ctx.fillText(state.score, W/2, 44);
}

// ===== Main Loop =====
let raf=0;
function loop(){
  update();
  render();
  if(running) raf = requestAnimationFrame(loop);
}

// ===== Controls =====
function flap(){
  if(!running && !state.gameOver){ start(); return; }
  if(state.gameOver) return;
  state.bird.vy = state.flap;
  flapSound();
}
function start(){
  try{ if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }catch(e){}
  running = true; paused=false;
  overlay.style.display = 'none';
  startPad(); if(musicOn) startMusic();
  raf = requestAnimationFrame(loop);
}
function togglePause(){
  if(state.gameOver) return;
  paused = !paused;
  if(paused){ pauseBtn.textContent = '▶️'; stopPad(); stopMusic(); }
  else { pauseBtn.textContent = '⏸️'; if(soundOn) startPad(); if(musicOn) startMusic(); raf = requestAnimationFrame(loop);}
}

// ===== UI Events =====
window.addEventListener('keydown', (e)=>{ if(e.code==='Space'){ e.preventDefault(); flap(); } if(e.code==='KeyP') togglePause(); });
canvas.addEventListener('mousedown', flap);
canvas.addEventListener('touchstart', (e)=>{ e.preventDefault(); flap(); }, {passive:false});

muteBtn.onclick = ()=>{ soundOn = !soundOn; muteBtn.textContent = soundOn ? '🔊' : '🔇'; if(!soundOn) stopPad(); else if(running) startPad(); };
musicBtn.onclick = ()=>{ musicOn = !musicOn; musicBtn.textContent = musicOn ? '🎵' : '🎶'; if(!musicOn) stopMusic(); else if(running) startMusic(); };
pauseBtn.onclick = togglePause;

if (howBtn) {
  howBtn.onclick = ()=>{ alert('Controls:\n- Tap / Click / Space to Flap\n- P to Pause\n\nGoal: Avoid the neon pipes and set a high score!\nChoose your challenge level wisely!'); };
}

// Level select buttons
document.querySelectorAll('.level-btn').forEach(btn=>{
  btn.onclick = function() {
    let lvl = +btn.getAttribute('data-level');
    setLevel(lvl);
    overlay.style.display="none";
    start();
  };
});

// INIT
reset();
render();

// Show level menu on page load
overlay.style.display="flex";