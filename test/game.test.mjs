import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const htmlPath = path.join(process.cwd(), 'index.html');

function createNoopContext() {
  const gradient = { addColorStop() {} };
  const ctx = {
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
    fill() {}, stroke() {}, setLineDash() {}, fillText() {},
    createLinearGradient() { return gradient; }
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return typeof prop === 'string' ? function() {} : undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return function() {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

async function loadGame(seed = 12345) {
  const html = await fs.readFile(htmlPath, 'utf8');
  const errors = [];
  const random = seededRandom(seed);

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.Math.random = random;
      window.requestAnimationFrame = () => 1;
      window.cancelAnimationFrame = () => {};
      window.innerWidth = 400;
      window.innerHeight = 700;
      window.onerror = (message, source, lineno, colno, error) => {
        errors.push(error || new Error(String(message)));
      };
      window.HTMLCanvasElement.prototype.getContext = function() {
        return createNoopContext();
      };
      window.HTMLCanvasElement.prototype.getBoundingClientRect = function() {
        return { left: 0, top: 0, width: this.width || 400, height: this.height || 700 };
      };
    }
  });

  return { dom, debug: dom.window.__frogDebug, errors };
}

function stepUntil(debug, predicate, maxFrames = 1200) {
  for (let i = 0; i < maxFrames; i++) {
    debug.step(1);
    if (predicate(debug.getState())) return true;
  }
  return false;
}

test('title screen starts the game and auto-runs from land', async () => {
  const { debug, errors } = await loadGame();
  assert.equal(debug.getState().mode, 'title');

  debug.tapLogical(200, 300);
  const state = debug.getState();
  assert.equal(state.mode, 'playing');
  assert.equal(state.frog.state, 'running');

  const jumpedFromLand = stepUntil(debug, (next) => next.frog.state === 'air' && next.frog.x >= 140, 80);
  assert.equal(jumpedFromLand, true);
  assert.equal(errors.length, 0);
});

test('timing window appears and tap boosts the frog', async () => {
  const { debug, errors } = await loadGame(2222);
  debug.startGame();

  const sawTimingWindow = stepUntil(debug, (state) => state.timingWindowActive, 240);
  assert.equal(sawTimingWindow, true);

  const beforeTap = debug.getState();
  debug.tapLogical(200, 430);
  const afterTap = debug.getState();

  assert.equal(afterTap.mode, 'playing');
  assert.equal(afterTap.frog.state, 'air');
  assert.ok(afterTap.frog.vy < beforeTap.frog.vy);
  assert.ok(afterTap.frog.vy < 0);
  assert.equal(errors.length, 0);
});

test('missing the timing window leads to game over and retry restarts cleanly', async () => {
  const { debug, errors } = await loadGame(3333);
  debug.startGame();

  const reachedGameOver = stepUntil(debug, (state) => state.mode === 'gameover', 360);
  assert.equal(reachedGameOver, true);

  const gameOverState = debug.getState();
  assert.equal(gameOverState.mode, 'gameover');

  debug.tapLogical(200, 300);
  const restarted = debug.getState();
  assert.equal(restarted.mode, 'playing');
  assert.equal(restarted.score, 0);
  assert.equal(restarted.frog.state, 'running');
  assert.equal(restarted.frog.alive, true);
  assert.equal(errors.length, 0);
});

test('game survives long simulation and fresh reload without runtime errors', async () => {
  const first = await loadGame(4444);
  first.debug.startGame();
  first.debug.step(900);
  assert.equal(first.errors.length, 0);

  const second = await loadGame(5555);
  second.debug.startGame();
  second.debug.step(900);
  assert.equal(second.errors.length, 0);
});
