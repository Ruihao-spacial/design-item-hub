import sys, os, json; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from calibrate import build, REPO
b81 = json.load(open(os.path.join(REPO, 'tests', 'td-book', 'Ex8.1.json'), encoding='utf-8'))
b51 = json.load(open(os.path.join(REPO, 'tests', 'td-book', 'Ex5.1.json'), encoding='utf-8'))
# equilibrium through the opening (Ex 8.1 D1, x = 62.5): every horizontal stringer
m = build(b81, (0, 100), k_wall=24000)
S = 0; Mo = 0
for y in m.Y:
    n = m.N_h(y, 62.5, '-')
    if n is not None: S += n; Mo += n * y
print('Ex8.1 D1 x=62.5: sumN %.1f  -sum N*y about y=0: %.0f   M(62.5)=%.0f (10000*62.5-100*62.5^2)' % (S, -Mo, 10000*62.5-100*62.5**2))
print('reactions: line1 %.0f  line6 %.0f' % (sum(v for k, v in m.reactions.items() if k[1] == m.ix(0)), sum(v for k, v in m.reactions.items() if k[1] == m.ix(100))))
print()
print('%-28s %9s %9s %9s %9s %9s %9s | %9s %9s %9s %9s' % ('Ga k/in, EA chord', 'A.2@3', 'A.2@5', 'B@3', 'B@5', 'D@4-', 'E@5', '51 B@3', '51 C@3', '51 B@4', '51 C@2'))
print('%-28s %9s %9s %9s %9s %9s %9s | %9s %9s %9s %9s' % ('book', -2043, -282, -550, 1783.3, 3000, 1323.4, 0, 0, 4670.1, 4824.2))
for Ga in (10, 20, 40, 400):
    for f in (0.5, 1, 4):
        EA = 1.68e7 * f
        m = build(b81, (0, 100), Ga=Ga, EA_chord=EA, EA_member=EA, k_wall=24000)
        n = build(b51, None, Ga=Ga, EA_chord=EA, EA_member=EA, k_wall=24000)
        r = [m.N_h(80, 50, '+'), m.N_h(80, 75, '-'), m.N_h(50, 50, '+'), m.N_h(50, 75, '-'), m.N_h(10, 60, '-'), m.N_h(0, 75, '-'),
             n.N_h(40, 27, '-'), n.N_h(16, 27, '-'), n.N_h(40, 39, '-'), n.N_h(16, 15, '+')]
        print('%-28s ' % ('Ga %g, EA x%g' % (Ga, f)) + ' '.join('%9.0f' % v for v in r[:6]) + ' | ' + ' '.join('%9.0f' % v for v in r[6:]))
