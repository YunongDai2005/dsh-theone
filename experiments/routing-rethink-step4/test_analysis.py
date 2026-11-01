"""Hand-calculated cases protecting the offline comparison, not product behavior."""
import importlib.util
from pathlib import Path
import unittest
SPEC = importlib.util.spec_from_file_location('step4_analysis', Path(__file__).with_name('analyze.py'))
a = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(a)
class AnalysisTests(unittest.TestCase):
    def test_unclear_settlement_prefers_current_only_if_offered(self):
        self.assertEqual(a.settled_target({'action':'CLARIFY','relatedIds':['b','a']},'a',['a','b']),'a')
        self.assertEqual(a.settled_target({'action':'CLARIFY','relatedIds':['b']},'a',['a','b']),'b')
    def test_unclear_ignores_unknown_ids_and_handles_empty_catalog(self):
        self.assertEqual(a.settled_target({'action':'CLARIFY','relatedIds':['missing']},'a',['a']),'a')
        self.assertEqual(a.settled_target({'action':'CLARIFY'},None,[]),'CREATE')
        self.assertEqual(a.settled_target({'action':'CLARIFY','reason':'ROUTER_MODEL_MISSING'},'a',['a']),'CLARIFY')
    def test_create_is_not_mistaken_for_an_existing_assigned_id(self):
        self.assertEqual(a.settled_target({'action':'CREATE','contextId':'allocated'},'a',['a']),'CREATE')
    def test_candidate_miss_separates_catalog_absence_from_selection(self):
        self.assertEqual(a.candidate_status('g',['b'],['a','b'],{'a':'g','b':'h'},{'g'},'open'),'selection_miss')
        self.assertEqual(a.candidate_status('g',['b'],['b'],{'a':'g','b':'h'},{'g'},'open'),'catalog_absent')
        self.assertEqual(a.candidate_status('g',[],[],{'a':'g'},set(),'open'),'new_task')
        self.assertEqual(a.candidate_status('g',['a'],['a'],{'a':'g'},{'g'},'open'),'hit')
    def test_loss_does_not_update_counterfactual_history(self):
        held={'a':{'g':3},'b':{'h':2}}
        self.assertEqual(a.route_kind('b','g','open',held,{'g','h'}),'wrong_existing')
        self.assertEqual(a.route_kind('CREATE','g','open',held,{'g','h'}),'spurious_new')
        self.assertEqual(a.route_kind('CREATE','new','open',held,{'g','h'}),'correct')
        self.assertEqual(held,{'a':{'g':3},'b':{'h':2}})
    def test_oneoff_into_an_empty_but_existing_topic_remains_isolated(self):
        self.assertEqual(a.route_kind('a',None,'open',{'a':{}},set()),'oneoff_isolated')
        self.assertEqual(a.route_kind('a',None,'open',{'a':{'g':1}},{'g'}),'oneoff_into_topic')
    def test_trigger_uses_pre_review_evidence_and_skips_empty_catalog(self):
        self.assertEqual(a.keep_recheck({'action':'CREATE'},[],{}),(False,'empty-catalog'))
        self.assertEqual(a.keep_recheck({'action':'CREATE'},['a'],{}),(True,'split-risk'))
        self.assertEqual(a.keep_recheck({'action':'CLARIFY'},['a','b'],{}),(False,'no-discriminating-evidence'))
        self.assertEqual(a.keep_recheck({'action':'KEEP','contextId':'a'},['a','b'],{'contextId':'b','terms':['A123']}),(True,'conflicting-evidence'))
    def test_trigger_does_not_accept_stale_or_empty_evidence(self):
        self.assertEqual(a.keep_recheck({'action':'CLARIFY'},['a'],{'contextId':'gone','terms':['X123']}),(False,'no-discriminating-evidence'))
        self.assertEqual(a.keep_recheck({'action':'KEEP','contextId':'a'},['a','b'],{'contextId':'b','terms':[]}),(False,'no-discriminating-evidence'))
    def test_bootstrap_resamples_whole_unequal_conversations(self):
        result=a.cluster_interval([(1,1),(0,99)],scale=100,iterations=1000)
        self.assertEqual(result['estimate'],1.0)
        self.assertEqual(result['ci95'],[0.0,100.0])
        self.assertEqual(result['clusters'],2)
    def test_empty_statistic_is_unknown_not_zero(self):
        self.assertIsNone(a.cluster_interval([(0,0)],scale=100)['estimate'])
        self.assertIsNone(a.cluster_interval([(0,0)],scale=100)['ci95'])
    def test_usage_cost_does_not_bill_cache_twice(self):
        self.assertAlmostEqual(a.cost({'input':1000,'cache_hit':800,'output':100}),0.0001848)
    def test_input_join_rejects_missing_duplicate_and_unknown_keys(self):
        sessions=[{'session_id':'s','turns':[{'i':0},{'i':1}]}]
        good=[{'session_id':'s','i':0},{'session_id':'s','i':1}]
        self.assertEqual(len(a.join_keys(sessions,good)),2)
        for rows in [good[:1],good+good[:1],good+[{'session_id':'s','i':2}]]:
            with self.assertRaises(ValueError): a.join_keys(sessions,rows)
    def test_only_authorized_baseline_paths_can_be_resolved(self):
        self.assertEqual(a.prediction_path('open','dev').name,'product-v1-open-dev-cards-deepseek-v4.1-flash.jsonl')
        for mode,split in [('step3','dev'),('open','step3-test'),('../closed','test')]:
            with self.assertRaises(ValueError): a.prediction_path(mode,split)
    def test_group_analysis_keeps_baseline_history_and_scores_settlement(self):
        turns=[{'i':i,'text':'message','gold':{'thread':g,'refs':[]},'ambiguous':False} for i,g in enumerate(['a','b','b'])]
        session={'session_id':'s','threads':[{'id':'a','domain':'work'},{'id':'b','domain':'work'}],'turns':turns}
        rows=[]
        initials=[{'action':'CREATE'}, {'action':'CLARIFY','relatedIds':['a','b']}, {'action':'KEEP','contextId':'b'}]
        for i,(target,initial) in enumerate(zip(['a','b','b'],initials)):
            reviewed=i<2
            calls=[{'layer':layer,'input':100,'output':10,'cache_hit':50,'latency_ms':200} for layer in (['quick','recheck'] if reviewed else ['quick'])]
            final={'action':'MOUNT' if i==0 else 'SWAP' if i==1 else 'KEEP','contextId':target}
            rows.append({'session_id':'s','i':i,'replay':'product-v1','mode':'closed','policy':'theone','pred':target,
                'trace':{'initial':initial,'final':final,'candidateIds':['a','b'],'autoSettled':False,
                         'review':{'attempted':False},'recheck':{'attempted':reviewed,**({'trigger':'create' if i==0 else 'clarify','accepted':True} if reviewed else {})}},
                'usage_by_call':calls,'usage':{k:sum(c[k] for c in calls) for k in ['input','output','cache_hit']},
                'calls':len(calls),'logical_calls':len(calls),'call_details':[{} for c in calls],
                'elapsed_ms':500,'tier':'recheck' if reviewed else 'quick'})
        result=a.analyze_group([session],rows,'closed')
        self.assertEqual(result['baseline']['correct'],3)
        self.assertEqual(result['recheck']['attempted']['corrected'],2)
        self.assertEqual(result['recheck']['attempted']['initial_correct'],0)
        self.assertEqual(result['policy']['skipped_rechecks'],1)
        self.assertEqual(result['policy']['accuracy_delta_pp']['estimate'],-33.333333)
        self.assertEqual(result['policy']['harm_delta_per100']['estimate'],100)
        self.assertFalse(result['policy']['numeric_gate_pass'])
        self.assertEqual(result['candidate_recall']['all']['eligible_n'],3)
if __name__=='__main__': unittest.main()