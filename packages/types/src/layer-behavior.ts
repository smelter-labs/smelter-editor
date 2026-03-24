import type {
  LayerBehaviorConfig,
  BehaviorInputInfo,
  LayerInput,
  EqualGridConfig,
  PictureInPictureConfig,
  PreserveApproximateAspectGridConfig,
  PreserveExactAspectGridConfig,
} from './layout.js';

export type ComputeLayoutResult = {
  inputs: LayerInput[];
};

type Resolution = { width: number; height: number };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the full layout for all inputs in a layer with the given behavior.
 * Pure function — no side effects, works on server/mobile/web.
 */
export function computeLayout(
  config: LayerBehaviorConfig,
  inputs: BehaviorInputInfo[],
  resolution: Resolution,
): ComputeLayoutResult {
  switch (config.type) {
    case 'equal-grid':
      return computeEqualGrid(config, inputs, resolution);
    case 'picture-in-picture':
      return computePictureInPicture(config, inputs, resolution);
    case 'approximate-aspect-grid':
      return computeApproximateAspectGrid(config, inputs, resolution);
    case 'exact-aspect-grid':
      return computeExactAspectGrid(config, inputs, resolution);
  }
}

/**
 * Compute the layout after adding a new input, given the current state.
 * Returns the full updated inputs array (existing + new).
 */
export function computeAddInput(
  config: LayerBehaviorConfig,
  _existingLayout: LayerInput[],
  newInput: BehaviorInputInfo,
  allInputs: BehaviorInputInfo[],
  resolution: Resolution,
): ComputeLayoutResult {
  // For all current behaviors, we just recompute the full layout
  // including the new input. More sophisticated behaviors could
  // optimize by only placing the new input.
  const allWithNew = allInputs.find((i) => i.inputId === newInput.inputId)
    ? allInputs
    : [...allInputs, newInput];
  return computeLayout(config, allWithNew, resolution);
}

// ── Equal Grid ───────────────────────────────────────────────────────────────

function computeEqualGrid(
  config: EqualGridConfig,
  inputs: BehaviorInputInfo[],
  resolution: Resolution,
): ComputeLayoutResult {
  const count = inputs.length;
  if (count === 0) return { inputs: [] };

  const hSpacing = config.horizontalSpacing ?? 0;
  const vSpacing = config.verticalSpacing ?? 0;

  let cols: number;
  let rows: number;

  if (config.autoscale === false && config.cols && config.rows) {
    cols = config.cols;
    rows = config.rows;
  } else {
    cols = Math.ceil(Math.sqrt(count));
    rows = Math.ceil(count / cols);
  }

  const totalHSpacing = hSpacing * (cols - 1);
  const totalVSpacing = vSpacing * (rows - 1);
  const cellW = Math.floor((resolution.width - totalHSpacing) / cols);
  const cellH = Math.floor((resolution.height - totalVSpacing) / rows);

  return {
    inputs: inputs.map((input, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        inputId: input.inputId,
        x: col * (cellW + hSpacing),
        y: row * (cellH + vSpacing),
        width: cellW,
        height: cellH,
      };
    }),
  };
}

// ── Picture in Picture ───────────────────────────────────────────────────────

function computePictureInPicture(
  config: PictureInPictureConfig,
  inputs: BehaviorInputInfo[],
  resolution: Resolution,
): ComputeLayoutResult {
  const count = inputs.length;
  if (count === 0) return { inputs: [] };

  const hSpacing = config.horizontalSpacing ?? 0;
  const vSpacing = config.verticalSpacing ?? 0;

  // First input is the big picture (full area)
  const bigInput: LayerInput = {
    inputId: inputs[0].inputId,
    x: 0,
    y: 0,
    width: resolution.width,
    height: resolution.height,
  };

  if (count === 1) return { inputs: [bigInput] };

  // Remaining inputs in a small grid in the bottom-right corner
  const smallInputs = inputs.slice(1);
  const smallCount = smallInputs.length;
  const smallCols = Math.ceil(Math.sqrt(smallCount));
  const smallRows = Math.ceil(smallCount / smallCols);

  // Small grid takes ~25% of the area (sqrt(0.25) ≈ 0.5 of each dimension)
  const gridW = Math.floor(resolution.width * 0.4);
  const gridH = Math.floor(resolution.height * 0.4);
  const gridX = resolution.width - gridW - hSpacing;
  const gridY = resolution.height - gridH - vSpacing;

  const smallHSpacing = smallCount > 1 ? hSpacing : 0;
  const smallVSpacing = smallCount > 1 ? vSpacing : 0;
  const totalSmallHSpacing = smallHSpacing * (smallCols - 1);
  const totalSmallVSpacing = smallVSpacing * (smallRows - 1);
  const smallCellW = Math.floor(
    (gridW - totalSmallHSpacing) / smallCols,
  );
  const smallCellH = Math.floor(
    (gridH - totalSmallVSpacing) / smallRows,
  );

  const smallLayerInputs: LayerInput[] = smallInputs.map((input, i) => {
    const col = i % smallCols;
    const row = Math.floor(i / smallCols);
    return {
      inputId: input.inputId,
      x: gridX + col * (smallCellW + smallHSpacing),
      y: gridY + row * (smallCellH + smallVSpacing),
      width: smallCellW,
      height: smallCellH,
    };
  });

  return { inputs: [bigInput, ...smallLayerInputs] };
}

// ── Approximate Aspect Grid ──────────────────────────────────────────────────

function computeApproximateAspectGrid(
  config: PreserveApproximateAspectGridConfig,
  inputs: BehaviorInputInfo[],
  resolution: Resolution,
): ComputeLayoutResult {
  const count = inputs.length;
  if (count === 0) return { inputs: [] };

  const hSpacing = config.horizontalSpacing ?? 0;
  const vSpacing = config.verticalSpacing ?? 0;

  // Determine a base grid unit size. We use a fine grid (e.g. 12 columns)
  // so that tiles can be multiples of the base unit.
  const baseCols = 12;
  const baseUnitW = resolution.width / baseCols;

  // Classify inputs and assign grid-unit sizes
  type TileInfo = {
    inputId: string;
    gridW: number; // in base units
    gridH: number; // in base units
  };

  const tiles: TileInfo[] = inputs.map((input) => {
    const ar = getAspectRatio(input);
    if (ar < 1) {
      // Vertical: taller tile (e.g. 3 units wide, height based on aspect ratio)
      const gridW = 3;
      // Round height to nearest base unit, minimum 1
      const rawH = gridW / ar;
      const gridH = Math.max(1, Math.round(rawH));
      return { inputId: input.inputId, gridW, gridH };
    } else {
      // Horizontal or square: wider tile (e.g. 4 units wide)
      const gridW = 4;
      const rawH = gridW / ar;
      const gridH = Math.max(1, Math.round(rawH));
      return { inputId: input.inputId, gridW, gridH };
    }
  });

  // Place tiles using a simple row-packing algorithm
  // Track the top of each column (next free y-position in base units)
  const colTops = new Array(baseCols).fill(0);

  const result: LayerInput[] = tiles.map((tile) => {
    // Find the column position where this tile fits with the lowest y
    let bestCol = 0;
    let bestY = Infinity;

    for (let c = 0; c <= baseCols - tile.gridW; c++) {
      // The y position for placing at column c is the max of colTops in [c, c+gridW)
      let maxTop = 0;
      for (let cc = c; cc < c + tile.gridW; cc++) {
        maxTop = Math.max(maxTop, colTops[cc]);
      }
      if (maxTop < bestY) {
        bestY = maxTop;
        bestCol = c;
      }
    }

    // Place the tile
    const x = Math.round(bestCol * baseUnitW + bestCol * hSpacing);
    const y = Math.round(bestY * baseUnitW + bestY * vSpacing);
    const w = Math.round(tile.gridW * baseUnitW);
    const h = Math.round(tile.gridH * baseUnitW);

    // Update column tops
    for (let cc = bestCol; cc < bestCol + tile.gridW; cc++) {
      colTops[cc] = bestY + tile.gridH;
    }

    return {
      inputId: tile.inputId,
      x: Math.min(x, resolution.width - 1),
      y: Math.min(y, resolution.height - 1),
      width: Math.min(w, resolution.width - x),
      height: Math.min(h, resolution.height - y),
    };
  });

  return { inputs: result };
}

// ── Exact Aspect Grid ────────────────────────────────────────────────────────

function computeExactAspectGrid(
  config: PreserveExactAspectGridConfig,
  inputs: BehaviorInputInfo[],
  resolution: Resolution,
): ComputeLayoutResult {
  const count = inputs.length;
  if (count === 0) return { inputs: [] };

  const hSpacing = config.horizontalSpacing ?? 0;
  const vSpacing = config.verticalSpacing ?? 0;

  // Each input is displayed at its native aspect ratio, scaled to fit
  // within a cell of an equal grid. The cell determines available space,
  // and we scale the input to fit within that space preserving aspect ratio.
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const totalHSpacing = hSpacing * (cols - 1);
  const totalVSpacing = vSpacing * (rows - 1);
  const cellW = Math.floor((resolution.width - totalHSpacing) / cols);
  const cellH = Math.floor((resolution.height - totalVSpacing) / rows);

  const result: LayerInput[] = inputs.map((input, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * (cellW + hSpacing);
    const cellY = row * (cellH + vSpacing);

    const ar = getAspectRatio(input);

    // Scale to fit within cell (contain behavior)
    let w: number;
    let h: number;
    if (ar >= cellW / cellH) {
      // Width-constrained
      w = cellW;
      h = Math.round(cellW / ar);
    } else {
      // Height-constrained
      h = cellH;
      w = Math.round(cellH * ar);
    }

    // Center within cell
    const x = cellX + Math.floor((cellW - w) / 2);
    const y = cellY + Math.floor((cellH - h) / 2);

    return { inputId: input.inputId, x, y, width: w, height: h };
  });

  return { inputs: resolveCollisions(result, resolution) };
}

// ── Collision Resolution ─────────────────────────────────────────────────────

/**
 * Simple collision resolution: if two items overlap, push the later one down.
 * Simplified version of the BFS algorithm from mobile's ReshufflableGridWrapper.
 */
function resolveCollisions(
  items: LayerInput[],
  resolution: Resolution,
): LayerInput[] {
  const result = items.map((item) => ({ ...item }));
  const maxIterations = 500;
  let iterations = 0;

  for (let i = 0; i < result.length && iterations < maxIterations; i++) {
    for (let j = i + 1; j < result.length && iterations < maxIterations; j++) {
      iterations++;
      if (overlaps(result[i], result[j])) {
        // Push j below i
        result[j].y = result[i].y + result[i].height;
        // If pushed out of bounds, clamp
        if (result[j].y + result[j].height > resolution.height) {
          result[j].y = resolution.height - result[j].height;
        }
      }
    }
  }

  return result;
}

function overlaps(a: LayerInput, b: LayerInput): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAspectRatio(input: BehaviorInputInfo): number {
  const w = input.nativeWidth ?? 1920;
  const h = input.nativeHeight ?? 1080;
  return w / h;
}
