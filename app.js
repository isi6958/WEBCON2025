import * as THREE from '../../libs/three.module.js';
import { OrbitControls } from '../../libs/OrbitControls.js';
import { PLYLoader } from '../../libs/PLYLoader.js';

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
    camera.aspect = w / h || 1;
    camera.updateProjectionMatrix();
  });
  ro.observe(el);

  (function animate(){
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
      const hasColor = !!geo.attributes.color;
      const mat = new THREE.PointsMaterial({
        size, vertexColors: hasColor, color: hasColor ? undefined : fallback
      });
      resolve({ object: new THREE.Points(geo, mat), bbox: geo.boundingBox });
    }, undefined, reject);
  });
}

// ビューを2つ作成
const left  = createViewer(document.getElementById('view-left'));
const right = createViewer(document.getElementById('view-right'));

// ファイル名（同階層）
const FILE_LEFT  = '../../data/cluster2_cc_mabikionna2.ply';
const FILE_RIGHT = '../../data/ptCloud_cluster1.ply';

Promise.all([
  loadPLY(FILE_LEFT,  0.035, 0x66ccff),
  loadPLY(FILE_RIGHT, 0.035, 0xffaa55),
]).then(([A, B]) => {
  // 左
  left.scene.add(A.object);
  const cL = fitCameraToBox(left.camera, A.bbox, 1.35);
  left.controls.target.copy(cL); left.controls.update();

  // 右
  right.scene.add(B.object);
  const cR = fitCameraToBox(right.camera, B.bbox, 1.35);
  right.controls.target.copy(cR); right.controls.update();
}).catch(console.error);

// ===== Leaderboard (localStorage) =====
const STORAGE_KEY = 'restruct_scores_v1';
const MAX_ENTRIES = 100; // ここを増減すれば「何人まで」でもOK

function loadScores() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveScores(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}

function sanitizeName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 16) || 'Guest';
}

/** スコアを追加して保存（降順で上位MAX_ENTRIESに切り詰め） */
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
    evaluate: meta.evaluate ?? (function(){
      const m = String(document.getElementById('evaluation')?.textContent || '').match(/([\d.]+)/);
      return m ? Number(m[1]) : null;
    })()
  };

  const arr = loadScores();
  arr.push(entry);
  // 並び：Score 降順 → 同点は Time 昇順 → 先着
  arr.sort((a,b)=> (b.score - a.score) || (a.timeUsedSec - b.timeUsedSec) || (a.t - b.t));
  saveScores(arr.slice(0, MAX_ENTRIES));
  renderLeaderboard();
}

/** 表示 */
function renderLeaderboard() {
  const list = document.getElementById('leaderboard');
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

function resetLeaderboard() {
  localStorage.removeItem(STORAGE_KEY);
  renderLeaderboard();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- フォーム連携 ---
const form = document.getElementById('score-form');
const nameInput = document.getElementById('player-name');
const scoreInput = document.getElementById('player-score');
const resetBtn = document.getElementById('reset-btn');

// フォーム送信：メタ情報も渡す
form.addEventListener('submit', (e) => {
  e.preventDefault();
  addScore(
    nameInput.value,
    scoreInput.value,
    {
      photosUsed: selectedPhotos,
      timeUsedSec: Number(lastElapsedSec.toFixed(1)),
      evaluate: (function(){
        const m = String(evalEl.textContent||'').match(/([\d.]+)/);
        return m ? Number(m[1]) : null;
      })()
    }
  );
  form.reset();
  nameInput.focus();
});

resetBtn.addEventListener('click', () => {
  if (confirm('ランキングをリセットしますか？（この端末のみ）')) resetLeaderboard();
});

// 初期描画
renderLeaderboard();

// ===== 例：評価完了時に自動保存したい場合 =====
// どこかの処理で score が確定したら↓を呼ぶ
// addScore(currentPlayerName, finalScore, { rmse, p95, photosUsed, timeUsedSec });

// ---- Recommended photos (random 5–20) ----
let selectedPhotos = 10;                          // 初期値
const planCountEl = document.getElementById('plan-count');
function setSelectedPhotos(n){
  selectedPhotos = n;
  planCountEl.textContent = String(n);
}
setSelectedPhotos(10);

document.getElementById('shot-random').addEventListener('click', ()=>{
  const n = Math.floor(Math.random()*16) + 5;     // 5〜20
  setSelectedPhotos(n);
});


// ===== Timer機能 =====
let timerId = null;
let startTime = 0;
let lastElapsedSec = 0;

const timerEl = document.getElementById('timer');
const evalEl  = document.getElementById('evaluation');

document.getElementById('start').addEventListener('click', () => {
  if (timerId) return; // 連打防止
  startTime = Date.now();
  timerId = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    lastElapsedSec = elapsed;
    timerEl.textContent = elapsed.toFixed(1) + "s";
  }, 100);
});

document.getElementById('stop').addEventListener('click', () => {
  if (timerId) { clearInterval(timerId); timerId = null; }
});

// ===== Evaluate ボタンでランダムに%を表示 =====
document.getElementById('evaluate').addEventListener('click', () => {
  const randomScore = (Math.random() * 100).toFixed(1); // 0.0～100.0
  evalEl.textContent = randomScore + "%";
});