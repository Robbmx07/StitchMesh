export type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 1e-300 ? scale(a, 1 / n) : a;
}
function centroid(pts: Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const p of pts) c = add(c, p);
  return scale(c, 1 / pts.length);
}

type Mat3 = [Vec3, Vec3, Vec3];

function matMulVec(M: Mat3, v: Vec3): Vec3 {
  return [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
}
function transpose(M: Mat3): Mat3 {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]],
  ];
}
function matMul(A: Mat3, B: Mat3): Mat3 {
  const Bt = transpose(B);
  const R: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i][j] = dot(A[i], Bt[j]);
  return R;
}
function matDet(M: Mat3): number {
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  );
}

/**
 * Jacobi eigenvalue algorithm for a symmetric 3x3 matrix. Returns
 * eigenvalues plus eigenvectors as the COLUMNS of `vectors` (so eigenvector
 * k is [vectors[0][k], vectors[1][k], vectors[2][k]]).
 */
function jacobiEigen3(Ain: Mat3, maxSweeps = 100, tol = 1e-14): { values: [number, number, number]; vectors: Mat3 } {
  const n = 3;
  const A: number[][] = Ain.map((row) => row.slice());
  const V: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < tol) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const App = A[p][p];
        const Aqq = A[q][q];
        const Apq = A[p][q];
        A[p][p] = App - t * Apq;
        A[q][q] = Aqq + t * Apq;
        A[p][q] = 0;
        A[q][p] = 0;
        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const Aip = A[i][p];
            const Aiq = A[i][q];
            A[i][p] = A[p][i] = c * Aip - s * Aiq;
            A[i][q] = A[q][i] = s * Aip + c * Aiq;
          }
        }
        for (let i = 0; i < n; i++) {
          const Vip = V[i][p];
          const Viq = V[i][q];
          V[i][p] = c * Vip - s * Viq;
          V[i][q] = s * Vip + c * Viq;
        }
      }
    }
  }
  const values: [number, number, number] = [A[0][0], A[1][1], A[2][2]];
  return { values, vectors: V as Mat3 };
}

export interface RigidFitResult {
  /** Row-major 3x3 rotation matrix. */
  rotation: Mat3;
  translation: Vec3;
}

/**
 * Optimal rotation + translation mapping point set B onto point set A in
 * the least-squares sense (Kabsch algorithm) — minimizes
 * sum |R*B_i + t - A_i|^2 over all matched pairs. Requires 3+ pairs.
 *
 * Coplanar input (e.g. 3+ points picked on a single flat mating face) is
 * the ordinary case, not degenerate — any 3 points are trivially coplanar
 * — so this only requires the points span a plane (rank >= 2). Only
 * collinear input (rank <= 1, a genuinely unconstrained rotation about
 * that line) is rejected, returning null rather than a guess.
 */
export function kabschFit(pointsA: Vec3[], pointsB: Vec3[]): RigidFitResult | null {
  if (pointsA.length !== pointsB.length || pointsA.length < 3) return null;
  const cA = centroid(pointsA);
  const cB = centroid(pointsB);
  const A = pointsA.map((p) => sub(p, cA));
  const B = pointsB.map((p) => sub(p, cB));

  // Cross-covariance H = sum(B_i * A_i^T), so R (solving R*B ~ A) = V*U^T from SVD(H) = U S V^T.
  const H: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < A.length; k++) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[i][j] += B[k][i] * A[k][j];
  }

  const HtH = matMul(transpose(H), H);
  const { values, vectors: V } = jacobiEigen3(HtH);
  const order: [number, number, number] = [0, 1, 2].sort((a, b) => values[b] - values[a]) as [number, number, number];
  const Vcols: Vec3[] = order.map((k) => [V[0][k], V[1][k], V[2][k]]);
  const singVals = order.map((k) => Math.sqrt(Math.max(values[k], 0)));

  // Rank >= 2 required (non-collinear points) — rank <= 1 leaves at least
  // one rotational degree of freedom completely unconstrained by the data.
  const EPS = 1e-7;
  if (singVals[1] < EPS * Math.max(1, singVals[0])) return null;

  // Build U's first two columns from the two well-determined singular
  // directions and complete both bases with a cross product, rather than
  // trusting the (often ~0, possibly numerically noisy) 3rd singular
  // vector — this is what correctly handles coplanar input.
  const Ucols: Vec3[] = [0, 1].map((i) => normalize(matMulVec(H, Vcols[i])));
  Ucols.push(cross(Ucols[0], Ucols[1]));
  Vcols[2] = cross(Vcols[0], Vcols[1]);

  const Umat = transpose(Ucols as Mat3);
  const Vmat = transpose(Vcols as Mat3);
  let R = matMul(Vmat, transpose(Umat));

  if (matDet(R) < 0) {
    // Reflection fix: flip the completed (cross-product) column — the one
    // degree of freedom a mirrored best fit affects.
    Ucols[2] = scale(Ucols[2], -1);
    R = matMul(Vmat, transpose(transpose(Ucols as Mat3)));
  }

  const t = sub(cA, matMulVec(R, cB));
  return { rotation: R, translation: t };
}
