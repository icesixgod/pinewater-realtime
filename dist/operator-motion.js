import * as T from './three.module.js';
import {gaitFit,contactFit} from './operator-traces.js';

const limit=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const fade=(a,b,t)=>{const q=limit((t-a)/(b-a),0,1);return q*q*q*(q*(q*6-15)+10);};
const mix=(a,b,u)=>a+(b-a)*u;
const clampFrames=t=>fade(0,.19,t)*fade(0,.21,Math.abs(t-2.25))*fade(0,.20,Math.abs(t-7));
function measuredWalk(t,step){
  const cycle=(t-6.635)/(2*step),angle=2*Math.PI*cycle,w=.5-.45*Math.cos(Math.PI*(cycle+.20));
  const cadence=[1];for(let i=1;i<=5;i++)cadence.push(Math.cos(angle*i),Math.sin(angle*i));
  const v=[];for(let c=0;c<6;c++){let a=0,b=0;for(let k=1;k<cadence.length;k++){a+=gaitFit[0][c][k]*cadence[k];b+=gaitFit[1][c][k]*cadence[k];}v[c]=mix(a,b,w);}return v;
}
function recordedTouch(side,elapsed){
  const x=(elapsed+.12)/.04,table=contactFit[side],last=table[0].length-1;
  if(x<=0||x>=last)return [0,0,0,0,0,0];
  const i=Math.floor(x),u=x-i,u2=u*u,u3=u2*u;
  return table.map(channel=>{const a=channel[Math.max(0,i-1)],b=channel[i],c=channel[i+1],d=channel[Math.min(last,i+2)];return .5*((2*b)+(-a+c)*u+(2*a-5*b+4*c-d)*u2+(-a+3*b-3*c+d)*u3);});
}
function observed(t,step){
  const walk=measuredWalk(t,step),w=clampFrames(t)*fade(0,.36,t)*(1-fade(6.68,7.00,t));
  const lead=recordedTouch('right',t-7.37),trail=recordedTouch('left',t-7.87),support=clampFrames(t);
  const unit=[.001,.001,.001,Math.PI/180,Math.PI/180,Math.PI/180];
  const a=[.42,1,1,.53,.57,.55],b=[.42,.83,1,.42,.62,.50];
  return unit.map((scale,i)=>scale*(w*a[i]*walk[i]+support*b[i]*(lead[i]+.72*trail[i])));
}
function find(a,v){let lo=0,hi=a.length-1;while(hi-lo>1){const m=(hi+lo)>>1;if(a[m]<=v)lo=m;else hi=m;}return lo;}
function interpolateGeometry(ts,p,i,q,out){
  const j=i+1,a=Math.max(i-1,0),d=Math.min(j+1,ts.length-1),h=ts[j]-ts[i],f=(q-ts[i])/h,f2=f*f,f3=f2*f;
  const h0=2*f3-3*f2+1,h1=-2*f3+3*f2,m0=(f3-2*f2+f)*h/(ts[j]-ts[a]),m1=(f3-f2)*h/(ts[d]-ts[i]);
  return out.set(h0*p[i].x+h1*p[j].x+m0*(p[j].x-p[a].x)+m1*(p[d].x-p[i].x),h0*p[i].y+h1*p[j].y+m0*(p[j].y-p[a].y)+m1*(p[d].y-p[i].y),h0*p[i].z+h1*p[j].z+m0*(p[j].z-p[a].z)+m1*(p[d].z-p[i].z));
}
class OperatorCurve extends T.Curve{
  constructor(base,us,positions,gateIndices,gateArc){
    super();this.base=base;this.spine=base.spine;this.parameter=us;this.positions=positions;this.exitLength=base.exitLength;this.survey=base.survey;this.arcLengthDivisions=18000;
    const arc=[0],parameter=[0],previous=positions[0].clone(),at=new T.Vector3(),substeps=8;let measured=0;
    for(let i=0;i<positions.length-1;i++)for(let j=1;j<=substeps;j++){
      const u=mix(us[i],us[i+1],j/substeps);interpolateGeometry(us,positions,i,u,at);measured+=at.distanceTo(previous);previous.copy(at);parameter.push(u);arc.push(measured);
    }
    this.measuredLength=measured;
    const measuredGates=gateIndices.map(i=>arc[i*substeps]);
    for(let k=0;k<gateIndices.length-1;k++){
      const start=gateIndices[k]*substeps,end=gateIndices[k+1]*substeps,actual=measuredGates[k+1]-measuredGates[k],wanted=gateArc[k+1]-gateArc[k];
      for(let i=start+(k?1:0);i<=end;i++)arc[i]=gateArc[k]+(arc[i]-measuredGates[k])*wanted/actual;
    }
    this.arc=arc;this.arcParameter=parameter;
  }
  gait(u){return this.base.gait(u);}
  getLength(){return this.arc[this.arc.length-1];}
  getUtoTmapping(f,distance){const s=limit(distance??f*this.getLength(),0,this.getLength()),i=find(this.arc,s);return mix(this.arcParameter[i],this.arcParameter[i+1],(s-this.arc[i])/(this.arc[i+1]-this.arc[i]));}
  getPoint(u,out=new T.Vector3()){const q=limit(u,0,1);return interpolateGeometry(this.parameter,this.positions,find(this.parameter,q),q,out);}
}

export function buildOperatorMotion(base,length,speed,stepLength){
  const step=stepLength/speed,anchors=[0,2.25*speed,7*speed,length],anchorTimes=[0,2.25,7,8],path=[],ts=[],gates=[0],scales=[];
  for(let k=0;k<3;k++){
    const s0=anchors[k],s1=anchors[k+1],wanted=s1-s0,intervals=Math.ceil((anchorTimes[k+1]-anchorTimes[k])*700),p0=[],offset=[],u0=[];
    for(let j=0;j<=intervals;j++){
      const t=mix(anchorTimes[k],anchorTimes[k+1],j/intervals),su=t-7,s=t<=7?speed*t:speed*(7+.5*(su+Math.sin(Math.PI*su)/Math.PI)),u=base.getUtoTmapping(s/length),original=base.getPoint(u),spine=base.spine.getPoint(u),tangent=base.spine.getTangent(u);
      tangent.y=0;tangent.normalize();const right=new T.Vector3(-tangent.z,0,tangent.x),g=observed(t,step),walk=t<=7;
      const preserve=clampFrames(t)*fade(0,.17,8-t),remove=.82*preserve;
      const reference=original.clone().lerp(spine,remove),shape=tangent.multiplyScalar(g[0]).addScaledVector(right,-g[1]);shape.y=g[2];
      if(!walk)shape.multiplyScalar(fade(0,.20,8-t)*(.16+.84*Math.cos((t-7)*Math.PI*.5)));
      p0.push(reference);offset.push(shape);u0.push(u);
    }
    function arcLength(scale){let sum=0;for(let j=1;j<p0.length;j++){const a=p0[j-1],b=p0[j],pa=offset[j-1],pb=offset[j];sum+=Math.hypot(b.x-a.x+scale*(pb.x-pa.x),b.y-a.y+scale*(pb.y-pa.y),b.z-a.z+scale*(pb.z-pa.z));}return sum;}
    let lo=0,hi=1;while(arcLength(hi)<wanted&&hi<16)hi*=2;
    for(let n=0;n<35;n++){const m=.5*(lo+hi);if(arcLength(m)<wanted)lo=m;else hi=m;}
    const scale=(lo+hi)*.5;scales.push({scale,neutralLength:arcLength(0),sampleLength:arcLength(scale),targetLength:wanted});
    for(let j=k?1:0;j<p0.length;j++){const p=p0[j].addScaledVector(offset[j],scale);path.push(p);ts.push(u0[j]);}gates.push(path.length-1);
  }
  const curve=new OperatorCurve(base,ts,path,gates,anchors);
  return {curve,scales,angles(t){const terms=observed(t,step);return {yaw:-terms[3],down:-terms[4],roll:-terms[5],walk:clampFrames(t)*fade(0,.36,t)*(1-fade(6.68,7.00,t)),landing:fade(7.19,7.38,t)*(1-fade(8.16,8.39,t))};}};
}
