import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); os.chdir(HERE)
from calibrate import build
cases = json.load(open('family.json')); tool = json.load(open('family_tool.json'))
print('%-11s %-8s | %8s %8s | %8s %8s %8s | %8s %8s %8s %8s' % ('case', 'V at cut', 'D vier', 'D sect', 'D ref20', 'D ref10s', 'D ref40', 'A2@3 rule', 'A2@3 ref', 'B@3 rule', 'B@3 ref'))
rows = []
for c in cases:
    xo, xc = c['xo'], c['xc']
    refs = []
    for Ga, f in ((20, 1), (10, 4), (40, 1)):
        m = build(c, None, Ga=Ga, EA_chord=1.68e7 * f, EA_member=1.68e7 * f, k_wall=24000)
        refs.append({'D': m.N_h(10, xc, '-'), 'A2_3': m.N_h(45, xo, '+'), 'A2_5': m.N_h(45, xo + 25, '-'), 'B_3': m.N_h(30, xo, '+'), 'B_5': m.N_h(30, xo + 25, '-')})
    t = tool[c['id']]
    V = 12000 - 200 * xc
    print('%-11s %8.0f | %8.0f %8.0f | %8.0f %8.0f %8.0f | %8.0f %8.0f %8.0f %8.0f' % (c['id'], V, t['vierendeel']['D'], t['section']['D'], refs[0]['D'], refs[1]['D'], refs[2]['D'],
          t['vierendeel']['A2_3'], refs[0]['A2_3'], t['vierendeel']['B_3'], refs[0]['B_3']))
    rows.append({'id': c['id'], 'V': V, 'tool': t, 'ref': refs})
json.dump(rows, open('family_out.json', 'w'), indent=1)
