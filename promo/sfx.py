import json, numpy as np, scipy.signal as sg, scipy.io.wavfile as wf, subprocess, sys
SR=44100; rnd=np.random.default_rng(3)
D_VIDEO=24.935; DROP=93.2786; START=DROP-D_VIDEO
cues=json.load(open('cues.json')); TOTAL=58.2
N=int((TOTAL+3)*SR); L=np.zeros(N); R=np.zeros(N)
def env(n,a,d): t=np.arange(n)/SR; return np.minimum(1,t/max(a,1e-4))*np.exp(-t/d)
def bp(x,lo,hi,o=2): b,a=sg.butter(o,[lo/(SR/2),hi/(SR/2)],'band'); return sg.lfilter(b,a,x)
def hp(x,f,o=2): b,a=sg.butter(o,f/(SR/2),'high'); return sg.lfilter(b,a,x)
def lp(x,f,o=2): b,a=sg.butter(o,f/(SR/2),'low'); return sg.lfilter(b,a,x)
def tone(f,n,kind='sin'):
    ph=2*np.pi*np.cumsum(np.broadcast_to(f,(n,)))/SR
    if kind=='sin': return np.sin(ph)
    if kind=='tri': return 2/np.pi*np.arcsin(np.sin(ph))
    if kind=='saw': return 2*((ph/(2*np.pi))%1)-1
def ir(sec=2.2,dec=.7):
    n=int(sec*SR); t=np.arange(n)/SR; x=rnd.standard_normal(n)*np.exp(-t/dec); return lp(x,6000)/np.sqrt(np.sum(x**2))
IR=ir()
def verb(x,wet=.3): y=sg.fftconvolve(x,IR)[:len(x)+len(IR)-1]; out=np.zeros(len(y)); out[:len(x)]+=x*(1-wet); return out+y*wet*3
def put(t,x,g=1.,pan=0.):
    i=int(t*SR); 
    if i<0: x=x[-i:]; i=0
    x=x[:N-i]; L[i:i+len(x)]+=x*g*(1-pan)**.5*1.41/2**.5*0.71*1.41; R[i:i+len(x)]+=x*g*(1+pan)**.5*0.71
def click():
    n=int(.02*SR); a=hp(rnd.standard_normal(n),2500)*env(n,.0003,.0012)*.9+tone(3300,n)*env(n,.0001,.0025)*.5+tone(170,n)*env(n,.001,.008)*.35
    m=int(.1*SR); y=np.zeros(m); y[:n]+=a; y[int(.075*SR):int(.075*SR)+n]+=a*.45; return y
def flap():
    n=int(.03*SR); f=1000+rnd.random()*900
    return (bp(rnd.standard_normal(n),1500,6000)*env(n,.0002,.0018)*.8+tone(f,n)*env(n,.0002,.006)*.35+tone(260+rnd.random()*80,n)*env(n,.001,.01)*.25)*(.6+.4*rnd.random())
def tick():
    n=int(.015*SR); return hp(rnd.standard_normal(n),3000)*env(n,.0002,.0015)*.6+tone(2400,n)*env(n,.0001,.002)*.3
def pop():
    n=int(.12*SR); f=np.linspace(380,950,n)**1; f[int(.03*SR):]=950; return tone(f,n)*env(n,.002,.035)*.8
def womp():
    out=[]
    for f0,f1,d in [(330,300,.22),(262,175,.5)]:
        n=int(d*SR); f=np.linspace(f0,f1,n)*(1+.012*np.sin(2*np.pi*6*np.arange(n)/SR))
        x=tone(f,n,'saw'); x=lp(x,1400); e=np.minimum(1,np.arange(n)/(.02*SR))*np.minimum(1,(n-np.arange(n))/(.08*SR)); out.append(x*e*.5)
    return np.concatenate([out[0],np.zeros(int(.04*SR)),out[1]])
def stamp():
    n=int(.3*SR); f=np.linspace(120,45,n); return tone(f,n)*env(n,.001,.07)*1.0+lp(rnd.standard_normal(n),2500)*env(n,.0005,.02)*.6
def thump(): return stamp()*.8
def thud():
    n=int(.25*SR); f=np.linspace(160,60,n); return tone(f,n)*env(n,.001,.06)*.8+bp(rnd.standard_normal(n),300,3000)*env(n,.0005,.012)*.4
def noise_sweep(dur,f0,f1,amp_shape):
    n=int(dur*SR); x=rnd.standard_normal(n); out=np.zeros(n); blk=512; zi=None
    for i in range(0,n,blk):
        u=i/n; fc=f0*(f1/f0)**u; lo,hi=fc/1.6,min(fc*1.6,20000)
        b,a=sg.butter(2,[lo/(SR/2),hi/(SR/2)],'band')
        if zi is None: zi=sg.lfilter_zi(b,a)*0
        out[i:i+blk],zi=sg.lfilter(b,a,x[i:i+blk],zi=zi)
    return out*amp_shape(np.linspace(0,1,n))
def whoosh(dur=1.25):
    return noise_sweep(dur,250,4500,lambda u:np.sin(np.pi*u**.7)**2)*2.2
def swoosh(dur=.45): return noise_sweep(dur,500,5000,lambda u:np.sin(np.pi*u)**2)*1.6
def swish(dur=.25): return noise_sweep(dur,1200,7000,lambda u:np.sin(np.pi*u)**2)*1.2
def riser(dur): return noise_sweep(dur,300,9000,lambda u:u**2.2)*1.6
NOTE={'C5':523.25,'E5':659.25,'G5':783.99,'A5':880,'C6':1046.5,'E6':1318.5,'G6':1568,'B5':987.77,'D6':1174.7}
def bell(f,d=.9,a=.5):
    n=int(d*SR); x=sum(w*tone(f*m,n)*env(n,.001,d*k) for m,w,k in [(1,1,.35),(2.0,.35,.2),(3.01,.2,.12),(4.2,.1,.08)]); return x*a
def ding(n='G5'): return verb(bell(NOTE[n]),.35)*.55
def sparkle():
    out=np.zeros(int(1.6*SR))
    for i,nn in enumerate(['C6','E6','G6','D6','B5','G6']):
        b=bell(NOTE[nn]*1.0,.7,.25); j=int(i*.065*SR); out[j:j+len(b)]+=b
    return verb(out,.45)[:int(2.2*SR)]*.6
def choir(dur):
    n=int(dur*SR); t=np.arange(n)/SR; out=np.zeros(n)
    for f in [130.81,196.0,261.63,329.63,392.0,493.88,587.33]:
        for c in (-9,-3,4,10):
            ff=f*2**(c/1200)*(1+.004*np.sin(2*np.pi*(4.8+rnd.random())*t+rnd.random()*6))
            out+=tone(ff,n,'saw')*(1 if f<500 else .7)
    v=sum(bp(out,f*.85,f*1.15,2)*g for f,g in [(730,1),(1090,.6),(2440,.35)])+lp(out,500)*.25
    v+=hp(rnd.standard_normal(n),4000)*.02
    e=np.minimum(1,t/1.2)**1.5*(0.55+0.45*np.minimum(1,t/dur)**1.3); e*=np.minimum(1,(n-np.arange(n))/(.05*SR))
    v=v*e; v/=np.max(np.abs(v))+1e-9
    shim=np.zeros(n)
    for k in range(18):
        b=bell(NOTE[['C6','E6','G6','B5','D6'][k%5]]*2,1.2,.12); j=int((.6+k*(dur-1.2)/18+.1*rnd.random())*SR); shim[j:j+len(b)]+=b[:n-j]
    return verb(v*.5+shim,.4)
def boom():
    n=int(1.0*SR); f=np.linspace(70,38,n); return tone(f,n)*env(n,.002,.28)*.9+lp(rnd.standard_normal(n),1800)*env(n,.001,.05)*.5
def drop3d(): return thud()*.8+swish(.3)[:int(.25*SR)].sum()*0+np.pad(swish(.3)*.4,(0,int(.25*SR)))[:int(.25*SR)]*0

G={'click':.55,'flap':.16,'tick':.3,'pop':.35,'womp':.42,'stamp':.6,'thump':.5,'thud':.45,'whoosh':.5,'swoosh':.3,'swish':.3,'riser':.18,'ding':.5,'sparkle':.45,'choir':.7,'boom':.7,'drop3d':.5}
for c in cues:
    t=c['t']; ty=c['type']; g=G.get(ty,.4)*c.get('g',1); pan=0
    if ty=='flap': x=flap(); pan=rnd.uniform(-.6,.6)
    elif ty=='click': x=click()
    elif ty=='tick': x=tick()
    elif ty=='pop': x=pop()
    elif ty=='womp': x=womp()
    elif ty=='stamp': x=stamp()
    elif ty=='thump': x=thump()
    elif ty=='thud': x=thud()
    elif ty=='drop3d': x=thud()
    elif ty=='whoosh': x=whoosh(c.get('dur',1.25))
    elif ty=='swoosh': x=swoosh()
    elif ty=='swish': x=swish()
    elif ty=='riser': x=riser(c['dur'])
    elif ty=='ding': x=ding(c.get('n','G5'))
    elif ty=='sparkle': x=sparkle()
    elif ty=='choir': x=choir(c['dur'])
    elif ty=='boom': x=boom()
    else: continue
    put(t,x,g,pan)
sfx=np.stack([L,R],1)[:int(TOTAL*SR)]
wf.write('sfx.wav',SR,(np.clip(sfx,-1,1)*32767).astype(np.int16))
print('sfx peak',np.abs(sfx).max())
