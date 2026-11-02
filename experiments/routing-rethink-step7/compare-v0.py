"""Compare v0 replays after removing runtime UUIDs and measured wall-clock fields only."""
import json, re, sys, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'eval'))
import score
root = Path(__file__).resolve().parents[2]
sessions = score.read_jsonl(root / 'eval/data/interleave-v0/sessions.jsonl')
uuid = re.compile(r'\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b', re.I)
def canonical(rows):
    ids = {}
    def norm(value):
        if isinstance(value, dict):
            return {k:norm(v) for k,v in value.items() if k not in {'elapsed_ms', 'latency_ms', 'elapsedMs'}}
        if isinstance(value, list): return [norm(v) for v in value]
        if isinstance(value, str): return uuid.sub(lambda m: ids.setdefault(m[0], 'uuid-'+str(len(ids))), value)
        return value
    result = []
    for row in rows:
        if not result or row['session_id'] != result[-1]['session_id']: ids.clear()
        result.append(norm(row))
    return result
result = {}
for mode in ['open', 'closed']:
    for split in ['dev', 'test']:
        a,b = [score.read_jsonl(root / f'eval/data/interleave-v0/predictions/step7-{phase}-{mode}-{split}.jsonl') for phase in ['before','final']]
        aa,bb = canonical(a),canonical(b)
        changes = [{'session_id':x['session_id'],'i':x['i'],'before':x,'after':y} for x,y in zip(aa,bb) if x!=y]
        def sha(v): return hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        result[f'{mode}-{split}'] = {'messages':len(a),'identical':len(a)-len(changes),'differences':changes,
            'before_sha256':sha(aa),'after_sha256':sha(bb), 'before_score':score.evaluate(sessions,a,split),'after_score':score.evaluate(sessions,b,split)}
        print(mode,split,len(a),'differences',len(changes))
(root / 'experiments/routing-rethink-step7/v0-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
