import test from "node:test";
import assert from "node:assert/strict";
import { SnakeEngine, DIFFICULTIES, COMBO_WINDOW } from "../js/engine.js";

function playingEngine(options = {}) {
  const engine = new SnakeEngine({ rng: () => 0.5, ...options });
  engine.start();
  return engine;
}

function setSnake(engine, snake, direction) {
  engine.snake = snake.map((cell) => ({ ...cell }));
  engine.prevSnake = snake.map((cell) => ({ ...cell }));
  engine.direction = { ...direction };
  engine.turnQueue = [];
  engine.phase = "playing";
  engine.food = { x: engine.grid - 1, z: engine.grid - 1 };
  if (engine.snake.some((cell) => cell.x === engine.food.x && cell.z === engine.food.z)) {
    engine.food = { x: 0, z: 0 };
  }
}

test("starts with four segments, a valid direction and food off the snake", () => {
  const engine = playingEngine();
  assert.equal(engine.length, 4);
  assert.equal(engine.phase, "playing");
  assert.ok(engine.food);
  assert.ok(!engine.snake.some((cell) => cell.x === engine.food.x && cell.z === engine.food.z));
  const state = engine.getState();
  assert.equal(state.grid, 17);
  assert.equal(state.score, 0);
});

test("rejects reversals and duplicate directions", () => {
  const engine = playingEngine();
  assert.equal(engine.setDirection(0, 1), false, "down is opposite of up");
  assert.equal(engine.setDirection(0, -1), false, "up is already the direction");
  assert.equal(engine.setDirection(-1, 0), true);
  assert.equal(engine.setDirection(1, 0), false, "right is opposite of queued left");
  assert.equal(engine.setDirection(0, 1), true);
});

test("moves one cell per step and keeps four segments", () => {
  const engine = playingEngine();
  const head = { ...engine.head };
  const event = engine.step();
  assert.equal(event.type, "move");
  assert.deepEqual(engine.head, { x: head.x, z: head.z - 1 });
  assert.equal(engine.length, 4);
});

test("eating grows the snake, scores a combo and respawns food", () => {
  const engine = playingEngine();
  engine.food = { x: engine.head.x, z: engine.head.z - 1 };
  const first = engine.step();
  assert.equal(first.type, "eat");
  assert.equal(first.gained, 10);
  assert.equal(engine.length, 5);
  assert.equal(engine.score, 10);
  assert.equal(engine.combo, 1);
  assert.equal(engine.comboTimer, COMBO_WINDOW);
  assert.notDeepEqual(engine.food, { x: engine.head.x, z: engine.head.z });

  engine.food = { x: engine.head.x, z: engine.head.z - 1 };
  const second = engine.step();
  assert.equal(second.type, "eat");
  assert.equal(second.combo, 2);
  assert.equal(second.gained, 20);
  assert.equal(engine.score, 30);
  assert.equal(engine.length, 6);
});

test("combo expires after the window", () => {
  const engine = playingEngine();
  engine.food = { x: engine.head.x, z: engine.head.z - 1 };
  engine.step();
  assert.equal(engine.combo, 1);
  engine.update(COMBO_WINDOW + 10);
  assert.equal(engine.combo, 1);
  assert.equal(engine.comboTimer, 0);
});

test("speed increases as food is eaten", () => {
  const engine = playingEngine();
  const initial = engine.tickMs;
  for (let i = 0; i < 4; i += 1) {
    engine.snake = [
      { x: 8, z: 8 },
      { x: 8, z: 9 },
      { x: 8, z: 10 },
      { x: 8, z: 11 },
      { x: 8, z: 12 },
    ];
    engine.prevSnake = engine.snake.map((cell) => ({ ...cell }));
    engine.direction = { x: 0, z: -1 };
    engine.food = { x: 8, z: 7 };
    engine.step();
  }
  assert.ok(engine.tickMs < initial, "tick duration should decrease");
  assert.equal(engine.eaten, 4);
});

test("walls end the run", () => {
  const engine = playingEngine();
  setSnake(engine, [{ x: 0, z: 5 }, { x: 1, z: 5 }, { x: 2, z: 5 }, { x: 3, z: 5 }], { x: -1, z: 0 });
  const event = engine.step();
  assert.equal(event.type, "death");
  assert.equal(event.cause, "wall");
  assert.equal(engine.phase, "dead");
  assert.equal(engine.deathCause, "wall");
});

test("self collision ends the run", () => {
  const engine = playingEngine();
  setSnake(
    engine,
    [
      { x: 5, z: 5 },
      { x: 5, z: 6 },
      { x: 6, z: 6 },
      { x: 6, z: 5 },
    ],
    { x: 0, z: 1 }
  );
  const event = engine.step();
  assert.equal(event.type, "death");
  assert.equal(event.cause, "self");
});

test("moving into the tail cell is safe when the tail vacates it", () => {
  const engine = playingEngine();
  setSnake(
    engine,
    [
      { x: 5, z: 5 },
      { x: 6, z: 5 },
      { x: 6, z: 4 },
      { x: 5, z: 4 },
    ],
    { x: 0, z: -1 }
  );
  // Head moves down into (5,4), which is the old tail; this is a legal
  // move because the tail is leaving on the same tick.
  const event = engine.step();
  assert.equal(event.type, "move");
  assert.deepEqual(engine.head, { x: 5, z: 4 });
  assert.equal(engine.phase, "playing");
});

test("pause and resume set the phase", () => {
  const engine = playingEngine();
  assert.equal(engine.pause(), true);
  assert.equal(engine.phase, "paused");
  assert.equal(engine.step(), null);
  assert.equal(engine.resume(), true);
  assert.equal(engine.phase, "playing");
});

test("2x2 test grid reports a full board when no cell is free", () => {
  const engine = new SnakeEngine({ grid: 5 });
  engine.snake = [];
  for (let z = 0; z < 5; z += 1) {
    for (let x = 0; x < 5; x += 1) engine.snake.push({ x, z });
  }
  assert.equal(engine.spawnFood(), null);
  assert.equal(engine.food, null);
});

test("difficulty changes reset a non-running game", () => {
  const engine = new SnakeEngine({ difficulty: "classic" });
  assert.equal(engine.setDifficulty("frenzy"), true);
  assert.equal(engine.difficulty, "frenzy");
  assert.equal(engine.tickMs, DIFFICULTIES.frenzy.baseTick);
  assert.equal(engine.phase, "menu");
  assert.equal(engine.setDifficulty("nope"), false);
});
