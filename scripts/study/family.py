"""Parametric family for G4: opening 25 x 15 ft with the bottom chord notched under it (cut at xc inside the opening)."""
import json
cases = []
for xo in (15, 40, 47.5):          # opening start: near the support / quarter span / centred (span 120, V = 0 at 60)
    for f in (0.1, 0.4, 0.6):       # cut position as a fraction of the opening length
        xc = xo + 25 * f
        L = {
            'grids': [{'name': n, 'axis': 'x', 'at': a} for n, a in (('1', 0), ('2', xo - 15), ('3', xo), ('4', xc), ('5', xo + 25), ('6', xo + 40), ('7', 120))] +
                     [{'name': n, 'axis': 'y', 'at': a} for n, a in (('E', 0), ('D', 10), ('B', 30), ('A.2', 45), ('A', 50))],
            'outline': [[0, 10], [xc, 10], [xc, 0], [120, 0], [120, 50], [0, 50]],
            'openings': [{'name': 'OP', 'x': [xo, xo + 25], 'y': [30, 45]}],
            'walls': [{'line': '1', 'mark': 'SW1', 'axis': 'x', 'at': 0, 'from': 10, 'to': 50}, {'line': '7', 'mark': 'SW2', 'axis': 'x', 'at': 120, 'from': 0, 'to': 50}],
            'diaphragms': [{'mark': 'D1', 'x': [0, 120], 'y': [0, 50], 'supports': ['1', '7']}],
            'tds': [{'mark': 'TD1', 'x': [xo - 15, xo], 'y': [10, 50], 'supports': ['A', 'D'], 'loads': [{'grid': 'A.2', 'side': '+'}, {'grid': 'B', 'side': '+'}]},
                    {'mark': 'TD2', 'x': [xc, xo + 25], 'y': [0, 30], 'supports': ['B', 'E'], 'loads': [{'grid': 'D', 'side': '-'}]},
                    {'mark': 'TD3', 'x': [xo + 25, xo + 40], 'y': [0, 50], 'supports': ['A', 'E'], 'loads': [{'grid': 'A.2', 'side': '-'}, {'grid': 'B', 'side': '-'}]}],
            'loads': [{'acts': '-y', 'mode': 'line', 'segments': [{'from': 0, 'to': 120, 'w': 200}]}],
        }
        cases.append({'id': 'xo%g_f%g' % (xo, f), 'title': 'family', 'pdf': '', 'pages': '', 'layout': L, 'expected': [], 'xo': xo, 'xc': xc})
json.dump(cases, open('family.json', 'w'), indent=1)
print(len(cases), 'cases')
