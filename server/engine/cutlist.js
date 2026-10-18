// Deterministic cut-list packing: how many boards of a given stock size are needed
// to cut a set of rectangular pieces. First-fit-decreasing on board length with a
// saw kerf allowance. Pieces narrower than the board are assumed ripped to width.

export const KERF_MM = 3;
export const END_TRIM_MM = 10; // trim allowance at the start of each board

/**
 * @param pieces [{id, name, length, width, qty}] in mm
 * @param stock  {length, width, thickness} in mm
 * @returns {boardsNeeded, layout:[{board, cuts:[{id,name,length,width,offset}]}], warnings, utilisationPct}
 */
export function packCuts(pieces, stock) {
  const warnings = [];
  const list = [];
  for (const p of pieces) {
    for (let i = 0; i < p.qty; i++) list.push({ ...p });
  }
  list.sort((a, b) => b.length - a.length);
  const usable = stock.length - END_TRIM_MM;
  const boards = [];
  for (const piece of list) {
    if (piece.width > stock.width + 0.5) {
      warnings.push(`${piece.name} needs ${piece.width} mm width but the board is only ${stock.width} mm wide — edge-glue two strips or choose wider stock.`);
    }
    if (piece.length > usable) {
      warnings.push(`${piece.name} (${piece.length} mm) is longer than the usable board length (${usable} mm).`);
      continue;
    }
    let placed = false;
    for (const b of boards) {
      if (b.used + piece.length + KERF_MM <= usable) {
        b.cuts.push({ ...piece, offset: b.used });
        b.used += piece.length + KERF_MM;
        placed = true;
        break;
      }
    }
    if (!placed) boards.push({ used: piece.length + KERF_MM, cuts: [{ ...piece, offset: 0 }] });
  }
  const totalPieceLen = list.reduce((s, p) => s + p.length, 0);
  return {
    boardsNeeded: boards.length,
    layout: boards.map((b, i) => ({ board: i + 1, cuts: b.cuts.map(({ id, name, length, width, offset }) => ({ id, name, length, width, offset: offset + END_TRIM_MM })) })),
    warnings: [...new Set(warnings)],
    utilisationPct: boards.length ? Math.round((totalPieceLen / (boards.length * stock.length)) * 100) : 0,
  };
}
