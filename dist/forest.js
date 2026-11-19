import * as THREE from './three.module.js';
import {buildMountainBasin} from './mountain-basin.js';
import {buildForestVolumes} from './art/forest-volume.js';
import {firstCrownField} from './art/forest-first-field.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (lo, hi, val) => THREE.MathUtils.smoothstep(val, lo, hi);
const mix = THREE.MathUtils.lerp;
const vec = (x,y,z) => new THREE.Vector3(x,y,z);

function surface(nx, ny, point) {
  const xyz = [], uv = [], index = [];
  for (let y=0; y<=ny; y++) for (let x=0; x<=nx; x++) {
    const u=x/nx, v=y/ny, p=point(u,v);
    xyz.push(p.x,p.y,p.z); uv.push(u,1-v);
    if (x<nx && y<ny) {
      const a=y*(nx+1)+x, b=a+nx+1;
      index.push(a,b,a+1,b,b+1,a+1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index); return g;
}

function generator(seed) {
  return () => {
    seed += 0x6D2B79F5;
    let t = Math.imul(seed^(seed>>>15),1|seed);
    t ^= t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

export function buildForest(ctx) {
  const {scene,atD,pix,groundY}=ctx, random=generator(68153);
  const assembly = new THREE.Group(); assembly.name='Alpine basin and shore pines'; scene.add(assembly);
  const loader=new THREE.TextureLoader();
  function mat(path,alpha=0) {
    const t=loader.load('./art/'+path);
    t.colorSpace=THREE.SRGBColorSpace;
    t.anisotropy=Math.min(8,ctx.renderer?.capabilities.getMaxAnisotropy()||4);
    return new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide,alphaTest:alpha,alphaToCoverage:alpha>0,toneMapped:false});
  }
  function make(g,m,name) { const obj=new THREE.Mesh(g,m);obj.name=name;assembly.add(obj);return obj; }
  const panorama=mat('forest-basin.jpg');
  const mountains=buildMountainBasin(ctx,assembly,panorama.map);
  const cedar=mat('forest-lodgepole.webp',.34), spruce=mat('forest-spruce.webp',.38),
    crown=mat('forest-old-pine.webp',.36), point=mat('forest-point.webp',.33), bark=mat('forest-bark.jpg');
  // Secondary woodland plates were baked locally from Poly Haven's CC0 Fir Tree 01
  // and Pine Tree 01 geometry under the scene's right-hand light, at nine azimuths.
  // The supplemental, unobserved basin uses Poly Haven's CC0 Alps Field panorama.
  const types=['fir1','fir2','pine1'].flatMap(family=>[0,1,2].map(k=>mat(`forest-${family}-${k}.webp`,.20)));
  const shaded=mat('forest-shaded-grove.webp',.026);
  for(const soft of [cedar,spruce,crown,point,shaded]) {
    soft.alphaToCoverage=false;soft.alphaTest=.025;soft.transparent=true;soft.depthWrite=true;
  }
  const heroTrunk=ctx.refTexture ? new THREE.MeshBasicMaterial({map:ctx.refTexture,side:THREE.DoubleSide,toneMapped:false}):bark;
  function projPatch(name,m,box,nx,ny,depth) {
    const [l,t,r,b]=box;
    return make(surface(nx,ny,(u,v)=>atD(mix(l,r,u),mix(t,b,v),depth(u,v))),m,name);
  }
  const chimneyGrove=mat('forest-chimney-grove.webp',.025);
  chimneyGrove.transparent=true;chimneyGrove.depthWrite=true;chimneyGrove.alphaToCoverage=false;
  const closerBough=mat('forest-chimney-bough.webp',.018);closerBough.transparent=true;closerBough.depthWrite=true;closerBough.alphaToCoverage=false;
  projPatch('Sun-facing whorls over the chimney gap',closerBough,[126,103,267,307],18,21,(u,v)=>12.0+.86*Math.sin(u*9.3+v*5.3)+.48*Math.sin(u*7.0-v*10.5));
  projPatch('Needles through the chimney-side gap',chimneyGrove,[126,103,267,307],17,22,(u,v)=>22.1+3.4*u-.61*Math.sin(u*8.1+v*4.3)+.44*Math.cos(u*11.4-v*6.2));
  const firstMats=[];const depthBytes=Uint8Array.from(atob(firstCrownField.d),x=>x.charCodeAt(0));const crownDepths=new Uint16Array(depthBytes.buffer);
  for(const [id,lo,hi] of [[0,8.85,13.4],[1,11.5,24.6],[2,20.1,43.]]){
    const m=mat('forest-first-whorls-'+id+'.webp',.022);m.transparent=true;m.alphaToCoverage=false;m.depthWrite=true;m.userData.sourceOnlyNeedles=true;firstMats.push(m);
    projPatch('Original-view branch whorls in depth range '+id,m,[0,0,267,261],53,52,(u,v)=>{
      const i=Math.min(firstCrownField.nx-1,Math.round(u*53)),j=Math.min(firstCrownField.ny-1,Math.round(v*52));
      return clamp(crownDepths[i+firstCrownField.nx*j]/256,lo,hi);
    });
  }
  [shaded,chimneyGrove,closerBough].forEach(m=>{m.userData.sourceOnlyNeedles=true;});
  projPatch('Shade behind the old pine',shaded,[-80,145,176,481],14,16,(u,v)=>19.4+4.3*u+.51*Math.sin(u*26+v*3)+.27*Math.cos(v*13+u*4));
  cedar.userData.highPineSource=true;
  projPatch('Lodgepole beyond the chimney',cedar,[214,20,390,469],12,15,(u,v)=>21.8-.68*Math.sin(Math.PI*u)*Math.sin(Math.PI*v)+.19*Math.sin(u*12+v*19));
  projPatch('Second pine behind the roof',spruce,[365,132,477,473],10,13,(u,v)=>25.1-.48*Math.sin(Math.PI*u)*Math.sin(Math.PI*v)+.18*Math.sin(u*13+v*20));
  projPatch('Point grove beyond the veranda',point,[444,256,662,477],42,12,(u,v)=>{
    const depth=26 + 30*u + 2.15*Math.sin(19*u+.5) + 1.05*Math.sin(35*u);
    return depth-.52*Math.sin(Math.PI*v)*(.3+Math.abs(Math.sin(7*Math.PI*u)));
  });
  const trunkDepth=10.85;
  // Boundaries of the near trunk surveyed in the source view. The rings have a
  // full round cross section. The high-resolution bark follows this surface.
  const contour=[[-187,84,98],[-100,76,97],[-1,77,96],[29,75,96],[75,75,95.5],[125,74,96.8],
    [178,73,95],[227,70,94],[272,69,93],[317,67,92],[363,64,91],[406,62,91],
    [449,60,92],[484,58,93],[505,56,94],[519,54,96],[527,53,99]];
  // A split bark strip widens the bole by 2–3 cm below the low bough.
  // The source resolves both the unlit western rim and the sunlit eastern rim.
  const barkRims=[[130,0,0],[137,-.6,0],[142,-2.1,0],[149,-2.8,0],[156,-3.0,0],
    [164,-2.4,0],[169,-1.0,0],[174,-.55,.3],[178,-.90,1.5],[183,-.85,2.2],
    [188,-.75,2.4],[193,-.30,.8],[200,0,0]];
  function profileAt(points,row){
    let k=0;while(k+1<points.length-1&&points[k+1][0]<row)k++;
    const a=points[k],b=points[k+1],part=clamp((row-a[0])/(b[0]-a[0]),0,1);
    return [mix(a[1],b[1],part),mix(a[2],b[2],part),k+part];
  }
  const rings=Array.from(new Set([...contour,...barkRims].map(v=>v[0]))).sort((a,b)=>a-b);
  const count=24,positions=[],texcoords=[],ix=[];
  for(let j=0;j<rings.length;j++){
    const row=rings[j],[a,b,phase]=profileAt(contour,row),[dl,dr]=profileAt(barkRims,row);
    const l=a+dl,r=b+dr,c=atD((l+r)/2,row,trunkDepth),cam=vec(-c.x,0,-c.z).normalize(),right=vec(cam.z,0,-cam.x);
    const radius=(atD(r,row,trunkDepth).x-atD(l,row,trunkDepth).x)*cam.z*.5;
    for(let i=0;i<=count;i++){
      const a=i/count*Math.PI*2,noise=1+.035*Math.sin(7*a+.25*phase)+.027*Math.sin(11*a-.21*phase);
      const p=c.clone().addScaledVector(cam,Math.cos(a)*radius*noise).addScaledVector(right,Math.sin(a)*radius*noise);
      const q=pix(p);
      positions.push(p.x,p.y,p.z);
      texcoords.push(clamp(q.x,0,974)/975,1-clamp(q.y,0,983)/984);
      if(j<rings.length-1&&i<count){ const k=j*(count+1)+i,b=k+count+1;ix.push(k,k+1,b,k+1,b+1,b); }
    }
  }
  const bole=new THREE.BufferGeometry();bole.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));bole.setAttribute('uv',new THREE.Float32BufferAttribute(texcoords,2));bole.setIndex(ix);
  make(bole,heroTrunk,'Foreground pine • calibrated three-dimensional bark cylinder');
  projPatch('Foreground pine • layered needle canopy',crown,[-148,-208,260,269],21,25,(u,v)=>{
    return trunkDepth+.32*Math.cos(u*6.8)-.93*Math.sin(v*35+u*7)*(.23+Math.abs(u-.55));
  });
  const mainBase=atD(77,524,trunkDepth),mainTop=atD(89,-185,trunkDepth);
  const sideCanopy=surface(9,11,(u,v)=>{
    const y=mix(atD(82,-199,trunkDepth).y,mainBase.y,v);
    const side=vec(-mainBase.x,0,-mainBase.z).normalize();
    return vec(mainBase.x+.13,y,mainBase.z).addScaledVector(side,(u-.56)*4.12);
  });
  make(sideCanopy,types[7],'Radial crown seen on return');
  // Small wood limbs reach into the photographed whorls. The needles retain
  // their irregular silhouette from the source. Branches on the far side grow
  // behind the bole, and become visible as the camera moves toward the canoe.
  const limbs=[];
  for(let i=0;i<55;i++){
    const from=atD(84+4*random(),-134+random()*308,trunkDepth),a=random()*Math.PI*2;
    const length=.42+random()*1.03;
    const to=from.clone().add(vec(Math.cos(a)*length,.1+random()*.35,Math.sin(a)*length));
    const gauge=.009+.012*random();
    // The source resolves these conspicuous boughs individually; the measured
    // branches below carry them. Reserve inferred wood for the unseen crown.
    if(pix(from.clone().lerp(to,.55)).y< -12)limbs.push([from,to,gauge]);
  }
  const surveyedArms=[
    [[87,36],[101,29],[117,27],[135,29],[153,30]],
    [[88,62],[105,57],[126,50],[149,47],[169,48],[190,42]],
    [[90,81],[104,77],[115,77],[130,80],[143,84]],
    [[91,99],[108,95],[126,93],[143,97],[160,108],[179,123]],
    [[92,121],[104,116],[119,110],[138,107],[151,106]],
    [[92,154],[109,146],[122,144],[139,144],[150,149]],
    [[83,59],[67,52],[52,50],[35,51]],[[82,98],[66,89],[49,83],[26,81]]
  ];
  const branchXYZ=[],branchUV=[],branchI=[];
  for(const [k,line] of surveyedArms.entries()){
    const curve=new THREE.CatmullRomCurve3(line.map(([x,y],i)=>atD(x,y,trunkDepth+.48*Math.sin(i/(line.length-1)*2.4+k*.71))));const size=13,n=7,start=branchXYZ.length/3;
    for(let i=0;i<=size;i++){
      const f=i/size,center=curve.getPoint(f),axis=curve.getTangent(f),right=axis.clone().cross(vec(0,1,0)).normalize(),normal=axis.clone().cross(right).normalize();
      const radius=(.002+.0145*(1-f)**1.28)*(k===2||k===4?.79:1);
      for(let j=0;j<=n;j++){const angle=2*Math.PI*j/n,p=center.clone().addScaledVector(right,radius*Math.cos(angle)).addScaledVector(normal,radius*Math.sin(angle));const q=pix(p);branchXYZ.push(p.x,p.y,p.z);branchUV.push(q.x/975,1-q.y/984);if(i<size&&j<n){const a=start+i*(n+1)+j,b=a+n+1;branchI.push(a,b,a+1,a+1,b,b+1);}}
    }
  }
  const branchGeo=new THREE.BufferGeometry();branchGeo.setAttribute('position',new THREE.Float32BufferAttribute(branchXYZ,3));branchGeo.setAttribute('uv',new THREE.Float32BufferAttribute(branchUV,2));branchGeo.setIndex(branchI);make(branchGeo,heroTrunk,'Foreground pine • surveyed jointed boughs');
  const limbMat=new THREE.MeshBasicMaterial({map:bark.map,color:0x94816a,toneMapped:false});
  const sticks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.66,1,1,6),limbMat,limbs.length);
  const up=vec(0,1,0),tmp=new THREE.Object3D();
  limbs.forEach(([a,b,r],i)=>{
    const d=b.clone().sub(a);tmp.position.copy(a).addScaledVector(d,.5);tmp.quaternion.setFromUnitVectors(up,d.clone().normalize());
    tmp.scale.set(r,d.length(),r);tmp.updateMatrix();sticks.setMatrixAt(i,tmp.matrix);
  });sticks.name='Raised and rear limbs of the foreground pine';assembly.add(sticks);
  // Each secondary pine has two concave faces and a three-dimensional trunk.
  // Trees are planted individually. Their crown ellipses have variable aspect,
  // azimuth, height and bark colour, particularly in the less observed west shore.
  function treeSurface() {
    const arr=[],uv=[],ind=[];
    for(let layer=0;layer<2;layer++){
      const nu=8,nv=9,start=arr.length/3,angle=layer*Math.PI*.47;
      const axis=vec(Math.cos(angle),0,-Math.sin(angle)),front=vec(Math.sin(angle),0,Math.cos(angle));
      for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
        const u=i/nu,v=j/nv,h=1-v,width=(u-.5)*.507*(layer?.79:1);
        const depth=(Math.sin(Math.PI*u)*.029+.009*Math.sin(u*8+v*15))*Math.sin(Math.PI*v);
        const p=axis.clone().multiplyScalar(width).addScaledVector(front,depth);arr.push(p.x,h,p.z);uv.push(u,1-v);
        if(i<nu&&j<nv){const k=start+j*(nu+1)+i,b=k+nu+1;ind.push(k,b,k+1,b,b+1,k+1);}
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);return g;
  }
  const trees=[];
  // Darker timber standing behind the cabin in the calibrated view. These rows
  // preserve clear sky through the upper whorls and solid shade below the eaves.
  for(let row=0;row<3;row++){
    for(let i=0;i<20;i++){
      const px=-205+i*34+(random()-.5)*30, d=36+row*8+random()*6;
      if(px>470)continue;
      const base=atD(px,458+random()*12,d);
      let head=179+random()*125+row*11;
      if(px>367)head+=56;
      if(px<160)head-=26;
      const top=atD(px,head,d);
      trees.push({base,h:top.y-base.y,w:.78+random()*.24,rot:(random()-.5)*.6,shade:.57+random()*.24});
    }
  }
  trees.push({base:atD(218,466,28.7),h:atD(218,180,28.7).y-atD(218,466,28.7).y,w:.82,rot:-.03,shade:.81});
  // Root the western and rear forest to the terrain; screen-space exclusion
  // preserves the original opening over the lake and the cabin's first silhouette.
  for(let i=0;i<370;i++){
    const x=-6.2-random()*63,z=-44+random()*82;
    const y=groundY(x,z),base=vec(x,Number.isFinite(y)?y:.7,z);
    if(base.y<.0) continue;
    const h=5.4+random()**.65*9.8;
    if(z<0){ const q=pix(base.clone().add(vec(0,h,0)));if(q.x>-45)continue; }
    trees.push({base,h,w:.8+random()*.35,rot:random()*Math.PI,shade:.58+random()*.39});
  }
  for(let i=0;i<30;i++){
    const z=-1+random()*24,x=-2.7-random()*6;
    if(z<0&&x>-4.8)continue;
    const y=groundY(x,z);
    if(!Number.isFinite(y)||y<.1)continue;
    trees.push({base:vec(x,y,z),h:5.4+random()*5,w:.83+random()*.26,rot:random()*Math.PI,shade:.7+random()*.22});
  }
  for(const [px,d,head] of [[-48,17,98],[17,22,157],[53,25,163],[113,24,181],[137,22,162],[166,25,201],[192,24,224]]) {
    const base=atD(px,474,d),top=atD(px,head,d);trees.push({base,h:top.y-base.y,w:.92+random()*.19,rot:random()*.51,shade:.81+random()*.15});
  }
  const volumes=buildForestVolumes(ctx,assembly,trees,[cedar,spruce,crown,point,shaded,chimneyGrove,closerBough,...firstMats],types);
  for(let i=trees.length-1;i>=0;i--)if(volumes.replaced.has(trees[i]))trees.splice(i,1);
  const twig=treeSurface(),woodCyl=new THREE.CylinderGeometry(.55,1,1,7),trunks=new THREE.InstancedMesh(woodCyl,bark,trees.length);
  const species=types.map(()=>[]);
  trees.forEach((t,i)=>species[i%types.length].push(t));
  const color=new THREE.Color();
  for(const [j,list] of species.entries()) {
    const leaf=new THREE.InstancedMesh(twig,types[j],list.length);
    list.forEach((t,i)=>{
      const f=t.shade;tmp.position.copy(t.base);tmp.rotation.set(0,t.rot,0);tmp.scale.set(t.h*t.w,t.h,t.h*t.w);tmp.updateMatrix();
      leaf.setMatrixAt(i,tmp.matrix);color.setRGB(f*1.025,f,f*.94);leaf.setColorAt(i,color);
    });
    leaf.name='Woodland • matched crown view '+j;assembly.add(leaf);
  }
  trees.forEach((t,i)=>{
    const f=t.shade;tmp.position.copy(t.base);tmp.position.y+=t.h*.245;tmp.rotation.set(0,t.rot,0);
    tmp.scale.set(t.h*.0087,t.h*.49,t.h*.0087);tmp.updateMatrix();trunks.setMatrixAt(i,tmp.matrix);
    color.setRGB(f*.68,f*.67,f*.63);trunks.setColorAt(i,color);
  });
  trunks.name='Woodland trunks';assembly.add(trunks);
  return {mountains,group:assembly,oldPineFoot:mainBase,oldPineTop:mainTop,secondaryPines:trees.length+volumes.trees.length,volumes};
}
