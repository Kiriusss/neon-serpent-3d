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
  engine.food = { x: engine.grid - 1, y: engine.grid - 1, z: engine.grid - 1 };
  if (engine.snake.some((cell) => cell.x === engine.food.x && cell.y === engine.food.y && cell.z === engine.food.z)) {
    engine.food = { x: 0, y: 0, z: 0 };
  }
}

test("starts with four 3D segments and food off the snake", () => {
  const engine = playingEngine();
  assert.equal(engine.grid, 13);
  assert.equal(engine.length, 4);
  assert.equal(engine.phase, "playing");
  assert.ok(engine.food);
  assert.equal(engine.snake[0].y, 6);
  assert.ok(!engine.snake.some((cell) => cell.x === engine.food.x && cell.y === engine.food.y && cell.z === engine.food.z));
  assert.equal(engine.getState().grid, 13);
});

test("rejects reversals, duplicates and malformed 3D directions", () => {
  const engine = playingEngine();
  assert.equal(engine.setDirection(0, 0, 1), false, "down-depth is opposite of up-depth");
  assert.equal(engine.setDirection(0, 0, -1), false, "duplicate of current direction");
  assert.equal(engine.setDirection(-1, 0, 0), true);
  assert.equal(engine.setDirection(1, 0, 0), false, "opposite of queued left");
  assert.equal(engine.setDirection(0, 1, 0), true);
  assert.equal(engine.setDirection(0, 0, 0), false);
  assert.equal(engine.setDirection(1, 1, 0), false);
});

test("moves one cell per step in 3D", () => {
  const engine = playingEngine();
  const head = { ...engine.head };
  const event = engine.step();
  assert.equal(event.type, "move");
  assert.deepEqual(engine.head, { x: head.x, y: head.y, z: head.z - 1 });
  assert.equal(engine.length, 4);
});

test("can move vertically through the volume", () => {
  const engine = playingEngine();
  engine.direction = { x: 0, y: 1, z: 0 };
  engine.turnQueue = [];
  const event = engine.step();
  assert.equal(event.type, "move");
  assert.equal(engine.head.y, 7);
});

test("eating grows the snake, scores a combo and respawns 3D food", () => {
  const engine = playingEngine();
  engine.food = { x: engine.head.x, y: engine.head.y, z: engine.head.z - 1 };
  const first = engine.step();
  assert.equal(first.type, "eat");
  assert.equal(first.gained, 10);
  assert.equal(engine.length, 5);
  assert.equal(engine.score, 10);
  assert.equal(engine.combo, 1);
  assert.equal(engine.comboTimer, COMBO_WINDOW);
  assert.equal(engine.food.y >= 0 && engine.food.y < 13, true);

  engine.food = { x: engine.head.x, y: engine.head.y, z: engine.head.z - 1 };
  const second = engine.step();
  assert.equal(second.type, "eat");
  assert.equal(second.combo, 2);
  assert.equal(second.gained, 20);
  assert.equal(engine.score, 30);
  assert.equal(engine.length, 6);
});

test("combo expires after the window", () => {
  const engine = playingEngine();
  engine.food = { x: engine.head.x, y: engine.head.y, z: engine.head.z - 1 };
  engine.step();
  engine.update(COMBO_WINDOW + 10);
  assert.equal(engine.combo, 1);
  assert.equal(engine.comboTimer, 0);
});

test("speed increases as food is eaten", () => {
  const engine = playingEngine();
  const initial = engine.tickMs;
  for (let i = 0; i < 4; i += 1) {
    engine.snake = [
      { x: 4, y: 4, z: 4 },
      { x: 4, y: 4, z: 5 },
      { x: 4, y: 4, z: 6 },
      { x: 4, y: 4, z: 7 },
      { x: 4, y: 4, z: 8 },
    ];
    engine.prevSnake = engine.snake.map((cell) => ({ ...cell }));
    engine.direction = { x: 0, y: 0, z: -1 };
    engine.food = { x: 4, y: 4, z: 3 };
    engine.step();
  }
  assert.ok(engine.tickMs < initial, "tick duration should decrease");
  assert.equal(engine.eaten, 4);
});

test("every face wraps to the opposite side", () => {
  const horizontal = playingEngine();
  setSnake(horizontal, [
    { x: 0, y: 4, z: 4 },
    { x: 1, y: 4, z: 4 },
    { x: 2, y: 4, z: 4 },
    { x: 3, y: 4, z: 4 },
  ], { x: -1, y: 0, z: 0 });
  const hx = horizontal.step();
  assert.equal(hx.type, "move");
  assert.equal(horizontal.head.x, 12);
  assert.equal(horizontal.phase, "playing");
  assert.deepEqual(hx.wrap.axes, ["x"]);

  const vertical = playingEngine();
  setSnake(vertical, [
    { x: 4, y: 12, z: 4 },
    { x: 4, y: 11, z: 4 },
    { x: 4, y: 10, z: 4 },
    { x: 4, y: 9, z: 4 },
  ], { x: 0, y: 1, z: 0 });
  const vy = vertical.step();
  assert.equal(vy.type, "move");
  assert.equal(vertical.head.y, 0);
  assert.equal(vertical.phase, "playing");

  const depth = playingEngine();
  setSnake(depth, [
    { x: 4, y: 4, z: 0 },
    { x: 4, y: 4, z: 1 },
    { x: 4, y: 4, z: 2 },
    { x: 4, y: 4, z: 3 },
  ], { x: 0, y: 0, z: -1 });
  const dz = depth.step();
  assert.equal(dz.type, "move");
  assert.equal(depth.head.z, 12);
  assert.equal(depth.phase, "playing");
});

test("the stationary starting snake can pivot toward the first control", () => {
  const engine = playingEngine();
  assert.equal(engine.orient(0, 1, 0), true);
  assert.deepEqual(engine.direction, { x: 0, y: 1, z: 0 });
  assert.equal(engine.snake[0].y, 6);
  assert.ok(engine.snake.every((cell) => cell.x === 6 && cell.z === 6));
  assert.deepEqual(engine.snake[1], { x: 6, y: 5, z: 6 });
  const event = engine.step();
  assert.equal(event.type, "move");
  assert.equal(engine.head.y, 7);
});

test("self collision works in 3D", () => {
  const engine = playingEngine();
  setSnake(
    engine,
    [
      { x: 4, y: 4, z: 4 },
      { x: 4, y: 5, z: 4 },
      { x: 5, y: 5, z: 4 },
      { x: 5, y: 4, z: 4 },
    ],
    { x: 0, y: 1, z: 0 }
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
      { x: 4, y: 4, z: 4 },
      { x: 4, y: 5, z: 4 },
      { x: 5, y: 5, z: 4 },
      { x: 5, y: 4, z: 4 },
    ],
    { x: 1, y: 0, z: 0 }
  );
  const event = engine.step();
  assert.equal(event.type, "move");
  assert.deepEqual(engine.head, { x: 5, y: 4, z: 4 });
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

test("full 3D board reports no free food cell", () => {
  const engine = new SnakeEngine({ grid: 5 });
  engine.snake = [];
  for (let z = 0; z < 5; z += 1) {
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) engine.snake.push({ x, y, z });
    }
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
