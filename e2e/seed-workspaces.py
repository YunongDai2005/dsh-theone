import json,sys,uuid,datetime
p,E,withDefault=sys.argv[1],sys.argv[2],sys.argv[3]=='1'
d=json.load(open(p)); now=datetime.datetime.utcnow().isoformat()+'Z'
ids=[]
def add(path,title):
    i=str(uuid.uuid4()); d['tables']['workspaces'][i]={'path':path,'title':title,'sessionIds':[],'createdAt':now,'updatedAt':now}; ids.append(i); return i
add(E+'/work/proj','proj')
if withDefault:
    d['global']['defaultWorkspaceId']=add(E+'/docs/deepseek-harness/default-workspace','default-workspace')
d['global']['workspaceIds']=ids
json.dump(d,open(p,'w'))
