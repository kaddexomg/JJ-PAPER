/*
  ============================================================
  JJ Paper — Corrección de CARTERA con datos REALES de MixNet
  ------------------------------------------------------------
  Compara la cartera del CRM (clientes por zona de vendedor)
  contra el CSV de clientes extraído de MixNet (datos reales:
  RIF, teléfono). Para cada cliente de la cartera con match en
  MixNet, corrige el RIF (real) y el teléfono (real), y fija
  city="Caracas". Conserva TODOS los clientes de la cartera.

  ENTRADA:
    CLIENTES/clientes_importables_zonas.csv   (cartera del CRM)
    wa-server/clientes_mixnet_<fecha>.csv     (extraído de MixNet)

  SALIDA:
    CLIENTES/cartera_corregida_mixnet.csv
    Columnas: name, phone, zone, rif, city, email, address, notes
    · address: dirección real de MixNet (direc 1..4 concatenadas)
    · notes:   observaciones de MixNet (si hay)

  Uso:
    node corregir_cartera_mixnet.cjs
  ============================================================
  Compatible con Node 13+. 2026-09-01
  ============================================================
*/
'use strict';
const fs=require('fs');
const path=require('path');
const __this=__dirname;

const MIX=path.join(__this,'wa-server','clientes_mixnet_20263108_1529.csv');
const CAR=path.join(__this,'CLIENTES','clientes_importables_zonas.csv');
const OUT=path.join(__this,'CLIENTES','cartera_corregida_mixnet.csv');

function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();}
function parseCSV(text){const rows=[];let row=[],cur='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(q&&text[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){row.push(cur);cur='';}else if((ch==='\n'||ch==='\r')&&!q){if(cur!==''||row.length){row.push(cur);rows.push(row);}cur='';row=[];if(ch==='\r'&&text[i+1]==='\n')i++;}else cur+=ch;}if(cur!==''||row.length){row.push(cur);rows.push(row);}return rows;}

function extractPhoneAny(v){
  if(v==null)return'';
  const m=String(v).match(/(?:\d[\d.\-\/\s]*){6,}\d/);
  if(!m)return'';
  if(m[0].replace(/\D/g,'').length<7)return'';
  return m[0].trim();
}
function bestPhone(cands){
  let best='',bestD=0;
  for(const c of cands){const t=extractPhoneAny(c);if(!t)continue;const d=t.replace(/\D/g,'').length;if(d>=7&&d>bestD){best=t;bestD=d;}}
  return best;
}

const mix=parseCSV(fs.readFileSync(MIX,'utf8'));
const mh=mix[0];
const mName=mh.findIndex(h=>/^nomclih/i.test(h));
const mRif=mh.findIndex(h=>/^cifoih/i.test(h));
const mTel1=mh.findIndex(h=>/^tlf1/i.test(h));
const mTel2=mh.findIndex(h=>/^tlf2/i.test(h));
const mTelP=mh.findIndex(h=>/^telefono_principal/i.test(h));
const mDirIdx=mh.map((h,i)=>(/^direc\d/i.test(h)?i:null)).filter(i=>i!==null).sort((a,b)=>a-b);
const mObs=mh.findIndex(h=>/^observa/i.test(h));

function buildAddress(r){
  const parts=(mDirIdx.map(i=>String(r[i]||'').trim())).filter(p=>p && !/^Z\.P/i.test(p));
  if(!parts.length)return'';
  return parts.join(', ').replace(/\s+/g,' ');
}

const mixByNorm={};
const mixList=[];
for(let i=1;i<mix.length;i++){
  const r=mix[i];
  const nm=String(r[mName]||'').trim();
  if(!nm)continue;
  const k=norm(nm);
  const entry={r:r,name:nm,k:k,tokens:k.split(' ').filter(w=>w.length>2),tel1:r[mTel1]||'',tel2:r[mTel2]||'',telP:r[mTelP]||'',rif:r[mRif]||'',address:buildAddress(r),obs:String(r[mObs]||'').trim().replace(/\s+/g,' ')};
  mixList.push(entry);
  if(!mixByNorm[k])mixByNorm[k]=entry;
}

const tokIndex={};
for(const e of mixList){
  for(const t of e.tokens.slice(0,5)){ if(!tokIndex[t])tokIndex[t]=[]; if(tokIndex[t].length<20)tokIndex[t].push(e); }
}

function fuzzyFind(carName){
  const ck=norm(carName);
  if(mixByNorm[ck])return mixByNorm[ck];
  const q=ck.split(' ').filter(w=>w.length>2 && !/^\d+$/.test(w));
  if(q.length<2)return null;
  const cand={};
  for(const t of q.slice(0,3)){ const list=tokIndex[t]||[]; for(const e of list){ if(!cand[e.k])cand[e.k]={e:e,hits:0}; } }
  const qq=q.slice(0,4);
  for(const key in cand){
    const c=cand[key];
    const et=c.e.tokens;
    let hits=0;
    for(let i=0;i<qq.length;i++){
      let found=false;
      for(let j=0;j<et.length;j++){
        if(et[j]===qq[i]||et[j].indexOf(qq[i])!==-1||qq[i].indexOf(et[j])!==-1){found=true;break;}
      }
      if(found)hits++;
    }
    c.hits=hits/Math.max(qq.length,1);
  }
  let best=null,bestScore=0;
  for(const key in cand){
    const c=cand[key];
    if(c.hits>=0.5 && c.hits>bestScore){bestScore=c.hits;best=c.e;}
  }
  return best;
}

const car=parseCSV(fs.readFileSync(CAR,'utf8'));
const ch=car[0];
const cols=['name','phone','zone','rif','city','email','address','notes'];
const cIdx={};for(let i=0;i<ch.length;i++)cIdx[ch[i].trim().toLowerCase()]=i;

let corregidos=0,sinMatch=0;
const sinMatchNames=[];
const rowOut=[cols.join(',')];

for(let i=1;i<car.length;i++){
  const r=car[i];
  const name=String(r[cIdx.name]||'').trim();
  if(!name)continue;
  const zone=String(r[cIdx.zone]||'').trim();
  const email=String(r[cIdx.email]||'').trim();
  const oldPhone=String(r[cIdx.phone]||'').trim();
  const oldRif=String(r[cIdx.rif]||'').trim();

  const match=fuzzyFind(name);
  let newPhone,newRif=oldRif,newAddress='',newNotes='';
  if(match){
    corregidos++;
    newRif=match.rif||oldRif;
    newPhone=bestPhone([match.tel1,match.tel2,match.telP])||extractPhoneAny(oldPhone)||oldPhone;
    newAddress=match.address||'';
    newNotes=match.obs||'';
  }else{
    sinMatch++;
    newPhone=extractPhoneAny(oldPhone)||oldPhone;
    if(sinMatchNames.length<40)sinMatchNames.push(name);
  }
  let line=[];
  for(const col of cols){
    let v=col==='name'?name:col==='phone'?newPhone:col==='zone'?zone:col==='rif'?newRif:col==='city'?'Caracas':col==='email'?email:col==='address'?newAddress:newNotes;
    if(/[",\n\r]/.test(String(v)))v='"'+String(v).replace(/"/g,'""')+'"';
    line.push(v);
  }
  rowOut.push(line.join(','));
}

console.log('Cartera:',car.length-1,'Con match:',corregidos,'Sin match:',sinMatch);
console.log('--- Sin match ---');sinMatchNames.forEach(n=>console.log('  - '+n));
fs.writeFileSync(OUT,rowOut.join('\r\n'),'utf8');
console.log('GENERADO:',OUT);
