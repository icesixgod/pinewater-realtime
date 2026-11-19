import * as THREE from './three.module.js';
import {stoneProfiles} from './art/cabin-relief.js';
import {returnTiles} from './art/cabin-return-tiles.js';
import {sunDirection,sunVectorGLSL} from './calibration.js';

// Reprojected, separately rectified surface captures. Coordinates in the photographic atlas are in pixels.
const areas = {
  roof:[4,4,790,364], side:[4,378,790,338], front:[804,4,526,324],
  gable:[1339,4,406,310], awning:[803,340,578,138], lumber:[1392,340,512,86],
  end:[1392,435,140,140], loftglass:[1760,4,128,180], fascia:[1400,760,420,54], iron:[1840,435,120,60], window:[1548,435,120,228], door:[1680,435,126,316],
  stoneA:[804,488,154,468], stoneB:[968,488,154,468], stoneFoot:[1132,488,154,430],
  logs:[4,728,344,248], interior:[360,728,212,112], footing:[4,992,282,220]
};
const returnSurveyEye=new THREE.Vector3(2.3671603261,1.4628373130,-7.7091692440);
// Linear-light radiometric transfer from corresponding opaque world patches in the two observations.
// Values are regularized using a small black floor; glazing is intentionally excluded from diffuse calibration.
const surveyGain={
  stoneB:[1.282,1.122,.968],stoneA:[.709,.734,.755],front:[1.510,1.290,1.175],
  gable:[.961,.807,.742],door:[1.417,1.250,1.155]
};
const up = new THREE.Vector3(0,1,0);
const priorTile = {cut0:'end',cut1:'end',cut2:'end',cut3:'end',cut4:'end',cut5:'end',
  post0:'lumber',post1:'lumber',post2:'lumber',post3:'lumber',rail:'lumber',bracket:'lumber',
  rakeL:'lumber',rakeR:'lumber',apron:'lumber',step0:'lumber',step1:'lumber',postBrace:'lumber',
  soffitL:'lumber',soffitR:'lumber',canopySide:'lumber',fissure:'lumber',plank:'lumber',pier:'lumber',stepRiser:'lumber',jamb:'lumber',sash:'lumber',handrail:'lumber'};
const recoveredShade={front:1,gable:1,awning:1,stoneA:1,stoneB:1,stoneFoot:1,door:1,window:1,loftglass:1,fascia:1};
const irregular=(a,b=0)=>{const t=Math.sin(a*71.578+b*37.719)*4312.825;return t-Math.floor(t);};
const mix = (a,b,t) => a.clone().lerp(b,t);
const move = (p,vec,s) => p.clone().addScaledVector(vec,s);
const lift = (p,y) => move(p,up,y);
const offset = (p,x,y,z) => p.clone().add(new THREE.Vector3(x,y,z));
const atHeight = (v,y) => new THREE.Vector3(v.x,y,v.z);
const minus = (a,b) => a.clone().sub(b);
const bilerp = (q,u,v) => mix(mix(q[0],q[1],u),mix(q[3],q[2],u),v);
const mod = (x,n) => ((x%n)+n)%n;
function timberIrradiance(n){
  // One directional emitter provides the cosine term; the other term is hemispheric skylight.
  // Return a display-space factor because vertex tints are encoded for the radiance atlas below.
  const sky=.28+.14*(.5+.5*n.y);
  return Math.pow(sky+.63*Math.max(0,n.dot(sunDirection)),1/2.1);
}

// The cabin is static, so the sun and near-field sky visibility only need one bake.
// Each tile is an orthographic observation of the actual planks, rails, posts and treads.
function cabinVisibility(renderer,geometry,bearingGeo) {
  if(!renderer)return null;
  const skyDirs=[[.06,1,.1],[-.72,.57,.43],[.76,.43,.49],[.28,.44,-.86],[-.63,.43,-.62],[.91,.28,-.32],[-.91,.25,.25],[-.15,.30,.94]];
  const dirs=[sunDirection,...skyDirs.map(a=>new THREE.Vector3(...a).normalize())];
  const size=448,span=24;
  const target=new THREE.WebGLRenderTarget(size*3,size*3,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,generateMipmaps:false});
  const materials=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  const depthScene=new THREE.Scene();depthScene.add(new THREE.Mesh(geometry,materials));
  if(bearingGeo)depthScene.add(new THREE.Mesh(bearingGeo,materials));
  geometry.computeBoundingBox();const center=geometry.boundingBox.getCenter(new THREE.Vector3());
  const oldTarget=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4());
  const oldTest=renderer.getScissorTest(),oldClear=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha(),auto=renderer.autoClear;
  const matrices=[];
  renderer.setRenderTarget(target);renderer.setClearColor(0xffffff,1);renderer.autoClear=false;
  renderer.setScissorTest(true);
  for(let i=0;i<9;i++){
    const c=new THREE.OrthographicCamera(-6.0,6.0,6.0,-6.0,.35,span+.35);
    c.position.copy(center).addScaledVector(dirs[i],12);c.lookAt(center);c.updateMatrixWorld();
    matrices.push(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse));
    renderer.setViewport((i%3)*size,Math.floor(i/3)*size,size,size);
    renderer.setScissor((i%3)*size,Math.floor(i/3)*size,size,size);renderer.clear();renderer.render(depthScene,c);
  }
  renderer.setRenderTarget(oldTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(oldTest);
  renderer.setClearColor(oldClear,oldAlpha);renderer.autoClear=auto;materials.dispose();
  return {target,dirs,matrices};
}
const visibilityGL= `
uniform sampler2D uCabinVisibility;
uniform mat4 uCabinVP[9];
uniform vec3 uCabinDirections[9];
float cabinGap(vec3 pt,int i,vec2 offsetPx){
  vec4 clip=uCabinVP[i]*vec4(pt,1.);
  vec3 ndc=clip.xyz/clip.w*.5+.5;
  vec2 base=vec2(float(i-3*(i/3)),float(i/3));
  vec2 uv=(base+clamp(ndc.xy+offsetPx/448.,.002,.998))/3.;
  vec4 packed=texture2D(uCabinVisibility,uv);
  float depth=dot(packed,vec4(.99609375,.00389099121,.000015199184,.0000000596046448));
  return (ndc.z-depth)*24.;
}
vec3 cabinShade(vec3 pt,vec3 N){
  float face=abs(dot(N,uCabinDirections[0]));
  float b=.009+.016*(1.-face);
  float direct=0.,distantCaster=0.;
  for(int i=0;i<5;i++){
    float angle=6.2831853*(float(i)+.25)/5.;
    float gap=cabinGap(pt,0,.92*vec2(cos(angle),sin(angle)));
    direct+=smoothstep(b,b+.020,gap);
    distantCaster+=smoothstep(.18,.32,gap);
  }
  float ambient=0.,tot=0.;
  for(int i=1;i<9;i++){
    float w=max(.04,dot(N,uCabinDirections[i]));
    float dist=cabinGap(pt,i,vec2(0.));float nearAO=smoothstep(.014,.044,dist)*exp(-max(0.,dist)*3.7);
    ambient+=w*nearAO;tot+=w;
  }
  return vec3(direct*.2,ambient/max(.18,tot),distantCaster*.2);
}
`;

export function buildCabin(ctx) {
  const group = new THREE.Group();
  group.name='Log cabin, front porch, fieldstone flue';
  ctx.scene.add(group);
  const loads=[];
  function texture(file){
    let finish;loads.push(new Promise(resolve=>{finish=resolve;}));
    return new THREE.TextureLoader().load(new URL(file,import.meta.url).href,()=>finish(true),undefined,()=>finish(false));
  }
  const atlas=texture('./art/cabin-materials.webp');
  const normalAtlas=texture('./art/cabin-normals.webp');
  normalAtlas.anisotropy=8;
  const secondView=texture('./art/cabin-return.webp');
  const glassWorld=texture('./art/cabin-glass-environment.webp');
  secondView.colorSpace=THREE.SRGBColorSpace;secondView.anisotropy=8;
  glassWorld.colorSpace=THREE.SRGBColorSpace;glassWorld.wrapS=THREE.RepeatWrapping;
  const graniteAtlas=texture('./art/cabin-granite.webp');graniteAtlas.colorSpace=THREE.SRGBColorSpace;graniteAtlas.anisotropy=6;
  const ready=Promise.all(loads);
  atlas.colorSpace=THREE.SRGBColorSpace;
  atlas.anisotropy=8;
  const xyz=[],uv=[],rgb=[],indices=[],returnUv=[],finishData=[],responseGain=[];
  const p=(x,y,d)=>ctx.atD(x,y,d);
  const fixed=(x,y,h)=>ctx.atY(x,y,h);
  // Separate rubble piers support the timber sill. Every outer stone edge is seated in
  // the surveyed terrain, while the voids between bearings remain open to the bank.
  const stonesXYZ=[],stonesUV=[],stonesRGB=[],stonesIndex=[];
  let stoneLight=1,stoneMoss=0;
  const ground=(p)=>ctx.groundY?ctx.groundY(p.x,p.z):p.y-.38;
  function stoneCorner(v,region,u,h,shade) {
    const x=3+(region%2)*240,y=3+Math.floor(region/2)*153;
    stonesXYZ.push(v.x,v.y,v.z);stonesUV.push((x+.5+Math.max(0,Math.min(1,u))*229)/479,1-(y+.5+Math.max(0,Math.min(1,h))*141)/305);
    const c=(shade*stoneLight)**2.1;stonesRGB.push(c*(1-.13*stoneMoss),c*(1+.08*stoneMoss),c*(1-.17*stoneMoss));
    return stonesXYZ.length/3-1;
  }
  function stoneSide(points,region,shade,st) {
    const b=stonesXYZ.length/3;
    points.forEach((v,j)=>stoneCorner(v,region,st[j][0],st[j][1],shade));
    if(points.length===3)stonesIndex.push(b,b+1,b+2);
    else stonesIndex.push(b,b+1,b+2,b,b+2,b+3);
  }
  function bearingStone(center,axis,length,width,low,high,seed,seated) {
    const along=axis.clone().setY(0).normalize(),back=new THREE.Vector3(-along.z,0,along.x);
    const perimeter=[[-.5,-.24],[-.34,-.49],[.26,-.5],[.5,-.33],[.46,.29],[.28,.50],[-.34,.46],[-.5,.26]];
    const floorRing=[],middle=[],topRing=[],granite=Math.floor(irregular(seed,17)*4);
    for(let j=0;j<perimeter.length;j++){
      const [u,v]=perimeter[j],noise=irregular(seed,j);
      const xyz=(scale)=>center.clone().addScaledVector(along,(u+(noise-.5)*.08)*length*scale).addScaledVector(back,(v+.06*(irregular(j,seed*3)-.5))*width*scale);
      const foot=xyz(.90+.10*noise);foot.y=seated?Math.min(high-.035,ground(foot)-.025):low-.008;
      const belt=xyz(1.01+.045*noise);belt.y=THREE.MathUtils.lerp(foot.y,high,.53+.13*(noise-.5));
      const cap=xyz(.82+.12*noise);cap.y=high-.013*(1-noise);
      floorRing.push(foot);middle.push(belt);topRing.push(cap);
    }
    const capPoint=atHeight(center,high+.002);
    for(let j=0;j<8;j++){
      const k=(j+1)%8,windward=.78+.16*irregular(seed*2,j);
      stoneSide([topRing[j],topRing[k],middle[k],middle[j]],granite,windward,[[.06,.08],[.89,.055],[.93,.53],[.06,.55]]);
      stoneSide([middle[j],middle[k],floorRing[k],floorRing[j]],granite,windward*.84,[[.06,.55],[.93,.53],[.96,.98],[.12,.96]]);
      const uv=([a,b])=>[.5+a*.91,.5+b*.91];
      stoneSide([capPoint,topRing[j],topRing[k]],granite,.92,[[.5,.5],uv(perimeter[j]),uv(perimeter[k])]);
    }
  }
  function pierAt(center,axis,length,width,bearingY,seed,light=1,moss=0) {
    stoneLight=light;stoneMoss=moss;
    const soil=ground(center),height=bearingY-soil;
    if(height<.045)return;
    if(height<.23){bearingStone(center,axis,length,width,soil,bearingY,seed,true);return;}
    const joint=soil+height*(.52+.06*(irregular(seed)-.5));
    bearingStone(center,axis,length,width,soil,joint,seed,true);
    bearingStone(move(center,axis,(irregular(seed,2)-.5)*.035),axis,length*.86,width*.89,joint,bearingY,seed+19,false);
  }

  function vtx(p,ar,s,t,tint=1) {
    const a=areas[priorTile[ar]||ar];
    const gain=surveyGain[ar];
    responseGain.push(gain?gain[0]:1,gain?gain[1]:1,gain?gain[2]:1,ar==='stoneB'?1:ar==='front'?2:0);
    const r=returnTiles[ar] || a;
    const ru=Math.min(1,Math.max(0,s)),rv=Math.min(1,Math.max(0,t));
    returnUv.push((r[0]+.5+ru*(r[2]-1))/2048,1-(r[1]+.5+rv*(r[3]-1))/2048);
    const glass=ar==='window'||ar==='loftglass';
    const rt=returnTiles[ar] ? 1 : 0;
    const hewnPost=/^post[0-3]$/.test(ar);
    const color=recoveredShade[ar] || (hewnPost?.32+.68*tint:ar.startsWith('cut')?.73+.32*tint:ar==='fissure'?.77:.91+.10*Math.min(1.3,tint));
    // Fourth channel is the strength of new self-shadowing on each surface.
    const photo=ar==='stoneB'||ar==='stoneA'||ar==='stoneFoot'||ar==='roof';
    finishData.push(rt,color,glass?1:0,photo?.21:ar==='front'||ar==='gable'?.57:1);
    xyz.push(p.x,p.y,p.z);
    uv.push((a[0]+.5+Math.min(1,Math.max(0,s))*(a[2]-1))/2048,1-(a[1]+.5+Math.min(1,Math.max(0,t))*(a[3]-1))/1536);
    const c=Math.pow(tint,2.1);rgb.push(c,c,c);
    return xyz.length/3-1;
  }
  function face(q,tile,shade=1,tex=[[0,0],[1,0],[1,1],[0,1]]) {
    const k=vtx(q[0],tile,tex[0][0],tex[0][1],shade);
    for(let i=1;i<4;i++)vtx(q[i],tile,tex[i][0],tex[i][1],shade);
    indices.push(k,k+1,k+2,k,k+2,k+3);
  }
  function tri(q,tile,tex,shade=1) {
    const k=vtx(q[0],tile,tex[0][0],tex[0][1],shade);
    vtx(q[1],tile,tex[1][0],tex[1][1],shade);vtx(q[2],tile,tex[2][0],tex[2][1],shade);indices.push(k,k+1,k+2);
  }
  function timber(start,end,width,depth,shade=1,tile='lumber',cross=null,span=[0,1]) {
    const dir=minus(end,start).normalize();
    let side=cross?cross.clone().addScaledVector(dir,-cross.dot(dir)):new THREE.Vector3().crossVectors(dir,up);
    if(side.lengthSq()<.01)side.set(1,0,0);
    side.normalize().multiplyScalar(width/2);
    const normal=new THREE.Vector3().crossVectors(side,dir).normalize().multiplyScalar(depth/2);
    const around=(start) => [start.clone().sub(side).add(normal),start.clone().add(side).add(normal),start.clone().add(side).sub(normal),start.clone().sub(side).sub(normal)];
    const a=around(start), b=around(end);
    const dz=normal.clone().normalize(),dx=side.clone().normalize();
    const faceNormals=[dz,dx,dz.clone().negate(),dx.clone().negate()];
    for(let i=0;i<4;i++){
      const j=(i+1)%4;
      const faceTile=tile.startsWith('step') && i!==0?'stepRiser':tile;
      face([a[i],b[i],b[j],a[j]],faceTile,shade*timberIrradiance(faceNormals[i]),[[span[0],0],[span[1],0],[span[1],1],[span[0],1]]);
    }
    if(span[0]===0)face(a,'end',shade*timberIrradiance(dir.clone().negate()));
    if(span[1]===1)face(b,'end',shade*timberIrradiance(dir));
  }
  function courses(q,tile,nRows,outwards,depth,shade=1,windowMask=null) {
    const strips=6,cols=30;
    for(let j=0;j<nRows*strips;j++) {
      const f=j/strips,t0=j/(nRows*strips),t1=(j+1)/(nRows*strips);
      const surface=(u,v)=>{
        const a=windowMask?windowMask(u,v):1;
        const swell=Math.sin(Math.PI*mod(v*nRows,1));
        return move(bilerp(q,u,v),outwards,depth*swell*a);
      };
      const angle=Math.PI*((j%strips)+.5)/strips;
      const sunlit=Math.max(0,outwards.dot(sunDirection)*Math.sin(angle)+sunDirection.y*Math.cos(angle));
      const shading=tile==='front' ? shade*(.55+.53*sunlit) : shade*(.98+.025*Math.sin((f%1)*Math.PI));
      for(let i=0;i<cols;i++) {
        const u0=i/cols,u1=(i+1)/cols;
        face([surface(u0,t0),surface(u1,t0),surface(u1,t1),surface(u0,t1)],tile,shading,[[u0,t0],[u1,t0],[u1,t1],[u0,t1]]);
      }
    }
  }
  function shingles(q,tile,nRows,shade) {
    const short=tile==='awning',nAcross=short?18:23;
    const tip=(u,t,h)=>lift(bilerp(q,u,Math.min(1.009,Math.max(0,t))),h);
    for(let row=0;row<nRows;row++) {
      const phase=(row%2)*.48;
      for(let cell=-1;cell<nAcross;cell++){
        const u0=Math.max(0,(cell+phase)/nAcross),u1=Math.min(1,(cell+1+phase)/nAcross);
        if(u1-u0<.001)continue;
        const t0=row/nRows,t1=(row+1)/nRows;
        const random=irregular(row,cell),leftSlip=(random-.5)*(short?.009:.004);
        const rightSlip=(irregular(cell,13+row)-.5)*(short?.009:.004);
        const h=short?.0028+.0032*random:.006+.005*random;
        const q0=tip(u0,t0-.002,0),q1=tip(u1,t0-.002,0),q2=tip(u1,t1+rightSlip,h),q3=tip(u0,t1+leftSlip,h*.89);
        face([q0,q1,q2,q3],tile,shade,[[u0,t0],[u1,t0],[u1,t1],[u0,t1]]);
        face([q3,q2,tip(u1,t1+rightSlip,0),tip(u0,t1+leftSlip,0)],'lumber',short?.43:.40);
      }
    }
  }
  function cylinder(start,end,r0,r1,tile='lumber',shade=1,segments=11,cut='end',seed=0) {
    const axis=minus(end,start).normalize();
    const n=new THREE.Vector3().crossVectors(axis,up);
    if(n.lengthSq()<.001)n.set(1,0,0);
    n.normalize();const m=new THREE.Vector3().crossVectors(axis,n).normalize();
    for(let i=0;i<segments;i++){
      const phase=2*Math.PI*i/segments,phase2=2*Math.PI*(i+1)/segments;
      const ring=(a)=>n.clone().multiplyScalar(Math.cos(a)).addScaledVector(m,Math.sin(a)).multiplyScalar(
        cut==='end'?1:.98+.043*Math.sin(3*a+seed)+.051*Math.sin(5*a-seed*.73)+.020*Math.cos(9*a+seed*.37)-.095*Math.max(0,(Math.cos(a-seed)-.946)/.054));
      const d1=ring(phase),d2=ring(phase2);
      const q=[move(start,d1,r0),move(end,d1,r1),move(end,d2,r1),move(start,d2,r0)];
      const curvedNormal=d1.clone().add(d2).normalize();
      face(q,tile,shade*timberIrradiance(curvedNormal),[[0,i/segments],[1,i/segments],[1,(i+1)/segments],[0,(i+1)/segments]]);
      const s0=[.5+Math.cos(phase)*.475,.5+Math.sin(phase)*.475],s1=[.5+Math.cos(phase2)*.475,.5+Math.sin(phase2)*.475];
      tri([start,q[0],q[3]],cut,[[.5,.5],s0,s1],shade*timberIrradiance(axis.clone().negate()));
      if(cut==='end'){
        tri([end,q[1],q[2]],'end',[[.5,.5],s0,s1],shade*timberIrradiance(axis));
      } else {
        const capEnd=move(end,axis,.0045);
        const rim1=move(capEnd,d1,r1*.92),rim2=move(capEnd,d2,r1*.92);
        const uu=(a)=>[.5+.433*Math.cos(a),.5+.433*Math.sin(a)];
        face([q[1],q[2],rim2,rim1],cut,shade*.80,[s0,s1,uu(phase2),uu(phase)]);
        tri([capEnd,rim1,rim2],cut,[[.5,.5],uu(phase),uu(phase2)],shade*timberIrradiance(axis));
      }
    }
    if(cut!=='end'){
      const cap=move(end,axis,.0059);
      for(let k=0;k<2;k++){
        const a=seed*.82+k*2.76+.15*irregular(k,seed);
        const radial=n.clone().multiplyScalar(Math.cos(a)).addScaledVector(m,Math.sin(a));
        const around=n.clone().multiplyScalar(-Math.sin(a)).addScaledVector(m,Math.cos(a));
        const outer=move(cap,radial,r1*(.94-.055*k));
        const inner=move(cap,radial,r1*(.27+.22*k));
        const bend=move(move(mix(outer,inner,.49),around,.0028),axis,.0002);
        const edge=move(outer,around,.0037);
        tri([outer,edge,bend],'fissure',[[0,0],[1,0],[.5,1]],.31);
        tri([edge,inner,bend],'fissure',[[0,0],[1,0],[.5,1]],.31);
      }
    }
  }
  // Four floor corners and orthogonal-ish log axes reconstructed from the eaves and sill lines.
  const floor=1.315;
  const fl=atHeight(p(269,497,14.65),floor),fr=atHeight(p(402,491,17.55),floor);
  const bl=atHeight(p(68,487,19.02),floor);
  const br=fr.clone().add(minus(bl,fl));
  const across=minus(fr,fl).normalize(),towards=minus(fl,bl).normalize();
  const leftNormal=new THREE.Vector3(-towards.z,0,towards.x).normalize();
  const frontNormal=new THREE.Vector3(-across.z,0,across.x).normalize();
  const wl=p(269,386,14.65),wr=p(402,398,17.55),wb=p(68,393,19.02),wb2=atHeight(br,wr.y);
  courses([wb,wl,fl,bl],'side',10,leftNormal,.035,1,(u,v)=>((u>.65&&u<.91&&v>.20&&v<.78)||(u>.18&&u<.43&&v>.23&&v<.63))?.12:1);
  const frontWall=[wl,wr,fr,fl];
  courses(frontWall,'front',10,frontNormal,.065,1,(u,v)=>{
    const at=ctx.pix(bilerp(frontWall,u,v));
    return (at.x>297.5 && at.x<324 && at.y>407 && at.y<460.8) ||
      (at.x>338.5 && at.x<370.5 && at.y>402.5) ? .06 : 1;
  });
  courses([wr,wb2,br,fr],'side',10,leftNormal.clone().negate(),.061,.90);
  courses([wb2,wb,bl,br],'side',10,frontNormal.clone().negate(),.043,.75);
  // Intersect authored pixel landmarks with their actual wall plane before fitting trim.
  // This locks the sill and door jamb to the captured opening at the reference camera.
  function planeAtPixel(points,x,y) {
    const origin=new THREE.Vector3(0,2.05,0);
    const dir=minus(p(x,y,10),origin).normalize();
    const plane=new THREE.Plane().setFromCoplanarPoints(points[0],points[1],points[2]);
    return new THREE.Ray(origin,dir).intersectPlane(plane,new THREE.Vector3());
  }
  // The occupied cabin stands on intermittent fieldstone bearings under its sill.
  // A ventilated timber porch extends in front; its visible fascia carries no masonry skirt.
  const footSides=[[fl,fr],[fr,br],[br,bl],[bl,fl]];
  for(let s=0;s<footSides.length;s++){
    const [a,b]=footSides[s],axis=minus(b,a).normalize();
    timber(lift(a,-.010),lift(b,-.010),.145,.109,.77);
    const count=Math.ceil(a.distanceTo(b)/1.55);
    for(let k=0;k<count;k++){
      const station=(k+.04)/count;
      const position=mix(a,b,station);
      const shaded=s===3||s===2;
      const width=(shaded?.32:.41)+.08*irregular(s+2,k+4);
      pierAt(position,axis,width,shaded?.30:.35,-.060+floor,37+s*11+k,shaded?.63:.82,shaded?.90:.35);
    }
  }
  face([fl,fr,br,bl].map(v=>lift(v,-.065)),'lumber',.45);
  // Short exposed ends of alternating lap-notched courses at both sides of the gable.
  for(let row=0;row<10;row++){
    for(const [foot,roof,direction] of [[fl,wl,across.clone().negate()],[fr,wr,across]]) {
      const ctr=mix(foot,roof,(row+.5)/10);
      const a=row%2?frontNormal:direction;
      const tip=move(ctr,a,(.048+.018*Math.sin(5.7*row))*(row%2?1:.9));
      cylinder(move(ctr,a,-.02),tip,.092,.084,'lumber',foot===fr?.87:.69,18,'cut'+(foot===fr?row%4:4+row%2),row*1.31+(foot===fr?9:0));
    }
  }
  // The lower door panel and side-pane reveal sit within the recessed front wall.
  const facade=[wl,wr,fr,fl];
  function joinery(surface,outline,n,tile,shade,sash=false) {
    const q=outline.map(([x,y])=>move(planeAtPixel(surface,x,y),n,.042));
    face(q,tile,shade);
    const timberTint=tile==='loftglass'?.72:.85;
    for(let i=0;i<4;i++)timber(q[i],q[(i+1)%4],sash?.040:.047,sash?.05:.057,timberTint,sash?'sash':'jamb');
    if(sash) {
      const top=mix(q[0],q[1],.50),bot=mix(q[3],q[2],.50);
      const l=mix(q[0],q[3],.49),r=mix(q[1],q[2],.49);
      timber(move(top,n,.009),move(bot,n,.009),.016,.023,timberTint*.87,'sash');
      timber(move(l,n,.012),move(r,n,.012),.017,.023,timberTint*.98,'sash');
      timber(move(q[3],n,.037),move(q[2],n,.037),.077,.046,timberTint*1.18,'sash');
    } else {
      const jamb=move(bilerp(q,.842,.602),n,.023);
      timber(lift(jamb,-.047),lift(jamb,.059),.038,.018,1.2,'iron');
      cylinder(move(jamb,n,.002),move(jamb,n,.052),.018,.022,'iron',1.15,9);
      for(const t of [.19,.82]) {
        const a=move(bilerp(q,.035,t),n,.011),b=move(bilerp(q,.142,t),n,.011);
        timber(a,b,.029,.010,1.08,'iron');
      }
    }
  }
  joinery(facade,[[300,411],[322,411],[322,458],[300,458.8]],frontNormal,'window',.97,true);
  joinery(facade,[[341,405.2],[367.7,406.2],[367.7,489.6],[341,490.6]],frontNormal,'door',.93);
  // Structural roof slopes are closed on all sides, including the hidden rear gable.
  const reL=p(50,391,19.0),feL=p(272,384,14.12);
  const peak=p(365,276,15.49),rearPeak=p(144.5,298,20.85);
  const feR=p(433,389,17.78),reR=feR.clone().add(minus(reL,feL));
  const nearRoof=[rearPeak,peak,feL,reL],farRoof=[peak,rearPeak,reR,feR];
  shingles(nearRoof,'roof',16,1);shingles(farRoof,'roof',16,.89);
  for(const [a,b] of [[reL,feL],[feR,reR],[feL,peak],[peak,feR],[rearPeak,reL],[reR,rearPeak]]) {
    const front=a===peak||b===peak;
    if(front){
      const rake=a===peak?'rakeR':'rakeL';
      const start=lift(a,-.02),end=lift(b,-.02);
      // Aged bargeboards keep a straight bearing line, with sawn lower arrises worn by the weather.
      for(let k=0;k<13;k++){
        const u=k/13,v=(k+1)/13;
        const bow=t=>.0068*Math.sin(Math.PI*t)*Math.sin(t*8.3);
        const p0=lift(mix(start,end,u),bow(u)),p1=lift(mix(start,end,v),bow(v));
        timber(p0,p1,.094,.077+.005*Math.sin(k*2.8),1.11,rake,null,[u,v]);
      }
    }else timber(lift(a,-.02),lift(b,-.02),.078,.072,.67);
  }
  timber(peak,rearPeak,.070,.050,.62);
  const lg=move(lift(feL,-.04),frontNormal,-.18), rg=move(lift(feR,-.04),frontNormal,-.18), pg=move(lift(peak,-.065),frontNormal,-.18);
  function rectUV(v) {
    const uv=ctx.pix(v); return [(uv.x-267)/171,(uv.y-263)/133];
  }
  const loftTriangle=[lg,pg,rg];
  const loftPoint=(u,v)=>lg.clone().addScaledVector(minus(pg,lg),u).addScaledVector(minus(rg,lg),v);
  for(let i=0;i<12;i++)for(let j=0;j<12-i;j++) {
    const a=loftPoint(i/12,j/12),b=loftPoint((i+1)/12,j/12),c=loftPoint(i/12,(j+1)/12);
    tri([a,b,c],'gable',[rectUV(a),rectUV(b),rectUV(c)],1);
    if(i+j<11){const d=loftPoint((i+1)/12,(j+1)/12);tri([b,d,c],'gable',[rectUV(b),rectUV(d),rectUV(c)],1);}
  }
  joinery(loftTriangle,[[338.7,328.6],[354.5,330],[354.5,354.9],[338.7,353.6]],frontNormal,'loftglass',.97,true);

  face([lg,rg,wr,wl],'lumber',.46);
  const backRoofL=move(reL,frontNormal,.13),backRoofR=move(reR,frontNormal,.13),backRoofPeak=move(rearPeak,frontNormal,.13);
  tri([backRoofL,backRoofPeak,backRoofR],'gable',[[.013,.99],[.565,.025],[.986,.985]],.74);
  face([backRoofR,backRoofL,wb,wb2],'lumber',.61);
  for(const [a,b] of [[feL,peak],[peak,feR]]) {
    face([lift(a,-.05),lift(b,-.05),move(lift(b,-.075),frontNormal,-.22),move(lift(a,-.075),frontNormal,-.22)],a===feL?'soffitL':'soffitR',.54);
  }
  // End grain of the roof bearers just below the projecting ridge.
  cylinder(move(lift(peak,-.14),frontNormal,-.45),lift(peak,-.14),.052,.045,'lumber',.95);
  // Low shed roof is distinct from the gable. Its timbers cast their own baked soffit darkening.
  // Resolve the unsupported corner of the canopy along its original camera ray.
  // The front frame now overlaps the post caps in both observations.
  const abL=p(293,367.5,13.95),abR=p(430,385.5,17.32),afL=p(331.5,394.2,12.84),afR=p(469,402.5,15.90);
  const awn=[abL,abR,afR,afL];
  shingles(awn,'awning',7,1);
  // The cropped observation only shows the exposed outer shingles. Close the uphill
  // apron against the measured wall plane, under the projecting gable, with a drained lap.
  const gablePlane=new THREE.Plane().setFromCoplanarPoints(lg,pg,rg);
  const back=frontNormal.clone().negate().addScaledVector(up,.07).normalize();
  const ledgerAnchor=v=>move(v,back,.018-gablePlane.distanceToPoint(v)/gablePlane.normal.dot(back));
  const ledgerL=ledgerAnchor(abL),ledgerR=ledgerAnchor(abR);
  face([ledgerL,ledgerR,abR,abL],'awning',.74,[[0,0],[1,0],[1,.12],[0,.12]]);
  face([lift(ledgerL,-.05),lift(ledgerR,-.05),lift(abR,-.05),lift(abL,-.05)],'lumber',.44);
  timber(lift(ledgerL,-.072),lift(ledgerR,-.072),.088,.111,.62,'apron');
  const under=awn.map(q=>lift(q,-.063));
  face(under,'lumber',.37);
  timber(lift(afL,-.03),lift(afR,-.03),.084,.078,1.29,'apron');
  timber(lift(abL,-.032),lift(afL,-.032),.097,.085,.76,'canopySide');
  timber(lift(abR,-.032),lift(afR,-.032),.097,.085,1.06,'canopySide');
  for(let i=0;i<=9;i++) {
    const t=i/9;
    timber(lift(mix(ledgerL,ledgerR,t),-.071),lift(mix(abL,abR,t),-.07),.062,.078,.59);
    timber(lift(mix(abL,abR,t),-.07),lift(mix(afL,afR,t),-.083),.067,.085,i%2?.77:.80);
  }
  const dl=atHeight(p(328.5,499,13.68),floor+.039),dr=atHeight(p(451.5,495.2,15.50),floor+.039);
  const backDL=fl.clone(),backDR=fr.clone();
  const deck=[backDL,backDR,dr,dl];
  const nboards=14;
  for(let i=0;i<nboards;i++) {
    const a=(i+.027)/nboards,b=(i+.974)/nboards;
    face([bilerp(deck,0,a),bilerp(deck,1,a),bilerp(deck,1,b),bilerp(deck,0,b)],'plank',.89+.08*Math.sin(i*14.3));
  }
  for(const [a,b,shade] of [[dl,dr,1.10],[dl,backDL,.77],[dr,backDR,.87]]) {
    face([a,b,lift(b,-.147),lift(a,-.147)],a===dl&&b===dr?'fascia':'lumber',a===dl&&b===dr?1:shade);
    const marks=a===dl&&b===dr?[.018,.34,.675,.98]:[];
    for(const t of marks){
      const q=mix(a,b,t),g=ctx.groundY?ctx.groundY(q.x,q.z):q.y-.43;
      const foot=atHeight(q,Math.min(q.y-.19,g-.034));
      timber(lift(q,-.077),foot,.115,.149,.62,'pier');
    }
  }
  const posts=[];
  for(const [pi,t] of [.012,.324,.680,.984].entries()){
    const foot=mix(dl,dr,t),cap=lift(mix(afL,afR,t),-.092);
    cap.x=foot.x;cap.z=foot.z;
    // Eight irregular hewn arrises and a slight taper retain the post footprint.
    const axial=minus(cap,foot),uSide=across.clone(),vSide=new THREE.Vector3(-across.z,0,across.x);
    const outline=[[-.43,-.50],[.33,-.50],[.5,-.32],[.50,.38],[.36,.50],[-.39,.50],[-.50,.30],[-.50,-.36]];
    const col=(h,j)=>{
      const ar=outline[j],swell=1.035-.095*h+.045*Math.sin(h*4.5+pi);
      const edge=1+.032*Math.sin(6.61*j+pi*1.41)+.016*Math.sin(15.2*h+j);
      return foot.clone().addScaledVector(axial,h).addScaledVector(uSide,ar[0]*.095*swell*edge+.0041*Math.sin(h*5.7+pi)*Math.sin(Math.PI*h))
        .addScaledVector(vSide,ar[1]*.113*swell*edge);
    };
    const observedPostNormal=minus(returnSurveyEye,foot).setY(0).normalize();
    const measuredPostLight=timberIrradiance(observedPostNormal);
    for(let h=0;h<7;h++)for(let j=0;j<8;j++){
      const k=(j+1)%8,v0=h/7,v1=(h+1)/7;
      const a=col(v0,j),b=col(v1,j),c=col(v1,k),d=col(v0,k);
      const edgeNormal=new THREE.Vector3().crossVectors(minus(b,a),minus(d,a)).normalize();
      if(edgeNormal.dot(minus(mix(a,d,.5),mix(foot,cap,v0)))<0)edgeNormal.negate();
      const light=THREE.MathUtils.clamp(timberIrradiance(edgeNormal)/measuredPostLight,.76,1.22);
      face([a,b,c,d],'post'+pi,light,[[v0,.06],[v1,.06],[v1,.94],[v0,.94]]);
    }
    face([col(1,0),col(1,2),col(1,4),col(1,6)],'end',.67);
    const ev=mix(foot,cap,.85);
    timber(ev,move(lift(cap,-.005),across,t<.55?.19:-.19),.044,.056,.94,'postBrace');
    posts.push([foot,cap]);
  }
  // The rafters bear on a continuous plate just above the posts. It is behind the projecting drip edge.
  timber(lift(posts[0][1],.016),lift(posts[3][1],.016),.106,.113,.72,'apron');
  for(let i=0;i<posts.length;i++) {
    const cap=posts[i][1];
    const peg=move(lift(cap,-.070),frontNormal,.052);
    cylinder(move(peg,frontNormal,-.009),move(peg,frontNormal,.003),.009,.010,'iron',.67,7);
  }
  function balustrade(a,b,n,h=.50,shade=1) {
    timber(lift(a,h),lift(b,h),.079,.067,shade*1.04,'handrail');
    timber(lift(a,.095),lift(b,.095),.058,.052,shade*.97,'rail');
    for(let i=1;i<n;i++) {
      const foot=mix(a,b,i/n);
      const end=move(lift(foot,h-.031),across,.005*(irregular(i,a.x)-.50));
      const width=.032+.006*irregular(a.z,i);
      timber(lift(foot,.11),end,width,width*1.09,shade*(.89+.14*irregular(i,a.z)),'rail');
    }
  }
  balustrade(posts[0][0],posts[1][0],7,.50,1.14);
  balustrade(posts[2][0],posts[3][0],7,.50,1.03);
  balustrade(fl,dl,7,.50,.93);
  balustrade(dr,fr,7,.50,.79);
  // Three free-standing porch steps and dark stringers, aligned with the opening.
  const sa=mix(dl,dr,.347),sb=mix(dl,dr,.725);
  for(let i=0;i<3;i++) {
    const depth=.239*(i+.51), drop=.106*(i+1);
    const a=lift(move(sa,towards,depth),-drop),b=lift(move(sb,towards,depth),-drop);
    timber(a,b,.234,.062,1.08-i*.046,i===1?'step1':'step0');
  }
  for(const end of [sa,sb])timber(move(lift(end,-.13),towards,-.09),move(lift(end,-.40),towards,.73),.074,.13,.70);
  // The port-side stair stringer reaches the bank. The other end stands above a dip in the same bank.
  for(const [j,end] of [sa,sb].entries()){
    const foot=move(lift(end,-.40),towards,.71);
    const clearance=foot.y-ground(foot);
    if(clearance>.025)pierAt(foot,across,.29,.27,foot.y+.029,83+j);
  }
  // Fieldstone stack. Its near corner and the two return faces are triangulated independently
  // so stones cross neither a corner nor the sloping roof. Each level changes the flue footprint.
  const C=p(193.7,248.7,15.62);
  const L=fixed(165.8,253.5,C.y),R=fixed(221.2,255.3,C.y),D=L.clone().add(minus(R,C));
  const center=mix(C,D,.5),plan=[C,R,D,L];
  const ring=(height,expand,wing=0)=>{
    const ctr=offset(center,wing,0,.017*expand);
    return plan.map(v=>atHeight(ctr.clone().addScaledVector(minus(v,center),expand),height));
  };
  const rTop=ring(C.y,1),rShoulder=ring(3.56,1.015),rBoot=ring(2.18,1.18,-.075),rBase=ring(1.205,1.42,-.105);
  const masonry=(high,low,foot=false,startV=0,endV=1)=>{
    for(let s=0;s<4;s++){
      const j=(s+1)%4;
      const mat=foot?'stoneFoot':s===0||s===1?'stoneB':'stoneA';
      const shade=foot?(s===0?.99:s===3?.91:.80):(s===0?1:s===3?1:.89);
      const grid=[high[s],high[j],low[j],low[s]];
      const st=(u)=>s===1||s===2?1-u:u;
      const vt=(v)=>startV+(endV-startV)*v;
      const du=17,dv=foot?21:41;
      const profile=stoneProfiles[mat];
      const height=(u,v)=>{
        const x=THREE.MathUtils.clamp(u,0,1)*24,y=THREE.MathUtils.clamp(v,0,1)*64;
        const xi=Math.floor(x),yi=Math.floor(y);
        const val=(i,j)=>parseInt(profile[Math.min(64,j)*25+Math.min(24,i)],16)/15;
        return THREE.MathUtils.lerp(THREE.MathUtils.lerp(val(xi,yi),val(xi+1,yi),x-xi),THREE.MathUtils.lerp(val(xi,yi+1),val(xi+1,yi+1),x-xi),y-yi);
      };
      const normal=new THREE.Vector3().crossVectors(minus(high[j],high[s]),up).normalize();
      if(normal.dot(minus(mix(high[s],high[j],.5),center))<0)normal.negate();
      for(let j2=0;j2<dv;j2++)for(let i=0;i<du;i++) {
        const u0=i/du,u1=(i+1)/du,v0=j2/dv,v1=(j2+1)/dv;
        const relief=(u,v)=>{
          const envelope=Math.min(1,12*u,12*(1-u));
          const rounded=height(st(u),vt(v));
          return move(bilerp(grid,u,v),normal,.032*(rounded-.25)*envelope);
        };
        face([relief(u0,v0),relief(u1,v0),relief(u1,v1),relief(u0,v1)],mat,shade,[[st(u0),vt(v0)],[st(u1),vt(v0)],[st(u1),vt(v1)],[st(u0),vt(v1)]]);
      }
    }
  };
  masonry(rTop,rShoulder);masonry(rShoulder,rBoot,true,0,.59);masonry(rBoot,rBase,true,.59,1);
  const cornice0=ring(C.y+.019,1.045),cornice1=ring(C.y+.078,1.06);
  for(let s=0;s<4;s++) {
    const j=(s+1)%4;
    face([cornice1[s],cornice1[j],cornice0[j],cornice0[s]],'lumber',s===0?1.14:.64);
  }
  face(cornice1,'footing',.58);
  // Metal cowl on four slim supports: the clear space underneath is open to the sky.
  const smoke=p(190.4,237.8,15.98),roofCenter=smoke.clone();
  const cowlU=minus(R,C).normalize(),cowlV=minus(L,C).normalize();
  const cowl=(h,su,sv) => offset(move(move(roofCenter,cowlU,su),cowlV,sv),0,h,0);
  const cw=.239,cd=.252;
  const cowlPts=[cowl(0,-cw,-cd),cowl(0,cw,-cd),cowl(0,cw,cd),cowl(0,-cw,cd)];
  const lip=cowlPts.map(v=>lift(v,-.027)),top=lift(roofCenter,.041);
  for(let s=0;s<4;s++){
    const j=(s+1)%4;
    tri([cowlPts[s],cowlPts[j],top],'lumber',[[0,1],[1,1],[.5,0]],s===0?.17:.29);
    face([cowlPts[s],cowlPts[j],lip[j],lip[s]],'lumber',.15);
    const post=mix(roofCenter,cowlPts[s],.64);
    timber(lift(post,-.018),atHeight(post,C.y+.056),.024,.024,.24);
  }
  // The thermal plume can start immediately over the hot metal hood.
  const chimney=lift(roofCenter,.044);
  const porch=move(lift(bilerp(deck,.52,.37),.84),across,.012);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));
  geo.setAttribute('returnUv',new THREE.Float32BufferAttribute(returnUv,2));
  geo.setAttribute('finishData',new THREE.Float32BufferAttribute(finishData,4));
  geo.setAttribute('responseGain',new THREE.Float32BufferAttribute(responseGain,4));
  geo.setIndex(indices);
  geo.computeVertexNormals();geo.computeBoundingSphere();
  const bearingGeo=new THREE.BufferGeometry();
  bearingGeo.setAttribute('position',new THREE.Float32BufferAttribute(stonesXYZ,3));
  bearingGeo.setAttribute('uv',new THREE.Float32BufferAttribute(stonesUV,2));
  bearingGeo.setAttribute('color',new THREE.Float32BufferAttribute(stonesRGB,3));
  bearingGeo.setIndex(stonesIndex);bearingGeo.computeVertexNormals();bearingGeo.computeBoundingSphere();
  const exposure=cabinVisibility(ctx.renderer,geo,bearingGeo);
  const mat=new THREE.MeshBasicMaterial({map:atlas,vertexColors:true,side:THREE.DoubleSide,toneMapped:false});
  // The captured radiance supplies broad light and shadow. Correct its fine relief using the
  // difference between the scanned and geometric normals in the actual sun direction.
  mat.onBeforeCompile = shader => {
    shader.uniforms.uCabinNormal={value:normalAtlas};
    shader.uniforms.uReturnSurvey={value:secondView};shader.uniforms.uGlassWorld={value:glassWorld};
    shader.uniforms.uReturnEye={value:returnSurveyEye};
    if(exposure){
      shader.uniforms.uCabinVisibility={value:exposure.target.texture};
      shader.uniforms.uCabinVP={value:exposure.matrices};shader.uniforms.uCabinDirections={value:exposure.dirs};
    }
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCabinWorld;attribute vec2 returnUv;attribute vec4 finishData;attribute vec4 responseGain;varying vec4 vSurveyResponse;varying vec2 vReturnUv;varying vec4 vFinish;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCabinWorld=(modelMatrix*vec4(position,1.)).xyz;vReturnUv=returnUv;vFinish=finishData;vSurveyResponse=responseGain;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vCabinWorld;\nuniform sampler2D uCabinNormal,uReturnSurvey,uGlassWorld;uniform vec3 uReturnEye;varying vec4 vSurveyResponse;varying vec2 vReturnUv;varying vec4 vFinish;');
    if(exposure)shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+visibilityGL);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec3 dpx=dFdx(vCabinWorld),dpy=dFdy(vCabinWorld);
      vec2 dtx=dFdx(vMapUv),dty=dFdy(vMapUv);
      vec3 baseN=normalize(cross(dpx,dpy));
      vec3 perpX=cross(baseN,dpx),perpY=cross(dpy,baseN);
      vec3 axisU=perpY*dtx.x+perpX*dty.x,axisV=perpY*dtx.y+perpX*dty.y;
      float ur=dot(axisU,axisU),vr=dot(axisV,axisV);
      vec3 micro=texture2D(uCabinNormal,vMapUv).xyz*2.0-1.0;
      vec3 litN=normalize(axisU*inversesqrt(max(ur,1e-12))*micro.x+axisV*inversesqrt(max(vr,1e-12))*micro.y+baseN*max(.4,micro.z));
      vec3 sun=${sunVectorGLSL};
      float relief=dot(litN,sun)-dot(baseN,sun);
      diffuseColor.rgb*=clamp(1.0+.41*relief,.72,1.29);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 observed=normalize(vec3(0.,2.05,0.)-vCabinWorld);
      vec3 finalRay=normalize(uReturnEye-vCabinWorld);
      vec3 sight=normalize(cameraPosition-vCabinWorld);
      float av=1.-dot(observed,sight), avRef=max(.009,1.-dot(observed,finalRay));
      float seen=smoothstep(.035,.88,av/avRef)*vFinish.x;
      vec3 completed=texture2D(uReturnSurvey,vReturnUv).rgb*vSurveyResponse.rgb*pow(max(.32,vFinish.y),2.1);
      ${exposure?`vec3 occluded=cabinShade(vCabinWorld,baseN);
      if(vSurveyResponse.w>.5){
        // The ridge and veranda cover are distant casters. Their measured cuts are separated
        // from contact relief in the rough stones and timbers by the depth of the blocker.
        float occlusion=occluded.z;
        if(vSurveyResponse.w<1.5)completed*=mix(vec3(1.37,1.25,1.10),vec3(.54,.59,.64),occlusion);
        else completed*=mix(vec3(1.54,1.65,1.71),vec3(.89,.86,.89),occlusion);
      }`:''}
      diffuseColor.rgb=mix(diffuseColor.rgb,completed,seen);
      ${exposure?`float readable=smoothstep(.009,.135,dot(diffuseColor.rgb,vec3(.25,.62,.13)));
      diffuseColor.rgb*=1.-vFinish.w*(.12+.19*readable)*occluded.x;
      diffuseColor.rgb*=1.-vFinish.w*.31*occluded.y;`:''}
      if(vFinish.z>.5){
        vec3 glassN=normalize(baseN+axisU*inversesqrt(max(ur,1e-12))*.004*sin(vReturnUv.y*486.));
        vec3 refl=reflect(-sight,glassN);
        vec2 sphere=vec2(.5+atan(refl.x,-refl.z)/6.2831853,.5+asin(clamp(refl.y,-1.,1.))/3.14159265);
        vec3 outdoors=texture2D(uGlassWorld,sphere).rgb;
        float grazing=1.-clamp(abs(dot(sight,glassN)),0.,1.);
        float fresnel=.031+.55*pow(grazing,4.);
        diffuseColor.rgb=mix(diffuseColor.rgb,outdoors*.64,fresnel);
      }
    `);
  };
  const mesh=new THREE.Mesh(geo,mat);
  mesh.name='Cabin surfaces, tapered fieldstone chimney, gable, logwork, porch and stair';
  group.add(mesh);
  if(exposure && ctx.groundY){
    // Light catcher follows the measured bank beneath the porch. Multiplication preserves soil and gravel.
    const groundVertices=[],groundIndex=[];
    const midpoint=mix(dl,dr,.5);
    const cols=30,rows=58;
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      const p=midpoint.clone().addScaledVector(across,(i/cols-.5)*6.0).addScaledVector(towards,(j/rows)*11.3-8.35);
      groundVertices.push(p.x,ctx.groundY(p.x,p.z)+.011,p.z);
      if(i<cols&&j<rows){const a=j*(cols+1)+i;groundIndex.push(a,a+1,a+cols+2,a,a+cols+2,a+cols+1);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(groundVertices,3));g.setIndex(groundIndex);
    const envelope=[dl,dr,fr,fl].map(p=>new THREE.Vector2(p.x,p.z));
    const interior=[fl,fr,br,bl].map(p=>new THREE.Vector2(p.x,p.z));
    const getWinding=polygon=>Math.sign(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%4];return sum+p.x*q.y-p.y*q.x;},0));
    const winding=getWinding(envelope),houseWinding=getWinding(interior);
    const catchMat=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.MultiplyBlending,
      uniforms:{uCabinVisibility:{value:exposure.target.texture},uCabinVP:{value:exposure.matrices},uCabinDirections:{value:exposure.dirs},uCenter:{value:midpoint},uAcross:{value:across},uTowards:{value:towards},uFloorPolygon:{value:envelope},uHousePolygon:{value:interior},uFloorWinding:{value:winding},uHouseWinding:{value:houseWinding},uFloorHeight:{value:dl.y}},
      vertexShader:'varying vec3 vPoint;void main(){vPoint=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vPoint,1.);}',
      fragmentShader:visibilityGL+`varying vec3 vPoint;uniform vec3 uCenter,uAcross,uTowards;uniform vec2 uFloorPolygon[4],uHousePolygon[4];uniform float uFloorWinding,uHouseWinding,uFloorHeight;
        void main(){vec2 sh=cabinShade(vPoint,vec3(0.,1.,0.)).xy;vec3 d=vPoint-uCenter;
          float along=dot(d,uTowards);float feather=(1.-smoothstep(2.46,2.94,abs(dot(d,uAcross))))*(1.-smoothstep(2.37,2.92,along))*smoothstep(-8.34,-7.68,along);
          float margin=20.,insideWall=20.;
          for(int i=0;i<4;i++){
            vec2 p=uFloorPolygon[i],q=uFloorPolygon[(i+1)-4*((i+1)/4)],edge=q-p,at=vPoint.xz-p;
            margin=min(margin,uFloorWinding*(edge.x*at.y-edge.y*at.x)/max(.001,length(edge)));
            vec2 h=uHousePolygon[i],g=uHousePolygon[(i+1)-4*((i+1)/4)],he=g-h,ha=vPoint.xz-h;
            insideWall=min(insideWall,uHouseWinding*(he.x*ha.y-he.y*ha.x)/max(.001,length(he)));
          }
          float separation=max(.09,uFloorHeight-vPoint.y),inward=max(0.,max(margin,insideWall));
          // Projected sky is blocked progressively farther under the raised boards.
          // Sunlit openings and the 3D spaces between the piers still reveal actual soil.
          float blockedSky=inward/sqrt(inward*inward+separation*separation);
          // The registered terrain photograph already records its own illumination from the shore camera.
          // Only the uncaptured contribution needs this additional floor-occlusion term.
          vec3 first=vec3(0.,2.05,0.)-vPoint,current=cameraPosition-vPoint;
          float photoConfidence=(1.-smoothstep(.002,.095,1.-dot(normalize(first),normalize(current))))*
            (1.-smoothstep(1.06,1.70,length(first)/max(.1,length(current))));
          float fill=.38*blockedSky*(1.-.98*photoConfidence);
          float shade=min(.72,.24*sh.x+.22*sh.y+fill)*feather;
          gl_FragColor=vec4(vec3(1.)-vec3(1.,.96,.88)*shade,1.);
        }`});
    const catchMesh=new THREE.Mesh(g,catchMat);catchMesh.name='Soft cabin contact shadows on the measured shore';catchMesh.renderOrder=1;group.add(catchMesh);
  }
  // Fieldstone has a softer diffuse response than the pine framing. Its indirect light
  // includes the warm, moss-covered bank and the real near-field visibility of the porch.
  const rockMaterial=new THREE.MeshBasicMaterial({map:graniteAtlas,vertexColors:true,side:THREE.DoubleSide,toneMapped:false});
  if(exposure)rockMaterial.onBeforeCompile=shader=>{
    shader.uniforms.uCabinVisibility={value:exposure.target.texture};
    shader.uniforms.uCabinVP={value:exposure.matrices};shader.uniforms.uCabinDirections={value:exposure.dirs};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRubblePoint;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvRubblePoint=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRubblePoint;\n'+visibilityGL)
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec3 geomN=normalize(cross(dFdx(vRubblePoint),dFdy(vRubblePoint)));
        vec2 oc=cabinShade(vRubblePoint,geomN).xy;
        diffuseColor.rgb*=1.-.27*oc.x-.20*oc.y;
      `);
  };
  const rubble=new THREE.Mesh(bearingGeo,rockMaterial);rubble.name='Granite bearings below the cabin sill and outer stair stringer';group.add(rubble);
  return {group,porch,chimney,ready,landmarks:{chimneyCap:roofCenter.clone(),roofPeak:peak.clone(),porchCenter:porch.clone(),porchLeft:dl.clone(),porchRight:dr.clone()},triangles:(indices.length+stonesIndex.length)/3};
}
