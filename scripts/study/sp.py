"""Stringer-panel stiffness model of a wood diaphragm (reference for the G4 study, not part of the tool).

Panels carry one uniform shear flow q = Gt * gamma; stringers (chords, struts, collectors, and auxiliary lines in the
sheathing) carry axial force varying linearly. Stringer element DOFs: end displacements u_i, u_j along its axis and
its mean displacement ubar (Blaauwendraad / Hoogenboom): K = EA/L [[4,2,-6],[2,4,-6],[-6,-6,12]]. Panel DOFs: the
mean displacements of its four edge stringers; gamma = (ubar_top - ubar_bot)/h + (vbar_right - vbar_left)/b.
Units: lb, ft. Gt = 12000 * Ga (Ga in kips/in, SDPWS). Tension +.
"""
import numpy as np

EPS = 1e-6


def point_in_poly(x, y, pts):
    ins = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ins = not ins
    return ins


class Model:
    def __init__(self, outline, openings=(), h=2.5, extra_x=(), extra_y=(), member_x=(), member_y=(),
                 Ga=20.0, EA_chord=1.68e7, EA_member=None, EA_aux=1e4, EA_aux_x=None, EA_aux_y=None, member_segs=None):
        self.outline, self.openings = outline, list(openings)
        self.Gt = 12000.0 * Ga
        self.EA_chord, self.EA_member = EA_chord, EA_member or EA_chord
        # auxiliary (sheathing-only) lines: horizontal (along x) and vertical (along y) stiffness
        self.EA_aux_x = EA_aux if EA_aux_x is None else EA_aux_x
        self.EA_aux_y = EA_aux if EA_aux_y is None else EA_aux_y
        xs = {p[0] for p in outline} | set(extra_x) | set(member_x)
        ys = {p[1] for p in outline} | set(extra_y) | set(member_y)
        for o in self.openings:
            xs |= {o[0], o[1]}; ys |= {o[2], o[3]}
        self.member_x, self.member_y = set(member_x), set(member_y)
        # members by segment: [('x', y, x0, x1) horizontal, ('y', x, y0, y1) vertical]; None = whole grid lines
        self.member_segs = member_segs
        for ax_, c, a, b in (member_segs or []):
            (ys if ax_ == 'x' else xs).add(c); (xs if ax_ == 'x' else ys).update((a, b))
        self.X = self._sub(sorted(xs), h); self.Y = self._sub(sorted(ys), h)
        self.load = {}
        self.fix = set()

    @staticmethod
    def _sub(c, h):
        out = [c[0]]
        for a, b in zip(c[:-1], c[1:]):
            n = max(1, int(np.ceil((b - a) / h - 1e-9)))
            out += [a + (b - a) * k / n for k in range(1, n + 1)]
        return out

    def sheathed(self, x, y):
        return point_in_poly(x, y, self.outline) and not any(o[0] < x < o[1] and o[2] < y < o[3] for o in self.openings)

    def _on_edge(self, axis, c, a, b):
        """segment (axis 'x' = horizontal at y=c from x=a..b) lies on the outline or an opening edge"""
        mid = (a + b) / 2
        pts = self.outline
        for i in range(len(pts)):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
            if axis == 'x' and abs(y1 - y2) < EPS and abs(y1 - c) < EPS and min(x1, x2) - EPS <= mid <= max(x1, x2) + EPS: return True
            if axis == 'y' and abs(x1 - x2) < EPS and abs(x1 - c) < EPS and min(y1, y2) - EPS <= mid <= max(y1, y2) + EPS: return True
        for o in self.openings:
            if axis == 'x' and any(abs(c - yy) < EPS for yy in (o[2], o[3])) and o[0] - EPS <= mid <= o[1] + EPS: return True
            if axis == 'y' and any(abs(c - xx) < EPS for xx in (o[0], o[1])) and o[2] - EPS <= mid <= o[3] + EPS: return True
        return False

    def _is_member(self, axis, c, a, b):
        mid = (a + b) / 2
        if self.member_segs is None:
            return any(abs(c - m) < EPS for m in (self.member_y if axis == 'x' else self.member_x))
        return any(ax_ == axis and abs(c - cc) < EPS and min(a0, b0) - EPS <= mid <= max(a0, b0) + EPS for ax_, cc, a0, b0 in self.member_segs)

    def build(self):
        X, Y = self.X, self.Y
        nx, ny = len(X), len(Y)
        self.cells = {}
        for i in range(nx - 1):
            for j in range(ny - 1):
                if self.sheathed((X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2):
                    self.cells[(i, j)] = True
        dof = {}
        def D(key):
            if key not in dof: dof[key] = len(dof)
            return dof[key]
        self.hs, self.vs = {}, {}  # stringer segments: (i, j) -> EA
        for i in range(nx - 1):
            for j in range(ny):
                if (i, j) in self.cells or (i, j - 1) in self.cells:
                    y = Y[j]
                    EA = self.EA_chord if self._on_edge('x', y, X[i], X[i + 1]) else self.EA_member if self._is_member('x', y, X[i], X[i + 1]) else self.EA_aux_x
                    self.hs[(i, j)] = EA
        for i in range(nx):
            for j in range(ny - 1):
                if (i, j) in self.cells or (i - 1, j) in self.cells:
                    x = X[i]
                    EA = self.EA_chord if self._on_edge('y', x, Y[j], Y[j + 1]) else self.EA_member if self._is_member('y', x, Y[j], Y[j + 1]) else self.EA_aux_y
                    self.vs[(i, j)] = EA
        trip = []
        for (i, j), EA in self.hs.items():
            L = X[i + 1] - X[i]
            d = [D(('u', i, j)), D(('u', i + 1, j)), D(('hb', i, j))]
            k = EA / L * np.array([[4, 2, -6], [2, 4, -6], [-6, -6, 12]])
            trip.append((d, k))
        for (i, j), EA in self.vs.items():
            L = Y[j + 1] - Y[j]
            d = [D(('v', i, j)), D(('v', i, j + 1)), D(('vb', i, j))]
            k = EA / L * np.array([[4, 2, -6], [2, 4, -6], [-6, -6, 12]])
            trip.append((d, k))
        for (i, j) in self.cells:
            b, h = X[i + 1] - X[i], Y[j + 1] - Y[j]
            d = [D(('hb', i, j)), D(('hb', i, j + 1)), D(('vb', i, j)), D(('vb', i + 1, j))]
            B = np.array([-1 / h, 1 / h, -1 / b, 1 / b])
            trip.append((d, self.Gt * b * h * np.outer(B, B)))
        n = len(dof)
        K = np.zeros((n, n))
        for d, k in trip:
            K[np.ix_(d, d)] += k
        self.K, self.dof, self.n = K, dof, n

    def ix(self, x):
        return min(range(len(self.X)), key=lambda i: abs(self.X[i] - x))

    def iy(self, y):
        return min(range(len(self.Y)), key=lambda j: abs(self.Y[j] - y))

    # loads -------------------------------------------------------------------------------------------------
    def line_load_y(self, y, x0, x1, w):
        """line load w (lb/ft, + = +y) along the edge y over x0..x1, lumped to the v DOF of the nodes"""
        j = self.iy(y)
        for i in range(len(self.X) - 1):
            a, b = max(self.X[i], x0), min(self.X[i + 1], x1)
            if b - a > EPS:
                for ii in (i, i + 1):
                    self.load[('v', ii, j)] = self.load.get(('v', ii, j), 0) + w * (b - a) / 2

    def band_load_y(self, x0, x1, w, face):
        """section line load w (lb/ft along x, + = +y) between x0 and x1, carried like the tool's basic field: face
        'top' / 'bottom' = the band holding that face of the section, 'all' = every band by depth; inside the band
        spread uniformly over its depth and put on the vertical stringers' mean DOFs (half to each side of a cell)"""
        for i in range(len(self.X) - 1):
            a, b = max(self.X[i], x0), min(self.X[i + 1], x1)
            if b - a <= EPS: continue
            js = [j for j in range(len(self.Y) - 1) if (i, j) in self.cells]
            if not js: continue
            bands, cur = [], [js[0]]
            for j in js[1:]:
                if j == cur[-1] + 1: cur.append(j)
                else: bands.append(cur); cur = [j]
            bands.append(cur)
            depth = lambda bd: self.Y[bd[-1] + 1] - self.Y[bd[0]]
            total = sum(depth(bd) for bd in bands)
            for bd in bands:
                share = 1.0 if face == 'top' and bd is bands[-1] or face == 'bottom' and bd is bands[0] else (depth(bd) / total if face == 'all' else 0.0)
                if not share: continue
                per = w * share * (b - a) / depth(bd)  # lb per ft of band depth over this column
                for j in bd:
                    f = per * (self.Y[j + 1] - self.Y[j])
                    for ii in (i, i + 1):
                        k = ('vb', ii, j)
                        self.load[k] = self.load.get(k, 0) + f / 2

    def line_load_x(self, x, y0, y1, w):
        i = self.ix(x)
        for j in range(len(self.Y) - 1):
            a, b = max(self.Y[j], y0), min(self.Y[j + 1], y1)
            if b - a > EPS:
                for jj in (j, j + 1):
                    self.load[('u', i, jj)] = self.load.get(('u', i, jj), 0) + w * (b - a) / 2

    def area_load(self, psf, axis):
        """psf over the sheathed cells, in direction axis ('y' or 'x', sign by psf), lumped to the cell corners"""
        k = 'v' if axis == 'y' else 'u'
        for (i, j) in self.cells:
            f = psf * (self.X[i + 1] - self.X[i]) * (self.Y[j + 1] - self.Y[j]) / 4
            for ii, jj in ((i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)):
                self.load[(k, ii, jj)] = self.load.get((k, ii, jj), 0) + f

    # supports ----------------------------------------------------------------------------------------------
    def wall_x(self, x, y0, y1, k=None):
        """shear wall on the vertical line x over y0..y1: v fixed at its nodes, or (k = lb/ft per ft of wall) a spring
        per unit length lumped to the nodes, so walls on one collector line share by length (equal unit shear)"""
        i = self.ix(x)
        if k is None:
            for j, y in enumerate(self.Y):
                if y0 - EPS <= y <= y1 + EPS: self.fix.add(('v', i, j))
            return
        self.springs = getattr(self, 'springs', [])
        for j in range(len(self.Y) - 1):
            a, b = max(self.Y[j], y0), min(self.Y[j + 1], y1)
            if b - a > EPS:
                for jj in (j, j + 1): self.springs.append((('v', i, jj), k * (b - a) / 2))

    def wall_y(self, y, x0, x1):
        j = self.iy(y)
        for i, x in enumerate(self.X):
            if x0 - EPS <= x <= x1 + EPS: self.fix.add(('u', i, j))

    def solve(self):
        n = self.n
        F = np.zeros(n)
        for key, f in self.load.items():
            if key in self.dof: F[self.dof[key]] += f
        for key, kk in getattr(self, 'springs', []):
            if key in self.dof: self.K[self.dof[key], self.dof[key]] += kk
        fixed = [self.dof[k] for k in self.fix if k in self.dof]
        free = np.setdiff1d(np.arange(n), fixed)
        U = np.zeros(n)
        U[free] = np.linalg.solve(self.K[np.ix_(free, free)], F[free])
        self.U = U
        R = self.K @ U - F
        self.reactions = {k: R[self.dof[k]] for k in self.fix if k in self.dof}
        for key, kk in getattr(self, 'springs', []):
            if key in self.dof: self.reactions[key] = self.reactions.get(key, 0) - kk * U[self.dof[key]]
        return self

    # results -----------------------------------------------------------------------------------------------
    def N_h(self, y, x, side):
        """axial force in the horizontal stringer line y at x, just left ('-') or right ('+')"""
        j = self.iy(y); i = self.ix(x)
        seg = (i - 1, j) if side == '-' else (i, j)
        if seg not in self.hs: return None
        EA = self.hs[seg]; L = self.X[seg[0] + 1] - self.X[seg[0]]
        ui, uj, ub = (self.U[self.dof[k]] for k in (('u', seg[0], j), ('u', seg[0] + 1, j), ('hb', seg[0], j)))
        return EA / L * (2 * ui + 4 * uj - 6 * ub) if side == '-' else EA / L * (-4 * ui - 2 * uj + 6 * ub)

    def N_v(self, x, y, side):
        i = self.ix(x); j = self.iy(y)
        seg = (i, j - 1) if side == '-' else (i, j)
        if seg not in self.vs: return None
        EA = self.vs[seg]; L = self.Y[seg[1] + 1] - self.Y[seg[1]]
        vi, vj, vb = (self.U[self.dof[k]] for k in (('v', i, seg[1]), ('v', i, seg[1] + 1), ('vb', i, seg[1])))
        return EA / L * (2 * vi + 4 * vj - 6 * vb) if side == '-' else EA / L * (-4 * vi - 2 * vj + 6 * vb)

    def q(self, x, y):
        i = max(k for k in range(len(self.X) - 1) if self.X[k] <= x + EPS and x < self.X[k + 1] + EPS)
        j = max(k for k in range(len(self.Y) - 1) if self.Y[k] <= y + EPS and y < self.Y[k + 1] + EPS)
        if (i, j) not in self.cells: return None
        b, h = self.X[i + 1] - self.X[i], self.Y[j + 1] - self.Y[j]
        g = lambda k: self.U[self.dof[k]]
        gam = (g(('hb', i, j + 1)) - g(('hb', i, j))) / h + (g(('vb', i + 1, j)) - g(('vb', i, j))) / b
        return self.Gt * gam
