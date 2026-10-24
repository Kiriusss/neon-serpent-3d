/**
 * NEON SERPENT — deterministic 3D snake engine.
 * Pure logic, no DOM, no rendering. Coordinates are (x, y, z) cells.
 */

export const GRID_SIZE = 9;
export const CELL_SIZE = 1;

export const DIFFICULTIES = Object.freeze({
  relaxed: Object.freeze({
    key: "relaxed",
    label: "轻松",
    baseTick: 196,
    minTick: 104,
    accel: 1.65,
    pace: "慢一点，先熟悉立体节奏",
  }),
  classic: Object.freeze({
    key: "classic",
    label: "经典",
    baseTick: 154,
    minTick: 74,
    accel: 2.55,
    pace: "刚刚好的立体挑战",
  }),
  frenzy: Object.freeze({
    key: "frenzy",
    label: "极速",
    baseTick: 116,
    minTick: 58,
    accel: 1.75,
    pace: "给三维反应一点压力",
  }),
});

export const COMBO_WINDOW = 3200;
export const MAX_COMBO = 5;
export const START_LENGTH = 4;

function copyCell(cell) {
  return cell ? { x: cell.x, y: cell.y, z: cell.z } : null;
}

function copySnake(snake) {
  return snake.map(copyCell);
}

function cellsEqual(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y && a.z === b.z);
}

const cellKey = (cell, grid) => (cell.z * grid + cell.y) * grid + cell.x;

/**
 * The rules of the 3D arena.
 * The snake stores its head first and moves one unit along x, y or z per tick.
 */
export class SnakeEngine {
  constructor({ grid = GRID_SIZE, difficulty = "classic", rng = Math.random } = {}) {
    if (!Number.isInteger(grid) || grid < 5) {
      throw new RangeError("grid must be an integer >= 5");
    }

    this.grid = grid;
    this.rng = rng;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : "classic";
    this.reset();
  }

  /* ------------------------------------------------------------
     Lifecycle
     ------------------------------------------------------------ */

  reset() {
    const center = Math.floor(this.grid / 2);
    this.snake = [
      { x: center, y: center, z: center },
      { x: center, y: center, z: center + 1 },
      { x: center, y: center, z: center + 2 },
      { x: center, y: center, z: center + 3 },
    ];
    this.prevSnake = copySnake(this.snake);
    this.direction = { x: 0, y: 0, z: -1 };
    this.turnQueue = [];
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.eaten = 0;
    this.steps = 0;
    this.tickMs = this.config.baseTick;
    this.phase = "menu";
    this.deathCause = null;
    this.lastEvent = null;
    this.food = null;
    this.spawnFood();
    return this;
  }

  start() {
    this.reset();
    this.phase = "playing";
    this.lastEvent = { type: "start" };
    return this;
  }

  pause() {
    if (this.phase !== "playing") return false;
    this.phase = "paused";
    return true;
  }

  resume() {
    if (this.phase !== "paused") return false;
    this.phase = "playing";
    return true;
  }

  get config() {
    return DIFFICULTIES[this.difficulty];
  }

  setDifficulty(key) {
    if (!DIFFICULTIES[key]) return false;
    this.difficulty = key;
    if (this.phase !== "playing" && this.phase !== "paused") {
      this.reset();
    } else {
      this.tickMs = Math.max(
        this.config.minTick,
        this.config.baseTick - this.eaten * this.config.accel
      );
    }
    return true;
  }

  /* ------------------------------------------------------------
     Input & simulation
     ------------------------------------------------------------ */

  setDirection(x, y, z) {
    if (this.phase !== "playing" && this.phase !== "paused") return false;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return false;
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) !== 1) return false;
    if (this.turnQueue.length >= 2) return false;

    const previous = this.turnQueue.length
      ? this.turnQueue[this.turnQueue.length - 1]
      : this.direction;

    // No 180° turns, no duplicate turns.
    if (x === -previous.x && y === -previous.y && z === -previous.z) return false;
    if (x === previous.x && y === previous.y && z === previous.z) return false;

    this.turnQueue.push({ x, y, z });
    return true;
  }

  update(dt) {
    if (this.phase !== "playing") return;
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) this.combo = 1;
    }
  }

  step() {
    if (this.phase !== "playing") return null;

    if (this.turnQueue.length) {
      const next = this.turnQueue.shift();
      if (
        !(next.x === -this.direction.x && next.y === -this.direction.y && next.z === -this.direction.z)
      ) {
        this.direction = next;
      }
    }

    const head = this.snake[0];
    const nextHead = {
      x: head.x + this.direction.x,
      y: head.y + this.direction.y,
      z: head.z + this.direction.z,
    };
    const oldSnake = copySnake(this.snake);
    this.prevSnake = oldSnake;

    // The arena is a closed cube.
    if (
      nextHead.x < 0 ||
      nextHead.y < 0 ||
      nextHead.z < 0 ||
      nextHead.x >= this.grid ||
      nextHead.y >= this.grid ||
      nextHead.z >= this.grid
    ) {
      return this.endGame("wall", oldSnake);
    }

    const willEat = cellsEqual(nextHead, this.food);
    // The tail vacates its cell on this step unless the snake is growing.
    const body = willEat ? this.snake : this.snake.slice(0, this.snake.length - 1);
    if (body.some((cell) => cellsEqual(cell, nextHead))) {
      return this.endGame("self", oldSnake);
    }

    this.snake = [nextHead, ...oldSnake];
    this.steps += 1;

    if (!willEat) {
      this.snake.pop();
      this.lastEvent = { type: "move", cell: nextHead };
      return this.lastEvent;
    }

    // --- Eat ---------------------------------------------------
    const eatenFood = copyCell(this.food);
    this.combo = this.comboTimer > 0 ? Math.min(MAX_COMBO, this.combo + 1) : 1;
    const gained = 10 * this.combo;
    this.score += gained;
    this.eaten += 1;
    this.comboTimer = COMBO_WINDOW;
    this.tickMs = Math.max(
      this.config.minTick,
      this.config.baseTick - this.eaten * this.config.accel
    );

    const nextFood = this.spawnFood();
    if (!nextFood) {
      this.phase = "won";
      this.lastEvent = {
        type: "win",
        cell: nextHead,
        gained,
        combo: this.combo,
        eatenFood,
        score: this.score,
      };
      return this.lastEvent;
    }

    this.lastEvent = {
      type: "eat",
      cell: nextHead,
      gained,
      combo: this.combo,
      eatenFood,
      food: nextFood,
      score: this.score,
      tickMs: this.tickMs,
    };
    return this.lastEvent;
  }

  endGame(cause, oldSnake = copySnake(this.snake)) {
    this.prevSnake = oldSnake;
    this.phase = "dead";
    this.deathCause = cause;
    this.lastEvent = {
      type: "death",
      cause,
      cell: copyCell(oldSnake[0]),
      score: this.score,
      length: oldSnake.length,
    };
    return this.lastEvent;
  }

  /* ------------------------------------------------------------
     Food
     ------------------------------------------------------------ */

  spawnFood() {
    const occupied = new Set(this.snake.map((cell) => cellKey(cell, this.grid)));
    const open = [];
    for (let z = 0; z < this.grid; z += 1) {
      for (let y = 0; y < this.grid; y += 1) {
        for (let x = 0; x < this.grid; x += 1) {
          const cell = { x, y, z };
          if (!occupied.has(cellKey(cell, this.grid))) open.push(cell);
        }
      }
    }
    if (!open.length) {
      this.food = null;
      return null;
    }

    const cell = open[Math.floor(this.rng() * open.length)] || open[open.length - 1];
    this.food = { x: cell.x, y: cell.y, z: cell.z };
    return this.food;
  }

  /* ------------------------------------------------------------
     Helpers
     ------------------------------------------------------------ */

  get head() {
    return this.snake[0];
  }

  get length() {
    return this.snake.length;
  }

  get speedMultiplier() {
    return this.config.baseTick / this.tickMs;
  }

  get comboProgress() {
    return this.combo > 1 ? Math.max(0, Math.min(1, this.comboTimer / COMBO_WINDOW)) : 0;
  }

  getState() {
    return {
      grid: this.grid,
      phase: this.phase,
      difficulty: this.difficulty,
      snake: copySnake(this.snake),
      prevSnake: copySnake(this.prevSnake),
      direction: { ...this.direction },
      food: copyCell(this.food),
      score: this.score,
      combo: this.combo,
      comboTimer: this.comboTimer,
      eaten: this.eaten,
      length: this.snake.length,
      steps: this.steps,
      tickMs: this.tickMs,
      speedMultiplier: this.speedMultiplier,
      deathCause: this.deathCause,
      lastEvent: this.lastEvent,
    };
  }
}

export const __test__ = { cellsEqual, copySnake, cellKey };
