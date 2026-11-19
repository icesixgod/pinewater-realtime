import * as THREE from './three.module.js';

const sources = [
  {name:'TERREX_FAST_X_GTX',author:'Google LLC',copyright:'2020 Google LLC',license:'CC BY 4.0',url:'https://app.gazebosim.org/GoogleResearch/fuel/models/TERREX_FAST_X_GTX',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},
  {name:'Denim Fabric',author:'Rob Tuytel, Poly Haven',license:'CC0',url:'https://polyhaven.com/a/denim_fabric',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'},
  {name:'Denim Fabric 04',author:'colormass and Rico Cilliers, Poly Haven',license:'CC0',url:'https://polyhaven.com/a/denim_fabric_04',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'}
];
const at = name => new URL(`./art/walker-${name}`,import.meta.url).href;
const TAU=2*Math.PI, rings=57, sides=40, stride=sides+1;
const hipWidth=.202,hipDepth=.112;
const clamp01=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp01(x);return x*x*(3-2*x);};
const ridge=(d,w)=>Math.exp(-Math.pow(d/w,2));
const arclength=[0,.025,.11,.23,.36,.49,.56,.70,.84,1];
const lateralWidth=[.058,.059,.054,.058,.066,.071,.073,.080,.093,.104];
const foreAftWidth=[.064,.065,.060,.061,.069,.072,.077,.087,.097,.109];
const angle=Array.from({length:stride},(_,j)=>{const a=j/sides*TAU;return {a,x:Math.cos(a),z:Math.sin(a)};});
const ringRecords=Array.from({length:rings+1},(_,i)=>{
  const t=i/rings;let k=0;while(k<arclength.length-2&&t>arclength[k+1])k++;
  const blend=smooth((t-arclength[k])/(arclength[k+1]-arclength[k]));
  return {t,rx:THREE.MathUtils.lerp(lateralWidth[k],lateralWidth[k+1],blend),rz:THREE.MathUtils.lerp(foreAftWidth[k],foreAftWidth[k+1],blend)};
});

async function scannedShoe(){
  const response=await fetch(at('boot.bin'));
  if(!response.ok)throw Error(`Shoe scan ${response.status}`);
  const bytes=await response.arrayBuffer(), header=new DataView(bytes);
  if(header.getUint32(0,false)!==0x53484231)throw Error('Unknown shoe scan format');
  const count=header.getUint32(4,true), indexCount=header.getUint32(8,true);
  let offset=12;
  function take(Type,length){
    const a=new Type(bytes,offset,length);
    offset=(offset+a.byteLength+3)&~3;
    return a;
  }
  const quantized=take(Int16Array,count*3), normals=take(Int8Array,count*3), uv=take(Uint16Array,count*2), indices=take(Uint16Array,indexCount);
  const pos=Float32Array.from(quantized,q=>q*.00001), geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3,true));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2,true));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  geometry.computeBoundingSphere();geometry.computeBoundingBox();
  return geometry;
}

function supportSurface(object,cell,skin){
  if(!object)return null;
  const geo=object.geometry, pos=geo.attributes.position, idx=geo.index?.array;
  const length=idx?.length??pos.count;
  const triangles=[], bins=new Map();
  const key=(x,z)=>x+32768+65536*(z+32768);
  function slot(x,z){return key(Math.floor(x/cell),Math.floor(z/cell));}
  for(let i=0;i<length;i+=3){
    const a=idx?idx[i]:i,b=idx?idx[i+1]:i+1,c=idx?idx[i+2]:i+2;
    const ax=pos.getX(a),ay=pos.getY(a),az=pos.getZ(a), bx=pos.getX(b),by=pos.getY(b),bz=pos.getZ(b), cx=pos.getX(c),cy=pos.getY(c),cz=pos.getZ(c);
    const u=bx-ax,v=bz-az,s=cx-ax,t=cz-az,det=u*t-s*v;
    if(Math.abs(det)<1e-11)continue;
    const tri=[ax,ay,az,u,v,s,t,by-ay,cy-ay,1/det];
    const index=triangles.push(tri)-1;
    for(let iz=Math.floor(Math.min(az,bz,cz)/cell);iz<=Math.floor(Math.max(az,bz,cz)/cell);iz++){
      for(let ix=Math.floor(Math.min(ax,bx,cx)/cell);ix<=Math.floor(Math.max(ax,bx,cx)/cell);ix++){
        const k=key(ix,iz), list=bins.get(k);if(list)list.push(index);else bins.set(k,[index]);
      }
    }
  }
  function height(x,z){
    const near=bins.get(slot(x,z));if(!near)return NaN;let best=-Infinity;
    for(let k=0;k<near.length;k++){
      const [ax,ay,az,u,v,s,t,hy,gy,id]=triangles[near[k]];
      const px=x-ax,pz=z-az,bu=(px*t-s*pz)*id,bv=(u*pz-px*v)*id;
      if(bu<-.000001||bv<-.000001||bu+bv>1.000001)continue;
      best=Math.max(best,ay+hy*bu+gy*bv);
    }
    return Number.isFinite(best)?best:NaN;
  }
  return {object,height,skin};
}

function shoePressure(source,shoe,surfaces){
  const initial=source.attributes.position.array;
  const geometry=source.clone(),points=geometry.getAttribute('position');points.setUsage(THREE.DynamicDrawUsage);shoe.geometry=geometry;
  const lug=[];for(let i=0;i<points.count;i++)if(initial[3*i+1]<.023)lug.push(i);
  const heights=new Float32Array(lug.length),cacheMatrix=new Float64Array(16);
  const W=new THREE.Matrix4(),L=new THREE.Matrix4(),inv=new THREE.Matrix4(),origin=new THREE.Vector3(),up=new THREE.Vector3(),localUp=new THREE.Vector3();
  const scale=new THREE.Vector3(shoe.scale.x,1,1),move=new THREE.Vector3();let prior=-1,cacheSurface;
  function choose(){
    let best=null,error=.036;
    for(const surf of surfaces){
      inv.copy(surf.object.matrixWorld).invert();origin.setFromMatrixPosition(W).applyMatrix4(inv);
      // Each test is a point-in-triangle downward ray. Side samples also bridge a longitudinal plank seam.
      const samples=[surf.height(origin.x,origin.z),surf.height(origin.x+.008,origin.z),surf.height(origin.x-.008,origin.z)];
      for(const h of samples){const gap=Math.abs(origin.y-h);if(gap<error){error=gap;best=surf;}}
    }
    return best;
  }
  function refresh(surf){
    const e=L.elements;let stable=surf===cacheSurface;
    for(let j=0;stable&&j<16;j++)if(Math.abs(e[j]-cacheMatrix[j])>.00002)stable=false;
    if(stable)return false;
    cacheMatrix.set(e);cacheSurface=surf;localUp.set(e[4],e[5],e[6]);
    for(let i=0;i<lug.length;i++){
      const p=3*lug[i],x=initial[p],z=initial[p+2];let h=0;
      if(surf){
        const bx=e[0]*x+e[8]*z+e[12],by=e[1]*x+e[9]*z+e[13],bz=e[2]*x+e[10]*z+e[14];
        let y=surf.height(bx,bz);
        // The rubber bridges a narrow plank joint. A neighboring board supplies its continuing surface.
        if(!Number.isFinite(y)){
          const west=surf.height(bx-.005,bz),east=surf.height(bx+.005,bz);
          if(Number.isFinite(west)&&Number.isFinite(east))y=.5*(west+east);
          else y=Number.isFinite(west)?west:east;
        }
        if(Number.isFinite(y)&&localUp.y>.75)h=THREE.MathUtils.clamp((y-by)/localUp.y,-.029,.025);
      }
      heights[i]=h;
    }
    return true;
  }
  function set(leg){
    const load=clamp01(leg.load??0),compression=.0029*(-Math.expm1(-3.3*load))/.9631168326;
    up.set(0,1,0).applyQuaternion(leg.quaternion);move.copy(up).multiplyScalar(-compression);
    shoe.position.copy(leg.sole).add(move);shoe.quaternion.copy(leg.quaternion);
    if(load<.0001){
      if(prior>0){for(const j of lug)points.array[3*j+1]=initial[3*j+1];points.needsUpdate=true;}
      prior=0;return move;
    }
    W.compose(leg.sole,leg.quaternion,scale);const support=choose();
    if(support)L.multiplyMatrices(inv.copy(support.object.matrixWorld).invert(),W);else L.identity();
    const moved=refresh(support),skin=support?.skin??.000015;
    if(!moved&&Math.abs(compression-prior)<.000003)return move;
    for(let i=0;i<lug.length;i++){
      const k=3*lug[i]+1;
      // Leather and midsole follow the ankle. The measured rubber lugs flatten against the actual receiving triangles.
      points.array[k]=Math.max(initial[k],heights[i]+compression+skin);
    }
    points.needsUpdate=true;prior=compression;return move;
  }
  return {set};
}

function createCloth(side,material,relief){
  const sign=side==='left'?-1:1,phase=sign<0?.58:2.26;
  const total=rings*stride+stride, positions=new Float32Array(total*3), colors=new Float32Array(total*3), uv=new Float32Array(total*2), index=[];
  for(let i=0;i<=rings;i++)for(let j=0;j<=sides;j++){
    const k=i*stride+j;
    uv[k*2]=sign<0?.5-j/sides:j/sides;uv[k*2+1]=i/rings;
    if(i<rings && j<sides)index.push(k,k+stride,k+stride+1,k,k+stride+1,k+1);
  }
  const geometry=new THREE.BufferGeometry();
  const positionAttribute=new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage);
  const colorAttribute=new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',positionAttribute);geometry.setAttribute('color',colorAttribute);
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(index);
  const cloth=new THREE.Mesh(geometry,material);cloth.name=`${side} trouser leg`;cloth.frustumCulled=false;
  const ankle=new THREE.Vector3(), bend=new THREE.Vector3(), hip=new THREE.Vector3(), lower=new THREE.Vector3(), upper=new THREE.Vector3(), term=new THREE.Vector3();
  const entry=new THREE.Vector3(),exit=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3();
  const up=new THREE.Vector3(),sideVector=new THREE.Vector3(),back=new THREE.Vector3(),center=new THREE.Vector3(),footX=new THREE.Vector3();
  const storage=[];
  for(const row of ringRecords){
    const {t}=row, rowIndex=storage.length,cosSin=angle.map(({a:th,x,z},j)=>{
      const sinus=Math.sin, close = (c,w,theta)=>ridge(t-c,w)*theta;
      // Hiker's trousers bunch asymmetrically over the boot and shorten around the back of a bent knee.
      const cuffs=(.0035*close(.026+.007*sinus(th+phase),.012,1)+.0058*close(.065+.016*sinus(th+.7+phase),.017,.74+.26*x)-.0052*close(.092+.017*sinus(th*2+phase),.015,.76+.24*z)+.0068*close(.135+.024*sinus(th+phase),.024,.68-.29*x)-.0039*close(.171+.028*sinus(th+phase+.48),.024,.71+.28*z));
      const calf=.0040*close(.224+.046*sinus(th+phase+.8),.023,.57+.43*z)-.0044*close(.298+.05*sinus(th-.8+phase),.037,.68-.28*x);
      const knee=.0103*close(.430+.039*sinus(th+phase+1),.026,.4+.6*Math.max(0,z))-.0101*close(.467+.037*sinus(th+phase+.45),.020,.48+.52*Math.max(0,z))+.0100*close(.505+.034*sinus(th+phase-.6),.028,.45+.55*Math.max(0,z));
      const darts=.0076*close(.408+.054*sinus(th-.80+phase),.021,.5-.48*z)-.0056*close(.384+.049*sinus(th-.66+phase),.016,.48-.43*z)+.0052*close(.565+.056*sinus(th+phase+.8),.023,.6-.32*z);
      const crotch=.009*close(.704+.078*sinus(th+phase+.33),.030,.55-.40*z)-.0088*close(.739+.073*sinus(th+phase+.47),.027,.61-.32*z)+.0048*close(.818+.072*sinus(th+phase-.5),.033,.61+.21*x);
      const thigh=.0055*close(.62+.065*sinus(th+phase),.037,.65+.35*x)-.0048*close(.735+.066*sinus(th+phase+.9),.035,.74+.19*z)+.0032*close(.808+.069*sinus(th+phase),.044,.8-.2*x);
      const vertical=(.0027*Math.cos(th*5+phase+t*5)+.0015*Math.sin(th*7-phase-t*5.6))*(.48+.5*Math.cos(t*TAU));
      const hemShade=1-.13*ridge(t-.003,.018);
      const patternColumn=sign<0?(sides*1.5-j)%sides:j%sides;
      const scannedFold=relief[rowIndex*sides+patternColumn]*.0001;
      return {wrinkle:cuffs*1.18+calf*1.2+thigh+vertical+darts+scannedFold,knee,crotch,hemShade,hemY:(.0035*sinus(th+phase)+.003*sinus(2*th+phase))*Math.exp(-t*18)};
    });storage.push(cosSin);
  }
  function setPose(leg,pelvisX,pelvisBack,pelvisOrigin,compressionOffset){
    ankle.copy(leg.ankle).add(compressionOffset);bend.copy(leg.knee);hip.copy(leg.hip);
    lower.copy(bend).sub(ankle).normalize();upper.copy(hip).sub(bend).normalize();
    const flex=clamp01((1-lower.dot(upper))*.95);
    term.copy(hip).addScaledVector(upper,.006);
    entry.copy(bend).lerp(ankle,.23);exit.copy(bend).lerp(term,.23);
    footX.set(1,0,0).applyQuaternion(leg.quaternion);
    for(let i=0;i<=rings;i++){
      const {t,rx,rz}=ringRecords[i], kneeT=.453,lo=kneeT*.77,hi=kneeT+(1-kneeT)*.23;
      if(t<lo){center.copy(ankle).lerp(entry,t/lo);up.copy(lower);}
      else if(t>hi){center.copy(exit).lerp(term,(t-hi)/(1-hi));up.copy(upper);}
      else{
        const q=(t-lo)/(hi-lo);a.copy(entry).lerp(bend,q);b.copy(bend).lerp(exit,q);
        center.copy(a).lerp(b,q);up.copy(b).sub(a).normalize();
      }
      sideVector.copy(footX).lerp(pelvisX,smooth((t-.07)/.76));sideVector.addScaledVector(up,-sideVector.dot(up)).normalize();
      back.crossVectors(sideVector,up).normalize();
      // The calf's fleshy/layered side lies behind the ankle–knee axis.
      center.addScaledVector(back,.0115*ridge(t-.25,.14)-.006*ridge(t-.50,.17));
      const load=clamp01(leg.load??.5), join=smooth((t-.70)/.30);
      for(let j=0;j<=sides;j++){
        const {x,z}=angle[j], p=(i*stride+j)*3, record=storage[i][j];
        const wrinkle=record.wrinkle+record.knee*(.70+flex*1.91)+record.crotch*(.66+flex*.78), shrink=1-(.023*load*ridge(t-.1,.11));
        const front=Math.max(0,-z),kneecap=ridge(t-.468,.07);
        const profileX=Math.sign(x)*Math.pow(Math.abs(x),1-.17*kneecap);
        const profileZ=Math.sign(z)*Math.pow(Math.abs(z),1-.14*kneecap);
        const sx=profileX*(rx+wrinkle)*shrink;
        const sz=profileZ*(rz+wrinkle)-.0085*kneecap*front**3+.0032*ridge(t-.332,.055)*front**2;
        const dy=record.hemY;
        positions[p]=center.x+sideVector.x*sx+back.x*sz+up.x*dy;
        positions[p+1]=center.y+sideVector.y*sx+back.y*sz+up.y*dy;
        positions[p+2]=center.z+sideVector.z*sx+back.z*sz+up.z*dy;
        if(join>0){
          const medial=Math.max(0,-sign*x),outer=sign*x>0?x:0;
          const px=hipWidth*outer,pz=hipDepth*z;
          const wy=pelvisOrigin.y+(t-1)*.80-.136*medial**.82;
          positions[p]=THREE.MathUtils.lerp(positions[p],pelvisOrigin.x+pelvisX.x*px+pelvisBack.x*pz,join);
          positions[p+1]=THREE.MathUtils.lerp(positions[p+1],wy,join);
          positions[p+2]=THREE.MathUtils.lerp(positions[p+2],pelvisOrigin.z+pelvisX.z*px+pelvisBack.z*pz,join);
        }
        const inner=Math.max(0,-x*sign), occlusion=1-.18*inner**3*smooth((t-.63)/.30);
        const value=(.96+THREE.MathUtils.clamp(wrinkle*8,-.11,.065))*occlusion*record.hemShade;
        colors[p]=value;colors[p+1]=value;colors[p+2]=value;
      }
    }
    positionAttribute.needsUpdate=true;colorAttribute.needsUpdate=true;geometry.computeVertexNormals();
    const normals=geometry.attributes.normal, ns=normals.array;
    for(let i=0;i<=rings;i++){
      const first=3*i*stride,last=first+sides*3;
      a.set(ns[first]+ns[last],ns[first+1]+ns[last+1],ns[first+2]+ns[last+2]).normalize();
      a.toArray(ns,first);a.toArray(ns,last);
    }
    normals.needsUpdate=true;
  }
  return {cloth,setPose};
}

function createYoke(material){
  // The medial upper-leg edges meet along the same curved crotch seam. The remaining
  // two outer half-rings form the lower edge of the single seat and waistband.
  const heights=[0,.023,.052,.082,.112,.145,.181,.214,.220], n=heights.length;
  const count=n*stride+1, pos=new Float32Array(count*3), colors=new Float32Array(count*3), uv=new Float32Array(count*2), indices=[];
  for(let i=0;i<n;i++)for(let j=0;j<=sides;j++){
    const k=i*stride+j;uv[k*2]=j/sides;uv[k*2+1]=.64+heights[i]*1.48;
    const shade=i>=n-2?.83:.95;colors.set([shade,shade,shade],k*3);
    if(i<n-1&&j<sides)indices.push(k,k+stride,k+stride+1,k,k+stride+1,k+1);
    if(i===n-1&&j<sides)indices.push(k,count-1,k+1);
  }
  colors.set([.58,.58,.58],(count-1)*3);uv.set([.5,.8],(count-1)*2);
  const geo=new THREE.BufferGeometry(), p=new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position',p);geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(indices);
  const mesh=new THREE.Mesh(geo,material);mesh.name='Continuous trouser seat and waistband';mesh.frustumCulled=false;
  function setPose(o,across,back){
    for(let i=0;i<n;i++){
      const h=heights[i],weight=h/.220, taper=smooth(weight),sweep=.095*taper;
      const hw=hipWidth-.031*taper,hd=hipDepth-.021*taper;
      for(let j=0;j<=sides;j++){
        const v=angle[j], k=(i*stride+j)*3;
        const seam=(i===0?0:.0027*Math.cos(v.a*7+.8)*Math.sin(taper*Math.PI));
        const x=(hw+seam)*v.x,z=sweep+(hd+seam)*v.z;
        pos[k]=o.x+across.x*x+back.x*z;pos[k+1]=o.y+h;pos[k+2]=o.z+across.z*x+back.z*z;
      }
    }
    pos.set([o.x+back.x*.095,o.y+.221,o.z+back.z*.095],(count-1)*3);
    p.needsUpdate=true;geo.computeVertexNormals();
  }
  return {mesh,setPose};
}

export async function buildWalker(ctx){
  const group=new THREE.Group();group.name='First-person walking legs';group.visible=false;
  const loader=new THREE.TextureLoader(),[geometry,scan,weave,weaveNormal,relief]=await Promise.all([
    scannedShoe(),loader.loadAsync(at('boot.webp')),loader.loadAsync(at('weave.webp')),loader.loadAsync(at('weave-normal.webp')),
    fetch(at('drape.bin')).then(async response=>{
      if(!response.ok)throw Error(`Trouser height field ${response.status}`);
      const field=new Int8Array(await response.arrayBuffer());
      if(field.length!==(rings+1)*sides)throw Error('Invalid trouser height field');
      return field;
    })
  ]);
  for(const tex of [scan,weave,weaveNormal])tex.anisotropy=Math.min(8,ctx.renderer?.capabilities.getMaxAnisotropy()??4);
  scan.colorSpace=THREE.SRGBColorSpace;weave.colorSpace=THREE.SRGBColorSpace;
  weave.wrapS=THREE.RepeatWrapping;weaveNormal.wrapS=THREE.RepeatWrapping;
  const bootMaterial=new THREE.MeshStandardMaterial({map:scan,roughness:.87,metalness:0});
  const fabric=new THREE.MeshStandardMaterial({map:weave,normalMap:weaveNormal,normalScale:new THREE.Vector2(.49,.49),roughness:.97,metalness:0,vertexColors:true,side:THREE.DoubleSide});
  const surfaces=[
    supportSurface(ctx.scene?.getObjectByName('Open footwell and longitudinal floorboards'),.045,.000015),
    supportSurface(ctx.scene?.getObjectByName('58 separate worn planks, registered upper faces'),.034,.00022)
  ].filter(Boolean);
  const legs={};
  for(const side of ['left','right']){
    const shoe=new THREE.Mesh(geometry,bootMaterial);shoe.name=`${side} scanned trail shoe`;
    if(side==='right')shoe.scale.x=-1;
    const leg=createCloth(side,fabric,relief),pressure=shoePressure(geometry,shoe,surfaces);legs[side]={shoe,pressure,...leg};group.add(shoe,leg.cloth);
  }
  const yoke=createYoke(fabric);group.add(yoke.mesh);
  ctx.scene?.add(group);const pelvisX=new THREE.Vector3(),pelvisBack=new THREE.Vector3(),pelvisOrigin=new THREE.Vector3();
  function update(pose){
    group.visible=Boolean(pose?.left && pose?.right);if(!group.visible)return;
    pelvisX.copy(pose.right.hip).sub(pose.left.hip);pelvisX.y=0;pelvisX.normalize();
    pelvisOrigin.copy(pose.left.hip).lerp(pose.right.hip,.5);pelvisBack.set(-pelvisX.z,0,pelvisX.x);yoke.setPose(pelvisOrigin,pelvisX,pelvisBack);
    for(const name of ['left','right']){const leg=pose[name],view=legs[name];
      const settle=view.pressure.set(leg);view.setPose(leg,pelvisX,pelvisBack,pelvisOrigin,settle);
    }
  }
  const dimensions={length:.263,width:.09960,height:.13239,ankle:new THREE.Vector3(0,.084,.062)};
  group.userData.credits=sources;group.userData.dimensions=dimensions;
  return {group,update,dimensions,credits:sources,ready:Promise.resolve()};
}
