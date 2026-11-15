import struct,zlib,sys
d=open(sys.argv[1],'rb').read()
fn,ex=struct.unpack('<HH',d[26:30]);body=d[30+fn+ex:]
raw=zlib.decompressobj(-15).decompress(body)
nrec,hl,rl=struct.unpack('<IHH',raw[4:12])
fields=[];p=32
while raw[p]!=0x0D:
    f=raw[p:p+32];fields.append((f[:11].split(b'\0')[0].decode(),chr(f[11]),f[16]));p+=32
print('records',nrec,'recordlen',rl)
print('fields',[(a,b,c) for a,b,c in fields])
idx={n:i for i,(n,_,_) in enumerate(fields)}
offs=[];o=1
for n,t,l in fields: offs.append((o,l));o+=l
import statistics
vals=[];empty=0
for r in range(nrec):
    rec=raw[hl+r*rl:hl+(r+1)*rl]
    o,l=offs[idx['UN_VOL_AV']];s=rec[o:o+l].decode('latin1').strip()
    if s:
        try: vals.append(float(s))
        except: empty+=1
    else: empty+=1
print('UN_VOL_AV non-empty',len(vals),'empty/invalid',empty)
vals.sort()
print('min',vals[0],'median',statistics.median(vals),'max',vals[-1],'zero count',sum(1 for v in vals if v==0))
