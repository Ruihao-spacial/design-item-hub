// Diaphragm Analysis — TD engine: runs the skill wood-diaph-transfer (tdFlow.js, generated from its flow.yaml) on one
// transfer diaphragm. Pure, no DOM. The JS twin of the skill's reference/wood_diaph_transfer.py: every step of the
// flow, in order, and nothing else (FRAMEWORK §15). Units ft, lbf, plf; local frame and signs as SKILL.md §2.
//
//   runTd(inputs, engineerInputs, edition?) → { outputs, flags, trace, terminal, draft }
//   terminal: 'OUTPUT' | 'HARD_STOP:<code>' | 'ENGINEER_INPUT:<step>' (paused, the engineer input is missing)
//   trace: one record per step { id, type, title, cite, verify, values?, condition?, passed?, table? }
//
// Engineer inputs (td_region_clear, td_cantilever_ok, td_closure_tol) are never filled here: a missing one pauses.
import { TD_FLOW } from './tdFlow.js';
import { SDPWS_T422 } from './tdTables.js';

const TABLES = { [SDPWS_T422.tableId]: SDPWS_T422 };

export class TdFlowError extends Error {}

// Engineer-input check (allowed_values: a list, or { type: 'number', min | min_exclusive })
function allowed(spec, v) {
  if (Array.isArray(spec)) return spec.includes(v);
  if (spec && spec.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if ('min_exclusive' in spec && !(v > spec.min_exclusive)) return false;
    if ('min' in spec && !(v >= spec.min)) return false;
    return true;
  }
  throw new TdFlowError('unsupported allowed_values: ' + JSON.stringify(spec));
}

const route = (next, v) => (next && typeof next === 'object' ? next[String(!!v)] : next);
const cites = (st, ed) => (st.edition && st.edition[ed] && st.edition[ed].cite) || st.cite || [];

export function runTd(inputs, engineerInputs = {}, edition = null, maxSteps = 500) {
  const F = TD_FLOW;
  const missing = F.inputs.filter(k => !(k in inputs));
  if (missing.length) throw new TdFlowError('missing inputs: ' + missing.join(', '));
  const env = {};
  for (const k of F.inputs) env[k] = inputs[k];
  Object.assign(env, F.constants);
  if (edition != null) env[F.editionParam] = edition;
  const ed = env[F.editionParam];
  // Every name an expression reads must be set (the reference raises on an unresolved name)
  const e = new Proxy(env, { get(t, k) { if (!(k in t)) throw new TdFlowError('unresolved name ' + String(k)); return t[k]; } });

  const res = { outputs: {}, flags: [], trace: [], terminal: '', draft: F.skillStatus !== 'PE_APPROVED' };
  let sid = F.entry;
  for (let n = 0; n < maxSteps; n++) {
    const st = F.steps[sid];
    if (!st) throw new TdFlowError('unknown step ' + sid);
    const rec = { id: sid, type: st.type, title: st.title, cite: cites(st, ed), verify: st.verify };
    const expr = (st.edition && st.edition[ed] && st.edition[ed].expr) || st.expr;
    switch (st.type) {
      case 'COMPUTE': {
        const vals = {};
        for (const [k, f] of Object.entries(expr)) vals[k] = env[k] = f(e); // in listed order
        rec.values = vals;
        sid = st.next;
        break;
      }
      case 'LOOKUP': {
        const tb = TABLES[st.table.id];
        if (!tb) throw new TdFlowError('unknown table ' + st.table.id);
        const keys = Object.entries(st.table.keys).map(([col, v]) => [col, env[v]]);
        const rows = tb.rows.filter(r => keys.every(([c, v]) => String(r[c]) === String(v)));
        if (rows.length !== 1) throw new TdFlowError(`LOOKUP ${sid}: ${rows.length} rows match ${JSON.stringify(Object.fromEntries(keys))}`);
        const vals = Object.fromEntries(st.outputs.map(o => [o, rows[0][o]]));
        Object.assign(env, vals);
        Object.assign(rec, { values: vals, table: st.table.id, tableVerify: tb.verify });
        sid = st.next;
        break;
      }
      case 'BRANCH': {
        rec.condition = !!st.condition(e);
        sid = route(st.next, rec.condition);
        break;
      }
      case 'CHECK': {
        const vals = {};
        for (const [k, f] of Object.entries(expr || {})) vals[k] = env[k] = f(e);
        rec.values = vals;
        rec.passed = !!st.condition(e);
        sid = route(st.next, rec.passed);
        break;
      }
      case 'ENGINEER_INPUT': {
        const key = st.outputs[0];
        const v = engineerInputs ? engineerInputs[key] : undefined;
        if (v === undefined || v === null || v === '') {
          res.trace.push({ ...rec, paused: true, prompt: st.prompt });
          res.terminal = 'ENGINEER_INPUT:' + sid;
          return res;
        }
        if (!allowed(st.allowed_values, v)) throw new TdFlowError(`${sid}: ${JSON.stringify(v)} is not an allowed value for ${key}`);
        env[key] = v;
        rec.values = { [key]: v };
        sid = st.next;
        break;
      }
      case 'CONSERVATIVE_DEFAULT': {
        for (const k of st.outputs) env[k] = st.value[k];
        res.flags.push({ id: st.warning, step: sid, message: st.message || '' });
        rec.values = Object.fromEntries(st.outputs.map(k => [k, env[k]]));
        sid = st.next;
        break;
      }
      case 'HARD_STOP':
        res.trace.push({ ...rec, reasonCode: st.reason_code });
        res.flags.push({ id: st.reason_code, step: sid, message: st.message });
        res.terminal = 'HARD_STOP:' + st.reason_code;
        return res;
      case 'OUTPUT':
        res.outputs = Object.fromEntries(st.outputs.map(k => [k, env[k]]));
        for (const f of st.flags || []) res.flags.push({ id: f, step: sid, message: '' });
        for (const c of st.conditional_flags || []) if (c.when(e)) res.flags.push({ id: c.flag, step: sid, message: c.message });
        res.trace.push(rec);
        res.terminal = 'OUTPUT';
        return res;
      default:
        throw new TdFlowError('unknown step type ' + st.type);
    }
    res.trace.push(rec);
  }
  throw new TdFlowError('max steps exceeded');
}

// The step types present in the flow (tests check each is reached)
export const flowStepTypes = () => [...new Set(Object.values(TD_FLOW.steps).map(s => s.type))];
