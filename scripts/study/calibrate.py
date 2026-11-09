"""Calibration: book member forces vs the tool vs the stringer-panel reference, on single-span book examples."""
import sys, os, json, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sp import Model

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))


def tool_values():
    """key -> tool value, per example, from the generated book-cases doc"""
    out, ex = {}, None
    for line in open(os.path.join(REPO, 'docs', 'diaphragm-analysis-book-cases.md'), encoding='utf-8'):
        m = re.match(r'## (Ex[\d.]+):', line)
        if m: ex = m.group(1); out[ex] = {}; continue
        cells = [c.strip() for c in line.split('|')]
        if ex and len(cells) > 11 and cells[3].startswith('`'):
            try: out[ex][cells[3].strip('`')] = float(cells[10].replace(',', ''))
            except ValueError: pass
    return out


def members_of(L, xlim=None):
    """the design's members (besides the outline / opening chords): TD edges, each TD load line across its TD, and the
    wall lines (collector / strut over the depth of the sheathing at that line)"""
    gx = {g['name']: g['at'] for g in L['grids'] if g['axis'] == 'x'}
    gy = {g['name']: g['at'] for g in L['grids'] if g['axis'] == 'y'}
    segs = []
    for t in L.get('tds', []):
        x0, x1 = t['x']; y0, y1 = t['y']
        segs += [('x', y0, x0, x1), ('x', y1, x0, x1), ('y', x0, y0, y1), ('y', x1, y0, y1)]
        for l in t['loads']:
            if l['grid'] in gy: segs.append(('x', gy[l['grid']], x0, x1))
            else: segs.append(('y', gx[l['grid']], y0, y1))
    ys = [p[1] for p in L['outline']]; xs = [p[0] for p in L['outline']]
    for w in L['walls']:
        if w['axis'] == 'x': segs.append(('y', w['at'], min(ys), max(ys)))
        else: segs.append(('x', w['at'], min(xs), max(xs)))
    return segs


def build(book, xlim=None, Ga=20.0, EA_chord=1.68e7, EA_member=None, h=2.5, aux_x=1e3, aux_y=1e3, k_wall=None):
    L = book['layout']
    gx = {g['name']: g['at'] for g in L['grids'] if g['axis'] == 'x' and not g.get('ref')}
    gy = {g['name']: g['at'] for g in L['grids'] if g['axis'] == 'y' and not g.get('ref')}
    outline = [tuple(p) for p in L['outline']]
    if xlim:  # clip the outline to one diaphragm (rectilinear clip by x)
        import itertools
        xs = sorted({p[0] for p in outline} | set(xlim)); ys = sorted({p[1] for p in outline})
        from sp import point_in_poly
        cells = [(a, b, c, d) for a, b in zip(xs[:-1], xs[1:]) for c, d in zip(ys[:-1], ys[1:])
                 if xlim[0] - 1e-6 <= a and b <= xlim[1] + 1e-6 and point_in_poly((a + b) / 2, (c + d) / 2, outline)]
        outline = None
    load_y = L['loads'][0]['acts'].endswith('y')
    ax_, ay_ = (aux_x, aux_y) if load_y else (aux_y, aux_x)
    ops = [(o['x'][0], o['x'][1], o['y'][0], o['y'][1]) for o in L.get('openings', [])]
    if xlim:
        ops = [o for o in ops if o[0] >= xlim[0] - 1e-6 and o[1] <= xlim[1] + 1e-6]
        m = Model.__new__(Model)
        Model.__init__(m, [(xlim[0], min(c[2] for c in cells)), (xlim[1], min(c[2] for c in cells)), (xlim[1], max(c[3] for c in cells)), (xlim[0], max(c[3] for c in cells))], ops, h=h,
                       extra_x=[c[0] for c in cells] + [c[1] for c in cells], extra_y=[c[2] for c in cells] + [c[3] for c in cells],
                       member_x=[v for v in gx.values() if xlim[0] - 1e-6 <= v <= xlim[1] + 1e-6], member_y=list(gy.values()), member_segs=members_of(L),
                       Ga=Ga, EA_chord=EA_chord, EA_member=EA_member, EA_aux_x=ax_, EA_aux_y=ay_)
        from sp import point_in_poly as pip
        full = [tuple(p) for p in L['outline']]
        m.sheathed = lambda x, y: xlim[0] < x < xlim[1] and pip(x, y, full) and not any(o[0] < x < o[1] and o[2] < y < o[3] for o in ops)
        m._outline_full = full
        orig = m._on_edge
        def on_edge(axis, c, a, b, m=m, orig=orig):
            mid = (a + b) / 2
            # an edge is a chord where the sheathing stops on one side
            if axis == 'x': s1, s2 = m.sheathed(mid, c - 1e-3), m.sheathed(mid, c + 1e-3)
            else: s1, s2 = m.sheathed(c - 1e-3, mid), m.sheathed(c + 1e-3, mid)
            return s1 != s2
        m._on_edge = on_edge
    else:
        m = Model(outline, ops, h=h, member_x=list(gx.values()), member_y=list(gy.values()), member_segs=members_of(L), Ga=Ga, EA_chord=EA_chord,
                  EA_member=EA_member, EA_aux_x=ax_, EA_aux_y=ay_)
    m.build()
    lo, hi = (xlim or (min(m.X), max(m.X)))
    for l in L['loads']:
        sg = -1 if l['acts'].startswith('-') else 1
        top = max(gy.values())
        face = 'all' if not l.get('edge') else ('top' if gy[l['edge']] >= top - 1e-6 else 'bottom')
        for s in l['segments']:
            a, b = max(s['from'], lo), min(s['to'], hi)
            if b - a > 1e-6: m.band_load_y(a, b, sg * s['w'], face)
    for w in L['walls']:
        if load_y and w['axis'] == 'x' and lo - 1e-6 <= w['at'] <= hi + 1e-6: m.wall_x(w['at'], w['from'], w['to'], k_wall)
        if not load_y and w['axis'] == 'y': m.wall_y(w['at'], w['from'], w['to'])
    # one restraint across the load against rigid-body motion
    if m.fix: k = next(iter(m.fix))
    else: k = m.springs[0][0]
    m.fix.add(('u', k[1], k[2]) if load_y else ('v', k[1], k[2]))
    m.solve()
    m.gx, m.gy = gx, gy
    return m


def station(m, txt, axis):
    mm = re.match(r'^([xy])=(-?[\d.]+)$', txt)
    if mm: return float(mm.group(2)) if mm.group(1) == axis else None
    g = (m.gx if axis == 'x' else m.gy).get(txt)
    return g


def ref_value(m, key):
    kind, line, st = key.split(':')[:3]
    side = st[-1] if st[-1] in '+-' else ''
    st = st[:-1] if side else st
    if line in m.gy and line not in m.gx:  # horizontal member, station along x
        y, x = m.gy[line], station(m, st, 'x')
        if x is None: return None
        vals = [m.N_h(y, x, s) for s in ([side] if side else ['-', '+'])]
    elif line in m.gx:
        x, y = m.gx[line], station(m, st, 'y')
        if y is None: return None
        vals = [m.N_v(x, y, s) for s in ([side] if side else ['-', '+'])]
    else: return None
    vals = [v for v in vals if v is not None]
    if not vals: return None
    return vals


K_WALL = float(sys.argv[1]) if len(sys.argv) > 1 else None
if __name__ == '__main__':
    tools = tool_values()
    cases = [('Ex3.5', None), ('Ex4.1', None), ('Ex4.3', None), ('Ex5.1', None), ('Ex8.1', (0, 100)), ('Ex8.1', (100, 190))]
    for ex, xlim in cases:
        book = json.load(open(os.path.join(REPO, 'tests', 'td-book', '%s.json' % ex), encoding='utf-8'))
        m = build(book, xlim, k_wall=K_WALL)
        print('\n== %s%s  (dofs %d)' % (ex, ' x %s-%s' % xlim if xlim else '', m.n))
        print('%-16s %10s %10s %18s %8s %8s' % ('key', 'book', 'tool', 'ref (- / +)', 'ref-book', 'tool-book'))
        for e in book['expected']:
            if not (e['k'].startswith('N:') or e['k'].startswith('Nb:')): continue
            r = ref_value(m, e['k'])
            if r is None: continue
            bv = e.get('vTool', e['v']); tv = tools.get(ex, {}).get(e['k'])
            rv = min(r, key=lambda v: abs(v - bv))  # side closest to the book when no side is given
            sc = max(abs(bv), 100)
            print('%-16s %10.1f %10s %18s %7.1f%% %7s' % (e['k'], bv, '%.1f' % tv if tv is not None else '-', ' / '.join('%.1f' % v for v in r),
                  100 * (rv - bv) / sc, '%.1f%%' % (100 * (tv - bv) / sc) if tv is not None else '-'))
