import * as T from './three.module.js';
import {clamp,smooth,smoother} from './calibration.js';

const Y=new T.Vector3(0,1,0),rollAxis=new T.Vector3(1,0,0);
const ankleInBoot=new T.Vector3(0,.084,.062);
const makeQuat=heading=>new T.Quaternion().setFromAxisAngle(Y,-heading);
// For 33 heel angles, intersect the original outsole triangles with the seven
// floorboards. Offsets in millimetres keep the leading tread on the local deck.
const heelRoll={
  right:{angle:-.205,offset:[-.02004,.38366,.76969,1.13980,1.50984,1.87981,2.21886,2.54231,2.86564,3.18882,3.51186,3.83472,4.15741,4.44209,4.70744,4.97258,5.23750,5.50219,5.76662,6.03080,6.29472,6.55835,6.82170,7.08474,7.34748,7.60989,7.87197,8.13370,8.39509,8.65611,8.91675,9.17701,9.43026]},
  left:{angle:-.168,offset:[-.01997,.36819,.69902,1.01634,1.31964,1.62291,1.92612,2.22927,2.53236,2.83537,3.13829,3.44112,3.70787,3.93851,4.15642,4.37421,4.59187,4.80940,5.02679,5.24403,5.46112,5.67805,5.89482,6.11142,6.32785,6.54409,6.76015,6.97601,7.19167,7.40713,7.62238,7.83740,8.05221]}
};

export function boardingWeight(t){
  const total=smooth(7.37,7.95,t);
  const trailing=.48*smoother(7.87,8.0,t);
  return {total,lead:total*(1-trailing),trail:total*trailing,lean:Math.exp(-Math.pow((t-7.65)/.245,2))};
}
export function buildFootwork(ctx,rig,asset,dyn){
  asset.dock.updateMatrixWorld(true);
  const stepTime=rig.stepLength/rig.speed,axis=rig.dockDir,right=rig.right;
  const deckH=asset.dockHeight,cast=new T.Raycaster(),down=new T.Vector3(0,-1,0);
  const signedHeading=(v)=>Math.atan2(v.x,-v.z);
  const dockHeading=signedHeading(axis);
  const dockLength=asset.dockLength;
  const dryLeftTime=6.635,dryRightTime=dryLeftTime-stepTime;
  const dryLeft=rig.exit.clone().addScaledVector(right,-.212).addScaledVector(axis,-.015);
  // A stance inside the open bay, between the forward seat and the next thwart.
  const planted={
    right:new T.Vector3(.038,-.0603802,(-.5+.343)*asset.boatLength),
    left:new T.Vector3(-.122,-.0592429,(-.5+.363)*asset.boatLength)
  };
  const aligned={right:makeQuat(.25),left:makeQuat(.055)};
  function top(p){
    const delta=p.clone().sub(asset.dockStart),along=delta.dot(axis),side=Math.abs(delta.dot(right));
    if(along>-.12&&along<dockLength+.1&&side<.55){
      cast.set(new T.Vector3(p.x,1.05,p.z),down);cast.far=.86;
      const h=cast.intersectObject(asset.dock,true).filter(h=>Math.abs(h.point.y-deckH)<.065);
      if(h.length)return h[0].point.y+.0012;
      return deckH+.0012;
    }
    return ctx.groundY(p.x,p.z)+.0012;
  }
  const plan={left:[],right:[]};
  for(const side of ['left','right']){
    const last=side==='left'?dryLeftTime:dryRightTime,sgn=side==='left'?-1:1;
    for(let k=-9;k<=0;k++){
      const time=last+k*2*stepTime;
      const distance=clamp(rig.speed*(time+.43*stepTime)/rig.length);
      const u=rig.curve.getUtoTmapping(distance),P=rig.curve.spine.getPoint(u);
      const tangent=rig.curve.spine.getTangent(u);tangent.y=0;tangent.normalize();
      const lateral=new T.Vector3(-tangent.z,0,tangent.x);
      P.addScaledVector(lateral,sgn*.097);
      if(k===0 && side==='left')P.copy(dryLeft);
      P.y=top(P);
      const heading=k===0?dockHeading+sgn*.065:signedHeading(tangent)+sgn*.064;
      plan[side].push({t:time,p:P,q:makeQuat(heading)});
    }
  }
  function dryStep(side,t){
    const series=plan[side],last=series[series.length-1];
    if(t>=last.t)return {sole:last.p.clone(),quaternion:last.q.clone(),load:1};
    let i=series.length-2;while(i>0&&t<series[i].t)i--;
    const a=series[i],b=series[i+1],phase=clamp((t-a.t)/(b.t-a.t));
    const swing=clamp((phase-.555)/.445),s=smoother(0,1,swing),arch=Math.sin(Math.PI*swing);
    const p=a.p.clone().lerp(b.p,s);p.y+=.075*arch**1.18;
    const q=a.q.clone().slerp(b.q,s);
    let pitch=-.18*smooth(.42,.555,phase)*(1-smooth(.555,.70,phase))+.20*arch*(s-.20);
    const tilted=q.clone().multiply(new T.Quaternion().setFromAxisAngle(rollAxis,pitch));
    if(pitch<0) p.y+=-.107*Math.sin(pitch);
    return {sole:p,quaternion:tilted,load:1-smooth(.43,.59,phase)};
  }
  function boatFoot(side){
    return {sole:planted[side].clone().applyMatrix4(asset.boat.matrixWorld),
      quaternion:asset.boat.quaternion.clone().multiply(aligned[side])};
  }
  function rollOntoSole(contact,angle,side){
    const toeBall=new T.Vector3(0,0,-.103);
    const fixed=toeBall.clone().applyQuaternion(contact.quaternion).add(contact.sole);
    contact.quaternion.multiply(new T.Quaternion().setFromAxisAngle(rollAxis,angle));
    contact.sole.copy(fixed).sub(toeBall.applyQuaternion(contact.quaternion));
    const curve=heelRoll[side],key=clamp(angle/curve.angle)*32,i=Math.min(31,Math.floor(key));
    const height=T.MathUtils.lerp(curve.offset[i],curve.offset[i+1],key-i)*.001;
    contact.sole.addScaledVector(Y.clone().applyQuaternion(asset.boat.quaternion),-height);
    return contact;
  }
  function legContact(side,t){
    const launch=side==='right'?6.675:7.535, touch=side==='right'?7.37:7.87;
    const dry=dryStep(side,t), wet=boatFoot(side),load=boardingWeight(t);
    if(t<launch){
      if(side==='left'&&t>=7.37)dry.load=1-load.total;
      return dry;
    }
    const heelAngle=heelRoll[side].angle,rollTime=side==='right'?.161:.112;
    if(t>=touch){
      const foot=rollOntoSole(wet,heelAngle*(1-smoother(touch,touch+rollTime,t)),side);
      return {...foot,load:side==='right'?load.lead:load.trail};
    }
    const u=clamp((t-launch)/(touch-launch)),last=plan[side].at(-1);
    const s=smoother(0,side==='right'?.90:.84,u),p=last.p.clone().lerp(wet.sole,s);
    // Keep the landing foot over the gunwale until the entire sole clears its rail.
    const h=smoother(side==='right'?.58:.59,1,u);
    p.y=T.MathUtils.lerp(last.p.y,wet.sole.y,h)+(side==='right'?.078:.087)*Math.sin(Math.PI*u)**1.35;
    const q=last.q.clone().slerp(wet.quaternion,s);
    const r=.15*Math.sin(Math.PI*u)*Math.sin(Math.PI*(u-.20));
    q.multiply(new T.Quaternion().setFromAxisAngle(rollAxis,r));
    return rollOntoSole({sole:p,quaternion:q,load:0},heelAngle*smoother(.61,1,u),side);
  }
  const shadowFeet=[new T.Vector4(),new T.Vector4()],shadowAxis=[new T.Vector2(),new T.Vector2()];
  function pose(t,view) {
    const bodyHeading=dockHeading*smoother(.15,3.4,t)+.27*smoother(4.7,6.9,t)-
      .67*smoother(8.20,11.20,t);
    const fwd=new T.Vector3(Math.sin(bodyHeading),0,-Math.cos(bodyHeading));
    const lateral=new T.Vector3(-fwd.z,0,fwd.x);
    const lean=smoother(4.7,6.9,t)*(1-.66*smoother(8.12,9.8,t));
    const pelvis=new T.Vector3(...view.eye).addScaledVector(fwd,-(.145+.159*lean));
    pelvis.y-=.64-.035*lean;
    const result={},contacts={left:legContact('left',t),right:legContact('right',t)};
    const thigh=.424,calf=.418;
    for(const [index,side] of ['left','right'].entries()){
      const f=contacts[side],ankle=ankleInBoot.clone().applyQuaternion(f.quaternion).add(f.sole);
      const hip=pelvis.clone().addScaledVector(lateral,index===0?-.107:.107);
      const planar=(hip.x-ankle.x)**2+(hip.z-ankle.z)**2;
      const ceiling=ankle.y+Math.sqrt(Math.max(.01,(thigh+calf-.003)**2-planar));
      pelvis.y=Math.min(pelvis.y,ceiling);
    }
    for(const [index,side] of ['left','right'].entries()){
      const sgn=side==='left'?-1:1,f=contacts[side];
      const hip=pelvis.clone().addScaledVector(lateral,sgn*.107);
      const ankle=ankleInBoot.clone().applyQuaternion(f.quaternion).add(f.sole);
      const line=ankle.clone().sub(hip),d=line.length();line.multiplyScalar(1/Math.max(.01,d));
      const joint=T.MathUtils.clamp((thigh*thigh-calf*calf+d*d)/(2*Math.max(.01,d)),.01,thigh);
      const bend=Math.sqrt(Math.max(.0003,thigh*thigh-joint*joint));
      const hint=fwd.clone().addScaledVector(lateral,sgn*.15);
      hint.addScaledVector(line,-hint.dot(line)).normalize();
      const knee=hip.clone().addScaledVector(line,joint).addScaledVector(hint,bend);
      result[side]={...f,hip,knee,ankle};
      shadowFeet[index].set(f.sole.x,f.sole.y,f.sole.z,f.load);
      const toe=new T.Vector3(0,0,-1).applyQuaternion(f.quaternion);
      shadowAxis[index].set(toe.x,toe.z).normalize();
    }
    return result;
  }
  return {pose,shadowFeet,shadowAxis,planted,plan,dimensions:{length:.263,width:.100,ankle:ankleInBoot},times:{leadLift:6.675,leadTouch:7.37,trailLift:7.535,trailTouch:7.87}};
}
