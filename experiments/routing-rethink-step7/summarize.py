"""Collect step7 dry-run metrics and inspectable validation evidence; no model calls."""
import hashlib, json, os, re, sys
from collections import defaultdict
from pathlib import Path
root = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root / 'eval'))
import score

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def logfile(name):
    raw=(Path(os.environ['TEMP']) / name).read_bytes()
    return raw.decode('utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
def node_tests(name):
    text=logfile(name)
    head=text.split('failing tests:')[0]
    names=lambda mark: re.findall(r'^'+mark+r' (.*?) \([\d.]+ms\)',head,re.M)
    counts={k:int(re.search(r'\b'+k+r' (\d+)\s*$',text,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped']}
    return {**counts,'passed_names':names('\u2714'),'failed_names':names('\u2716')}

evidence={'kind':'offline-pipeline-only-not-model-quality','base_commit':'3ce63f3b6c9f76c777a958aa083e939b016e1f1e',
    'corpora':{},'runs':{},'rescored_step6b':{}}
for corpus in ['interleave-v1','interleave-v1-step7']:
    data=root / f'eval/data/{corpus}/sessions.jsonl'
    sessions=score.read_jsonl(data)
    evidence['corpora'][corpus]={'sha256':sha(data),'sessions':len(sessions),'messages':sum(len(s['turns']) for s in sessions)}
    predictions={kind:score.read_jsonl(root / f'eval/data/{corpus}/predictions/step7-dry-final-all-{kind}.jsonl') for kind in ['none','drop-user-refs','drop-bindings']}
    for kind,rows in predictions.items():
        for split in ['dev','test']:
            result=score.evaluate(sessions,rows,split)
            selected=[r for r in rows if any(s['session_id']==r['session_id'] and s['split']==split for s in sessions)]
            evidence['runs'][f'{corpus}/{split}/{kind}']={'score':result,'logical_calls':sum(r['logical_calls'] for r in selected),
                'router_errors':sum(bool(r.get('error')) for r in selected),'missing_receipts':sum(r.get('receipt_missing',False) for r in selected)}
            print(corpus,split,kind,'messages',result['messages'],'accuracy',result['accuracy'],'calls',sum(r['logical_calls'] for r in selected),
                'R16',result['routing_v1']['large_catalog']['recall_at_16'],'oneoff',result['routing_v1']['oneoff'])
    for split in ['dev','test']:
        for kind in ['drop-user-refs','drop-bindings']:
            paired=score.evaluate(sessions,predictions['none'],split,ablation_predictions=predictions[kind])['routing_v1']['pairs']['ablation']
            evidence['runs'][f'{corpus}/{split}/{kind}']['paired_comparison']=paired
    if corpus=='interleave-v1':
        for split in ['dev','test']:
            for kind in ['full','drop-bindings']:
                p=root / f'eval/data/{corpus}/predictions/step6b-real-{split}-deepseek-v4.1-flash-{kind}.jsonl'
                evidence['rescored_step6b'][f'{split}/{kind}']=score.evaluate(sessions,score.read_jsonl(p),split)
evidence['product_tests']=node_tests('routing-step7-product-final.log')
evidence['targeted_tests']=node_tests('routing-step7-targeted-final.log')
evidence['node_eval_tests']=node_tests('routing-step7-eval-node-final.log')
python_log=logfile('routing-step7-python-final.log')
evidence['python_eval_tests']={'tests':int(re.search(r'Ran (\d+) tests',python_log)[1]),'passed':bool(re.search(r'^OK\s*$',python_log,re.M))}
evidence['v0_scores']=json.loads((root / 'experiments/routing-rethink-step7/v0-scores.json').read_text(encoding='utf-8'))
evidence['v0_comparison']={k:{field:v[field] for field in ['messages','identical','before_sha256','after_sha256','differences']} for k,v in json.loads((root / 'experiments/routing-rethink-step7/v0-comparison.json').read_text(encoding='utf-8')).items()}
files=['src/index.ts','src/llm-router.ts','src/routing-bindings.ts','src/routing-policy.ts','src/routing-shadow.ts',
       'dist/index.js','dist/llm-router.js','dist/routing-bindings.js','dist/routing-policy.js','dist/routing-shadow.js',
       'eval/score.py','eval/score_routing_v1.py','eval/lib/product-replay.mjs','eval/generate-routing-v1.mjs',
       'tests/routing-bindings.test.ts','tests/routing-shadow.test.ts','eval/test/routing-v1.test.mjs','eval/test/test_score_routing_v1.py']
evidence['files']={path:sha(root/path) for path in files}
(root / 'experiments/routing-rethink-step7/validation.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Product',evidence['product_tests']['pass'],evidence['product_tests']['fail'],'Targeted',evidence['targeted_tests']['pass'])
