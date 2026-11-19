// Linear radiation from the moving, wetted canoe in its local basin.
// Elevation and horizontal volume flux are advanced on a staggered grid.
// A Fourier multiplier supplies finite-depth gravity/capillary dispersion.
const N = 128, cell = .048, span = N*cell, duration = 12, fps = 24;
const substeps = 4, dt = 1/(fps*substeps), g = 9.81, tension = .000073;
const stations = 32, rows = 100, y0 = -.19, dy = .0042;
const pointX = i => (i+.5)*cell-span*.5;
const limit = (v,lo,hi) => Math.min(hi,Math.max(lo,v));

function hullSections(asset){
  const mesh=asset.boat.children.find(o=>o.name.includes('red-oxide strakes'));
  const p=mesh.geometry.attributes.position.array, ind=mesh.geometry.index.array;
  const zMin=asset.waterlineMinZ-.02,zMax=asset.waterlineMaxZ+.02,ds=(zMax-zMin)/stations;
  const strips=Array.from({length:stations},(_,i)=>({z:zMin+(i+.5)*ds, ds, w:[new Float32Array(rows),new Float32Array(rows)], keel:[0,0]}));
  // Intersect each real strake triangle with fixed longitudinal/vertical planes.
  for(let i=0;i<ind.length;i+=3){
    const a=3*ind[i],b=3*ind[i+1],c=3*ind[i+2];
    const zA=p[a+2],yA=p[a+1],ez=p[b+2]-zA,ey=p[b+1]-yA,fz=p[c+2]-zA,fy=p[c+1]-yA;
    const det=ez*fy-ey*fz;if(Math.abs(det)<1e-10)continue;
    const si=limit(Math.ceil((Math.min(zA,p[b+2],p[c+2])-zMin)/ds-.5),0,stations-1);
    const sj=limit(Math.floor((Math.max(zA,p[b+2],p[c+2])-zMin)/ds-.5),0,stations-1);
    const ri=limit(Math.ceil((Math.min(yA,p[b+1],p[c+1])-y0)/dy),0,rows-1);
    const rj=limit(Math.floor((Math.max(yA,p[b+1],p[c+1])-y0)/dy),0,rows-1);
    for(let s=si;s<=sj;s++)for(let j=ri;j<=rj;j++){
      const z=strips[s].z-zA,y=y0+j*dy-yA;
      const u=(z*fy-y*fz)/det,v=(ez*y-ey*z)/det;
      if(u<-.00005||v<-.00005||u+v>1.00005)continue;
      const x=p[a]+u*(p[b]-p[a])+v*(p[c]-p[a]),line=strips[s].w[Number(x>=0)];
      line[j]=Math.max(line[j],Math.abs(x));
    }
  }
  for(const section of strips)for(let side=0;side<2;side++){
    const w=section.w[side];let first=w.findIndex(v=>v>.001);
    if(first<0)first=rows-1;
    section.keel[side]=y0+first*dy;
    const neutral=asset.waterlineAt(section.z);
    for(let j=first+1;j<rows;j++)if(w[j]===0)w[j]=w[j-1]||neutral;
  }
  return strips;
}

function halfDisplacement(section,side,state,ambient,baseline){
  const sign=side*2-1,w=section.w[side];
  const cp=Math.cos(state.pitch),sp=Math.sin(state.pitch),cr=Math.cos(state.roll),sr=Math.sin(state.roll);
  // The transform is the same Y-X-Z rotation applied to the visible hull.
  const c=cp*cr,r=cp*sr*sign,h=state.h-sp*section.z-ambient;
  const surface=(x)=>-(h+r*x)/c;
  let y=surface(baseline);
  for(let i=0;i<2;i++){
    const row=limit((y-y0)/dy,0,rows-1.001),j=Math.floor(row);
    y=surface(w[j]+(w[j+1]-w[j])*(row-j));
  }
  const row=limit((y-y0)/dy,0,rows-1.001),j=Math.floor(row);
  const width=w[j]+(w[j+1]-w[j])*(row-j);
  // Vertical strips of the actual section. Only the narrow contact band needs
  // clipping against the tilted water plane. Interior, fully submerged rows
  // contribute the same solid area in either rigid pose.
  let area=0;
  for(let k=0;k<rows-1;k++){
    const yg=y0+(k+.5)*dy,ww=(w[k]+w[k+1])*.5;
    if(ww<.0001)continue;
    const v=h+c*yg;
    if(v+Math.max(0,r*ww)<0)area+=ww*dy;
    else if(v+Math.min(0,r*ww)<0 && Math.abs(r)>1e-8)area+=(r>0?limit(-v/r,0,ww):ww-limit(-v/r,0,ww))*dy;
  }
  // Correct the last quadrature cell analytically to avoid a staircase at
  // nearly level trim. This is the exact integral of the linear waterplane.
  const wallY=surface(width),centreY=surface(0),minY=Math.min(wallY,centreY),maxY=Math.max(wallY,centreY);
  const rowA=limit(Math.floor((minY-y0)/dy)-1,0,rows-2),rowB=limit(Math.ceil((maxY-y0)/dy)+1,0,rows-2);
  for(let k=rowA;k<=rowB;k++){
    const bottom=y0+k*dy,ww=(w[k]+w[k+1])*.5;
    if(ww<.0001)continue;
    const vm=h+c*(bottom+dy*.5);let previous=0;
    if(vm+Math.max(0,r*ww)<0)previous=ww*dy;
    else if(vm+Math.min(0,r*ww)<0&&Math.abs(r)>1e-8)previous=(r>0?limit(-vm/r,0,ww):ww-limit(-vm/r,0,ww))*dy;
    const h0=surface(0)-bottom,h1=surface(ww)-bottom;
    const primitive=v=>v<=0?0:v<dy?v*v*.5:dy*(v-dy*.5);
    const clipped=Math.abs(h1-h0)>1e-8?(primitive(h1)-primitive(h0))/(h1-h0):limit(h0,0,dy);
    area+=ww*clipped-previous;
  }
  return {area, x:sign*width*cr-sr*y, z:section.z*cp+sp*(sr*sign*width+cr*y), width};
}

// In-place radix-two transform with cached twiddles. The finite-volume
// derivative is used consistently in the dispersion symbol, including near
// the grid's shortest resolved wavelengths.
function spectralFilter(){
  const reverse=new Uint16Array(N),cs=new Float64Array(N/2),sn=new Float64Array(N/2);
  const symbol=new Float64Array(N*N),re=new Float64Array(N*N),im=new Float64Array(N*N);
  const rowR=new Float64Array(N),rowI=new Float64Array(N);
  for(let i=0;i<N;i++){let n=i,r=0;for(let j=1;j<N;j*=2){r=2*r+(n&1);n>>=1;}reverse[i]=r;}
  for(let i=0;i<N/2;i++){cs[i]=Math.cos(2*Math.PI*i/N);sn[i]=Math.sin(2*Math.PI*i/N);}
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const k=2/cell*Math.hypot(Math.sin(Math.PI*x/N),Math.sin(Math.PI*y/N));
    symbol[y*N+x]=k>.0001?(g+tension*k*k)*Math.tanh(k*.82)/k:g*.82;
  }
  function transform(line,imag,sign){
    for(let i=0;i<N;i++){const j=reverse[i];if(j>i){let t=line[i];line[i]=line[j];line[j]=t;t=imag[i];imag[i]=imag[j];imag[j]=t;}}
    for(let len=2;len<=N;len*=2){
      const mid=len/2,advance=N/len;
      for(let base=0;base<N;base+=len)for(let j=0;j<mid;j++){
        const k=j*advance,a=base+j,b=a+mid,c=cs[k],s=sign*sn[k];
        const x=c*line[b]-s*imag[b],y=c*imag[b]+s*line[b],ax=line[a],ay=imag[a];
        line[a]=ax+x;imag[a]=ay+y;line[b]=ax-x;imag[b]=ay-y;
      }
    }
  }
  function linePass(data,imag,vertical,sign){
    for(let row=0;row<N;row++){
      const base=vertical?row:row*N,step=vertical?N:1;
      for(let i=0;i<N;i++){rowR[i]=data[base+i*step];rowI[i]=imag[base+i*step];}
      transform(rowR,rowI,sign);
      for(let i=0;i<N;i++){data[base+i*step]=rowR[i];imag[base+i*step]=rowI[i];}
    }
  }
  return function apply(height,surface){
    re.set(height);im.fill(0);
    linePass(re,im,false,-1);linePass(re,im,true,-1);
    for(let i=0;i<re.length;i++){re[i]*=symbol[i];im[i]*=symbol[i];}
    linePass(re,im,true,1);linePass(re,im,false,1);
    for(let i=0;i<re.length;i++)surface[i]=re[i]/(N*N);
  };
}

export function buildHullRadiation(THREE,ctx,dyn,asset,ambientWater){
  const strips=hullSections(asset),total=N*N,wet=new Float32Array(total),damp=new Float32Array(total);
  const openX=new Float32Array(total),openZ=new Float32Array(total),height=new Float32Array(total);
  const fluxX=new Float32Array(total),fluxZ=new Float32Array(total),head=new Float32Array(total);
  const driftX=new Float32Array(total),driftZ=new Float32Array(total);
  const pressure=new Float32Array(total),prev=new Float64Array(stations*2),prevW=new Float64Array(stations*2);
  const boundaryPositions=asset.posts.map((p,i)=>({x:p.x,z:p.z,r:asset.postRadii[i]}));
  const c=Math.cos(dyn.yaw),s=Math.sin(dyn.yaw),origin=dyn.origin;
  const world=(x,z)=>[origin.x+c*x+s*z,origin.z-s*x+c*z];
  const filter=spectralFilter(),empty=new Float32Array(total),flat=new Uint8Array(4*total);
  const heights=[],snapshots=[],flowSnapshots=[],sourceHistory=[],fields=[];
  for(let i=0;i<total;i++){flat[i*4]=128;flat[i*4+2]=128;flat[i*4+3]=128;}
  const texture=new THREE.DataTexture(flat,N,N,THREE.RGBAFormat,THREE.UnsignedByteType);
  texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  const noFlow=new Uint8Array(total*4);for(let i=0;i<total;i++){noFlow[4*i]=128;noFlow[4*i+2]=128;}
  const flowTexture=new THREE.DataTexture(noFlow,N,N,THREE.RGBAFormat,THREE.UnsignedByteType);
  flowTexture.minFilter=flowTexture.magFilter=THREE.LinearFilter;flowTexture.needsUpdate=true;
  for(let iz=0;iz<N;iz++)for(let ix=0;ix<N;ix++){
    const idx=iz*N+ix,x=pointX(ix),z=pointX(iz),w=world(x,z);
    const drop=1.7*Math.max(0,(Math.max(Math.abs(x),Math.abs(z))-2.20)/(.5*span-2.2))**2;
    damp[idx]=Math.exp(-dt*(.085+drop*9.));
    const width=asset.waterlineAt(z);let open=width>0?limit((Math.abs(x)-width+.025)/cell,0,1):1;
    for(const p of boundaryPositions){
      const gap=Math.hypot(w[0]-p.x,w[1]-p.z)-p.r;
      open=Math.min(open,limit(gap/cell+.5,0,1));
    }
    const depth=-ctx.groundY(w[0],w[1]);
    wet[idx]=open*limit(depth/.035+.24,0,1);
  }
  for(let z=0;z<N-1;z++)for(let x=0;x<N-1;x++){const i=z*N+x;openX[i]=Math.min(wet[i],wet[i+1]);openZ[i]=Math.min(wet[i],wet[i+N]);}
  function inject(x,z,volume,velocity){
    // Two-cell regularization of the boundary source conserves its swept
    // volume after removing dry hull and pile cells. The velocity pressure is
    // the local kinetic head of water entering/leaving the strake contact.
    const ix=(x+span/2)/cell-.5,iz=(z+span/2)/cell-.5;
    const xc=Math.round(ix),zc=Math.round(iz);let sum=0;
    for(let j=-2;j<=2;j++)for(let k=-2;k<=2;k++){
      const idx=(zc+j)*N+xc+k,dx=xc+k-ix,dz=zc+j-iz;
      sum+=wet[idx]*Math.exp(-.5*(dx*dx/.49+dz*dz/1.40));
    }
    if(sum<.001)return;
    for(let j=-2;j<=2;j++)for(let k=-2;k<=2;k++){
      const idx=(zc+j)*N+xc+k,dx=xc+k-ix,dz=zc+j-iz;
      const weight=wet[idx]*Math.exp(-.5*(dx*dx/.49+dz*dz/1.40))/sum;
      height[idx]+=weight*volume/(cell*cell);
      pressure[idx]+=weight*.5*velocity*Math.abs(velocity)*.9;
    }
  }
  function pump(t){
    const actual=dyn.sample(t),free=dyn.sampleUnloaded(t);let changed=0;const sides=[];
    for(let i=0;i<strips.length;i++)for(let side=0;side<2;side++){
      const section=strips[i],w=asset.waterlineAt(section.z),sgn=side*2-1,k=i*2+side;
      const xy=world(sgn*w,section.z),ambient=ambientWater(xy[0],xy[1],t);
      const a=halfDisplacement(section,side,actual,ambient,w);
      const b=halfDisplacement(section,side,free,ambient,w);
      const swept=(a.area-b.area)*section.ds;
      const dV=swept-prev[k];prev[k]=swept;
      const horizontal=a.x-b.x,vd=-(actual.dh-free.dh)+(actual.dp-free.dp)*section.z-(actual.dr-free.dr)*sgn*a.width;
      const normalSpeed=vd+(horizontal-prevW[k])/dt*sgn;prevW[k]=horizontal;
      inject(a.x+sgn*cell*.55,a.z,dV,normalSpeed);
      sides.push([a.x,a.z,dV/dt,normalSpeed]);changed+=Math.abs(dV);
    }
    return {sides,volume:prev.reduce((n,v)=>n+v,0),changed};
  }
  function save(frame,law){
    const raw=height.slice(),bytes=new Uint8Array(total*4),flowBytes=new Uint8Array(total*4);
    let max=0,peakSlope=0;
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){
      const k=j*N+i,left=wet[k-1]>.10?raw[k-1]:raw[k],right=wet[k+1]>.10?raw[k+1]:raw[k];
      const bottom=wet[k-N]>.10?raw[k-N]:raw[k],top=wet[k+N]>.10?raw[k+N]:raw[k];
      const ex=(right-left)/(2*cell),ez=(top-bottom)/(2*cell);
      const h=limit(Math.round(32768+raw[k]*400000),0,65535);
      bytes[4*k]=h>>8;bytes[4*k+1]=h&255;bytes[4*k+2]=limit(Math.round(128+ex*240),0,255);bytes[4*k+3]=limit(Math.round(128+ez*240),0,255);
      const xx=limit(Math.round(32768+driftX[k]*180000),0,65535),zz=limit(Math.round(32768+driftZ[k]*180000),0,65535);
      flowBytes[4*k]=xx>>8;flowBytes[4*k+1]=xx&255;flowBytes[4*k+2]=zz>>8;flowBytes[4*k+3]=zz&255;
      if(wet[k]>.4){max=Math.max(max,Math.abs(raw[k]));peakSlope=Math.max(peakSlope,Math.hypot(ex,ez));}
    }
    heights[frame]=raw;snapshots[frame]=bytes;flowSnapshots[frame]=flowBytes;sourceHistory[frame]=law;fields[frame]={max,peakSlope};
  }
  // The source is the extra volume relative to the same canoe freely floating
  // on the same incident waves. Before weight transfer the two trajectories
  // coincide exactly, giving a homogeneous equation and the captured surface.
  let active=false;
  for(let n=0;n<=duration*fps;n++){
    let law=null;
    for(let k=0;k<(n?substeps:1);k++){
      const t=n?(n-1+(k+1)/substeps)/fps:0;
      const a=dyn.sample(t),b=dyn.sampleUnloaded(t);
      if(!active && Math.abs(a.h-b.h)+Math.abs(a.roll-b.roll)+Math.abs(a.pitch-b.pitch)<1e-12)continue;
      active=true;pressure.fill(0);law=pump(t);
      filter(height,head);
      for(let i=0;i<total;i++)head[i]+=pressure[i];
      for(let z=1;z<N-1;z++)for(let x=1;x<N-1;x++){
        const i=z*N+x;
        fluxX[i]=(fluxX[i]-(dt/cell)*openX[i]*(head[i+1]-head[i]))*damp[i];
        fluxZ[i]=(fluxZ[i]-(dt/cell)*openZ[i]*(head[i+N]-head[i]))*damp[i];
      }
      for(let z=1;z<N-1;z++)for(let x=1;x<N-1;x++){
        const i=z*N+x;
        height[i]=(height[i]-(dt/cell)*(fluxX[i]-fluxX[i-1]+fluxZ[i]-fluxZ[i-N]))*damp[i];
        // Orbital surface displacement from the section's depth-integrated
        // flux. A 0.72 m gravity wave has a 0.115 m velocity e-folding depth.
        driftX[i]=(driftX[i]+dt*(fluxX[i]+fluxX[i-1])/.230)*damp[i];
        driftZ[i]=(driftZ[i]+dt*(fluxZ[i]+fluxZ[i-N])/.230)*damp[i];
      }
    }
    if(active)save(n,law);
    else{heights[n]=empty;snapshots[n]=flat;flowSnapshots[n]=noFlow;sourceHistory[n]={sides:[],volume:0};fields[n]={max:0,peakSlope:0};}
  }
  let displayed=-1;
  function at(x,z,t){
    const n=limit(Math.round(t*fps),0,snapshots.length-1),fx=(x+span/2)/cell-.5,fz=(z+span/2)/cell-.5;
    if(fx<0||fz<0||fx>N-2||fz>N-2)return 0;
    const ix=Math.floor(fx),iz=Math.floor(fz),ax=fx-ix,az=fz-iz,h=heights[n],i=iz*N+ix;
    return (1-az)*(h[i]*(1-ax)+h[i+1]*ax)+az*(h[i+N]*(1-ax)+h[i+N+1]*ax);
  }
  return {texture,flowTexture,span,cell,size:N,fields,sourceHistory,at,wet,heights,flowSnapshots,sections:strips.map(p=>({z:p.z,ds:p.ds})),
    update(t){const frame=limit(Math.round(t*fps),0,snapshots.length-1);if(frame!==displayed){texture.image.data=snapshots[frame];texture.needsUpdate=true;flowTexture.image.data=flowSnapshots[frame];flowTexture.needsUpdate=true;displayed=frame;}}};
}
