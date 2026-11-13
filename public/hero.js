import { evaluate } from './domain.mjs';
import { presets } from './scenarios.js';

const scene = document.querySelector('#orbital-scene');
const toggle = document.querySelector('#orbital-toggle');
const heartRate = document.querySelector('#orbital-hr');
const oxygenSaturation = document.querySelector('#orbital-spo2');
const alert = document.querySelector('#orbital-alert');
const alertCard = alert.closest('.orbital-reading');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const sequence = [presets.nominal, presets.oxygen, presets.fatigue, presets.combined];
const alertLabels = { nominal: 'No flags', watch: 'Watch', review: 'Review needed' };
let index = 0;
let paused = false;
let inView = false;
let timer;

function renderReading() {
  const observation = sequence[index];
  const severity = evaluate(observation).at(-1)?.severity || 'nominal';
  heartRate.textContent = observation.heart_rate;
  oxygenSaturation.textContent = observation.spo2;
  alert.textContent = alertLabels[severity];
  alertCard.dataset.level = severity;
}

function updatePlayback() {
  const playing = inView && !paused && !reducedMotion.matches && !document.hidden;
  scene.classList.toggle('is-playing', playing);
  toggle.hidden = reducedMotion.matches;
  toggle.textContent = paused ? 'Resume preview' : 'Pause preview';
  window.clearInterval(timer);
  if (playing) {
    timer = window.setInterval(() => {
      index = (index + 1) % sequence.length;
      renderReading();
    }, 8000);
  }
}

toggle.addEventListener('click', () => {
  paused = !paused;
  updatePlayback();
});
reducedMotion.addEventListener('change', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
new IntersectionObserver(([entry]) => {
  inView = entry.isIntersecting;
  updatePlayback();
}).observe(scene);
renderReading();
updatePlayback();
