"""Verify saved evidence and frozen code without re-evaluating test predictions."""
from pathlib import Path
import hashlib
import json
import re

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(name): return json.loads((HERE/name).read_text(encoding='utf-8'))

def main():
    freeze=read('freeze.json')
    for path,sha in freeze['files'].items():
        assert digest(ROOT/path)==sha, f'Frozen file changed: {path}'
    assert digest(HERE/'dev-results.json')==freeze['dev_results_sha256']
    assert read('test-evaluation-started.json')['freeze_sha256']==digest(HERE/'freeze.json')
    assert freeze['frozen_at_utc'] < read('test-evaluation-started.json')['started_at_utc']
    groups=0
    for split,n,m in [('dev',1971,1631),('test',495,420)]:
        data=read(f'{split}-results.json')
        assert data['analysis_sha256']==digest(HERE/'analyze.py')
        assert data['policy']==freeze['policy']
        probe=read(f'source-probe-{split}.json')
        assert probe['corpus_sha256']==data['inputs']['eval/data/interleave-v0/sessions.jsonl']
        assert probe['counts']['messages']==n and probe['counts']['regex_hits']==0
        assert not any(probe['metadata'].values())
        for mode,g in data['groups'].items():
            groups+=1
            assert (g['messages'],g['strict_messages'])==(n,m)
            assert g['audit']['candidate_set_complete']==n
            assert g['audit']['review_attempted']==0
            assert g['audit']['hypothetical_novel_create']==0
            review=g['recheck']; triggers=list(review['by_trigger'].values())
            for field in ['n','strict_n','corrected','regressed','same_target','all_same_target']:
                assert review['attempted'].get(field,0)==sum(v.get(field,0) for v in triggers)
            for field in ['recheck_calls','recheck_tokens','recheck_ms','recheck_usd']:
                # The displayed aggregates round at 6 decimals, allowing only rounding error.
                assert abs(review['costs'][field]-sum(v['costs'][field] for v in triggers))<=0.000003
            all_rows=review['all_messages']
            assert all_rows['final_correct']==g['baseline']['correct']
            assert all_rows['final_correct']-all_rows['initial_correct']==all_rows['corrected']-all_rows['regressed']
            assert abs(all_rows['accuracy_delta_pp']['estimate']-100*(all_rows['corrected']-all_rows['regressed'])/m)<0.000001
            for cut,v in g['candidate_recall'].items():
                assert sum(v['status_counts'].values())==v['strict_n']
                assert sum(v['prefix_status_counts'].values())==v['strict_n']
                assert not v['status_counts'].get('selection_miss',0)
            assert g['policy']['saved_calls']<=review['costs']['recheck_calls']
            assert g['policy']['remaining_rechecks']+g['policy']['skipped_rechecks']==review['attempted']['n']
    report=ROOT/'docs/design/routing-rethink-step4-report.zh.md'
    links=0
    if report.exists():
        text=report.read_text(encoding='utf-8')
        for target in re.findall(r'\]\(([^)]+)\)',text):
            if '://' in target or target.startswith('#'): continue
            path=(report.parent/target.split('#')[0]).resolve()
            assert path.exists(), f'Broken report link: {target}'
            links+=1
    manifest=HERE/'artifact-manifest.json'
    if manifest.exists():
        for path,sha in json.loads(manifest.read_text(encoding='utf-8'))['files'].items():
            assert digest(ROOT/path)==sha, f'Artifact changed: {path}'
    print(json.dumps({'frozen_files':len(freeze['files']),'groups':groups,'saved_prediction_row_count':4932,
                      'report_links':links,'test_prediction_re_evaluations':0},ensure_ascii=False))

if __name__=='__main__': main()