// app.js （完全版）

import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { PLYLoader } from './libs/PLYLoader.js';

/* =========================
   Three.js 基本ユーティリティ
   ========================= */
function createViewer(el) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 1e7);
  camera.position.set(0, 0, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  el.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // 要素サイズに完全追従
  const ro = new ResizeObserver(() => {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1) || 1;
    camera.updateProjectionMatrix();
  });
  ro.observe(el);

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  return { scene, camera, renderer, controls };
}

function fitCameraToBox(cam, bbox, offset = 1.25) {
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = cam.fov * Math.PI / 180;
  let dist = (maxDim / 2) / Math.tan(fov / 2);
  dist *= offset;
  cam.position.copy(center.clone().add(new THREE.Vector3(dist, dist, dist)));
  cam.near = Math.max(0.01, dist / 100);
  cam.far  = dist * 100;
  cam.updateProjectionMatrix();
  return center;
}

function loadPLY(path, size = 0.03, fallback = 0xffffff) {
  const loader = new PLYLoader();
  return new Promise((resolve, reject) => {
    loader.load(path, (geo) => {
      try { geo.computeBoundingBox(); } catch {}
      const hasColor = !!geo.attributes?.color;
      const mat = new THREE.PointsMaterial({
        size,
        vertexColors: hasColor,
        color: hasColor ? undefined : fallback
      });
      resolve({ object: new THREE.Points(geo, mat), bbox: geo.boundingBox });
    }, undefined, reject);
  });
}

/* =========================
   ビュー初期化
   ========================= */
const left  = createViewer(document.getElementById('view-left'));
const right = createViewer(document.getElementById('view-right'));

const FILE_LEFT  = './data/groundTruth.ply';
const FILE_RIGHT = './data/evaluation.ply';

Promise.all([
  loadPLY(FILE_LEFT,  0.035, 0x66ccff),
  loadPLY(FILE_RIGHT, 0.035, 0xffaa55),
]).then(([A, B]) => {
  // 左（GT）
  left.scene.add(A.object);
  const cL = fitCameraToBox(left.camera, A.bbox, 1.35);
  left.controls.target.copy(cL); left.controls.update();

  // 右（Reconstructed）
  right.scene.add(B.object);
  const cR = fitCameraToBox(right.camera, B.bbox, 1.35);
  right.controls.target.copy(cR); right.controls.update();
}).catch(console.error);

/* =========================
   DOM参照 & 状態
   ========================= */
const planCountEl = document.getElementById('plan-count');
const timerEl     = document.getElementById('timer');
const evalEl      = document.getElementById('evaluation');
const bigScoreEl  = document.getElementById('big-score');

// 撮影枚数（5〜20想定）
let selectedPhotos = 10;
function setSelectedPhotos(n) {
  selectedPhotos = n;
  if (planCountEl) planCountEl.textContent = String(n);
}
setSelectedPhotos(10);

// タイマー
let timerId = null;
let startTime = 0;
let lastElapsedSec = 0;

/* =========================
   ボタン：Set / Start / Stop
   ========================= */
document.getElementById('shot-random')?.addEventListener('click', () => {
  const n = Math.floor(Math.random() * 16) + 5; // 5〜20
  setSelectedPhotos(n);
});

document.getElementById('start')?.addEventListener('click', () => {
  if (timerId) return;
  startTime = Date.now();
  timerId = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    lastElapsedSec = elapsed;
    if (timerEl) timerEl.textContent = elapsed.toFixed(1) + "s";
  }, 100);
});

document.getElementById('stop')?.addEventListener('click', () => {
  if (timerId) { clearInterval(timerId); timerId = null; }
});

/* =========================
   Help モーダル
   ========================= */
const helpBtn   = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const closeHelp = document.getElementById('close-help');

if (helpBtn && helpModal && closeHelp) {
  helpBtn.addEventListener('click', () => { helpModal.style.display = 'block'; });
  closeHelp.addEventListener('click', () => { helpModal.style.display = 'none'; });
  window.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.style.display = 'none'; });
}

/* =========================
   Leaderboard（ローカル）
   ========================= */
const STORAGE_KEY = 'restruct_scores_v1';
const MAX_ENTRIES = 100;

function loadScores() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveScores(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}
function sanitizeName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, 16) || 'Guest';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function addScore(name, score, meta = {}) {
  const n = sanitizeName(name);
  const sc = Number(score);
  if (!Number.isFinite(sc)) return;

  const entry = {
    name: n,
    score: sc,
    t: Date.now(),
    photosUsed: meta.photosUsed ?? selectedPhotos,
    timeUsedSec: meta.timeUsedSec ?? Number(lastElapsedSec.toFixed(1)),
    evaluate: meta.evaluate ?? (function () {
      const m = String(evalEl?.textContent || '').match(/([\d.]+)/);
      return m ? Number(m[1]) : null;
    })()
  };

  const arr = loadScores();
  arr.push(entry);
  arr.sort((a,b)=> (b.score - a.score) || (a.timeUsedSec - b.timeUsedSec) || (a.t - b.t));
  saveScores(arr.slice(0, MAX_ENTRIES));
  renderLeaderboard();
}

function renderLeaderboard() {
  const list = document.getElementById('leaderboard');
  if (!list) return;
  const arr = loadScores();

  const rows = arr.map((e, i)=>`
    <tr>
      <td class="num">${i+1}</td>
      <td>${escapeHtml(e.name)}</td>
      <td>${e.photosUsed ?? '-'}</td>
      <td>${(e.timeUsedSec ?? 0).toFixed(1)}s</td>
      <td>${e.evaluate!=null ? e.evaluate.toFixed(2)+'%' : '-'}</td>
      <td class="score"><strong>${e.score.toFixed(2)}</strong></td>
    </tr>
  `).join('');

  list.innerHTML = `
    <table class="leadertable">
      <thead>
        <tr>
          <th>#</th><th>Name</th><th>Photos</th><th>Time</th><th>Evaluate</th><th>Score</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
renderLeaderboard();

const form = document.getElementById('score-form');
const nameInput = document.getElementById('player-name');
const scoreInput = document.getElementById('player-score');
document.getElementById('reset-btn')?.addEventListener('click', () => {
  if (confirm('ランキングをリセットしますか？（この端末のみ）')) {
    localStorage.removeItem(STORAGE_KEY);
    renderLeaderboard();
  }
});

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  addScore(
    nameInput?.value,
    scoreInput?.value,
    {
      photosUsed: selectedPhotos,
      timeUsedSec: Number(lastElapsedSec.toFixed(1)),
      evaluate: (function(){
        const m = String(evalEl?.textContent||'').match(/([\d.]+)/);
        return m ? Number(m[1]) : null;
      })()
    }
  );
  form.reset();
  nameInput?.focus();
});

/* =========================
   Evaluate（JSON→重みづけ→表示）
   ========================= */
const RESULT_JSON = './data/result_latest.json';

// 重み（必要に応じて調整）
const WEIGHT_EVAL   = 0.5;   // MATLAB精度(%)
const WEIGHT_PHOTOS = 0.25;  // 枚数（少ないほど良い）
const WEIGHT_TIME   = 0.25;  // 時間（短いほど良い）

const MIN_PHOTOS = 5;
const MAX_PHOTOS = 20;

function photoScoreLessIsBetter(n) {
  if (n <= MIN_PHOTOS) return 100;
  if (n >= MAX_PHOTOS) return 0;
  return 100 * (1 - (n - MIN_PHOTOS) / (MAX_PHOTOS - MIN_PHOTOS));
}

function timeScoreShorterIsBetter(sec) {
  // 60秒で0点（線形）
  return Math.max(0, 100 - (sec / 60) * 100);
}

function applyBigScoreEffects(value) {
  if (!bigScoreEl) return;

  // 数値の更新（小数2桁）
  bigScoreEl.textContent = value.toFixed(2);

  // ランク文字の更新（色やクラスは付け替えない）
  if (rankDisplayEl) {
    if (value >= 80) {
      rankDisplayEl.textContent = "🏆 GOLD RANK";
    } else if (value >= 60) {
      rankDisplayEl.textContent = "🥈 SILVER RANK";
    } else {
      rankDisplayEl.textContent = "🥉 BRONZE RANK";
    }
  }

  // ちょい演出（数値だけ軽く拡大→戻す）
  bigScoreEl.style.transform = "scale(1.15)";
  // bigScoreEl.style.color など、色変更は一切しない
  setTimeout(() => {
    bigScoreEl.style.transform = "scale(1)";
  }, 400);
}

document.getElementById('evaluate')?.addEventListener('click', async () => {
  try {
    const res = await fetch(RESULT_JSON + '?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('JSON load failed');
    const data = await res.json();

    // MATLAB 側の JSON キー：
    // total_score（%）があれば最優先、無ければ rmse などを適宜変換する運用でもOK
    const evalPct = Number(data.total_score ?? data.rmse ?? 0);

    const scorePhotos = photoScoreLessIsBetter(selectedPhotos);
    const scoreTime   = timeScoreShorterIsBetter(lastElapsedSec);

    const finalScore =
      WEIGHT_EVAL   * evalPct +
      WEIGHT_PHOTOS * scorePhotos +
      WEIGHT_TIME   * scoreTime;

    // UI反映
    if (evalEl) evalEl.textContent = evalPct.toFixed(2) + "%";
    if (scoreInput) scoreInput.value = finalScore.toFixed(2);
    applyBigScoreEffects(finalScore);

    console.log({
      evalPct,
      selectedPhotos,
      lastElapsedSec,
      scorePhotos,
      scoreTime,
      finalScore
    });

  } catch (err) {
    console.error(err);
    if (evalEl) evalEl.textContent = "Error loading JSON";
  }
});

const rankDisplayEl = document.getElementById('rank-display');
