import * as THREE from './three.module.js';
import {pitch,verticalFov,startEye,clamp,smoother} from './calibration.js';
import {boardingWeight} from './locomotion.js';
import {buildOperatorMotion} from './operator-motion.js';

const rad=THREE.MathUtils.degToRad, lerp=THREE.MathUtils.lerp;
const stepLength=.702;
const up=new THREE.Vector3(0,1,0);
const sin=Math.sin,cos=Math.cos;

class WalkingCurve extends THREE.Curve {
  constructor(points, count) {
    super();
    this.spine=new THREE.CatmullRomCurve3(points,false,'centripetal');
    this.spine.arcLengthDivisions=1800;
    this.survey=this.spine.getLengths(1800);
    this.exitLength=this.survey[1400];  // knot 7 of the nine centripetal intervals
    this.arcLengthDivisions=count;
  }
  gait(u){
    const index=clamp(u)*1800,j=Math.min(1799,Math.floor(index));
    const distance=lerp(this.survey[j],this.survey[j+1],index-j);
    const envelope=smoother(0,.39,distance)*(1-smoother(this.exitLength-.63,this.exitLength,distance));
    const p=2*Math.PI*(distance/stepLength+.034*sin(distance*1.05)+.013*sin(distance*2.83)+.055);
    // The head rises between transfers of weight, then settles over the new stance foot.
    const y=envelope*(.0215*(-cos(p)+.14*sin(2*p-.43))+.0028*sin(p*.5+.8));
    const side=envelope*(.027*sin(.5*p-.49)+.0035*sin(1.5*p+.87));
    return {p,envelope,y,side,distance};
  }
  getPoint(u,out=new THREE.Vector3()){
    this.spine.getPoint(u,out);
    const g=this.gait(u);
    if(g.envelope>0){
      const tan=this.spine.getTangent(u),inv=1/Math.max(.00001,Math.hypot(tan.x,tan.z));
      out.x-=tan.z*inv*g.side;out.z+=tan.x*inv*g.side;out.y+=g.y;
    }
    if(g.distance>this.exitLength){
      const v=(g.distance-this.exitLength)/(this.survey[1800]-this.exitLength);
      // Knee compression as the lead sole takes the moving hull, followed by recovery.
      const compression=-.052*Math.exp(-((v-.755)**2)/.0105)+.015*Math.exp(-((v-.943)**2)/.002);
      out.y+=compression*smoother(0,.14,v)*(1-smoother(.968,1,v));
    }
    return out;
  }
}

export function buildPassage(asset,cabin,dyn) {
  const dockA=asset.dockStart.clone(),dockB=asset.dockEnd.clone(),stand=1.55,boardStand=1.505,dryEye=stand+asset.dockHeight;
  const dockDir=dockB.clone().sub(dockA);dockDir.y=0;dockDir.normalize();
  const right=new THREE.Vector3(-dockDir.z,0,dockDir.x);
  const contact=asset.portEntry.clone(),nominalExit=asset.dockExit.clone();
  const longitudinal=nominalExit.clone().sub(dockA).dot(dockDir);
  const onDeck=(s,dx=0)=>{
    const p=dockA.clone().addScaledVector(dockDir,s).addScaledVector(right,dx);
    p.y=dryEye;return p;
  };
  const exit=nominalExit.clone();exit.y=dryEye-.080;
  const c=Math.cos(dyn.yaw),s=Math.sin(dyn.yaw),across=new THREE.Vector3(c,0,-s);
  const axis=new THREE.Vector3(s,0,c);
  const inverseBase=new THREE.Matrix4().compose(dyn.origin,new THREE.Quaternion().setFromAxisAngle(up,dyn.yaw),new THREE.Vector3(1,1,1)).invert();
  function supportedEye(localFoot) {
    const foot=localFoot.clone().applyMatrix4(asset.boat.matrixWorld);
    return foot.addScaledVector(up,boardStand*.67).addScaledVector(up.clone().applyQuaternion(asset.boat.quaternion),boardStand*.33);
  }
  dyn.apply(8);
  function candidate(offset,resolution) {
    const base=asset.landing.clone().addScaledVector(across,offset).addScaledVector(axis,.073);
    const localFoot=base.clone().applyMatrix4(inverseBase);
    const end=supportedEye(localFoot),inner=exit.clone().lerp(end,.49);
    // A gentle push from the stance leg precedes the drop into the hull.
    inner.y=lerp(exit.y,end.y,.31)+.012;
    const controls=[startEye.clone(),new THREE.Vector3(-.17,2.032,-1.52),
      new THREE.Vector3(dockA.x-.15,1.947,dockA.z+.88),onDeck(0),
      onDeck(longitudinal*.33),onDeck(longitudinal*.69,.015),
      onDeck(longitudinal-.41,.12).addScaledVector(up,-.024),exit,inner,end];
    const curve=new WalkingCurve(controls,resolution);
    const table=curve.getLengths(resolution);
    return {base,localFoot,end,controls,curve,offset,error:table[table.length-1]*14/15-table[resolution*7/9]};
  }
  let lo=-.228,hi=.12;
  for(let i=0;i<20;i++){
    const m=(lo+hi)*.5;
    if(candidate(m,1800).error>0)hi=m;else lo=m;
  }
  const {base,localFoot,end,controls,curve:surveyCurve,offset}=candidate((lo+hi)*.5,18000);
  const length=surveyCurve.getLength(),speed=length/7.5;
  const operator=buildOperatorMotion(surveyCurve,length,speed,stepLength),curve=operator.curve;
  const endFov=76.8;
  const aheadOfBow=new THREE.Vector3(.66,.24,(-.5+.047)*dyn.length);
  function distance(t){
    if(t<=7)return speed*clamp(t,0,7);
    if(t>=8)return length;
    const u=t-7;return speed*(7+(u+sin(Math.PI*u)/Math.PI)*.5);
  }
  function cruise(t) {
    if(t<0||t>=8)return 0;
    return t<=7?speed:speed*.5*(1+cos(Math.PI*(t-7)));
  }
  const look = { orientation: null };
  function pose(camera,t,state) {
    const distanceNow=distance(t),u=curve.getUtoTmapping(clamp(distanceNow/length));
    const couple=smoother(8,8.24,t),turn=smoother(8.08,11.10,t);
    const neutral=curve.getPoint(u),g=curve.gait(u),measured=operator.angles(t);
    camera.position.copy(t<8?neutral:end.clone().lerp(supportedEye(localFoot),couple));
    const dir=cabin.porch.clone().sub(camera.position),porchHeading=Math.atan2(dir.x,-dir.z);
    const finalHeading=porchHeading+rad(6.6);
    const cap=cabin.chimney.clone().sub(camera.position);
    const capForward=Math.sin(finalHeading)*cap.x-Math.cos(finalHeading)*cap.z;
    const finalPitch=Math.atan(-cap.y/capForward)-Math.atan(-.74*Math.tan(rad(endFov)*.5));
    const gazeYaw=rad(20)*smoother(.30,4.65,t)+rad(41.8)*smoother(4.13,7.48,t);
    const gazeDown=pitch+rad(10.7)*smoother(.16,4.4,t)+rad(47.8)*smoother(4.28,7.26,t)-rad(2.1)*smoother(7.44,7.97,t);
    const transfer=smoother(6.97,7.37,t)*(1-smoother(7.50,8.22,t));
    const settle=t>7.62?Math.exp(-5.8*(t-7.62))*sin(12.4*(t-7.62)):0;
    const bow=aheadOfBow.clone().applyMatrix4(asset.boat.matrixWorld).sub(camera.position);
    const aimAtBow=smoother(4.65,6.60,t);
    const bowHeading=Math.atan2(bow.x,-bow.z),bowDown=Math.atan2(-bow.y,Math.hypot(bow.x,bow.z));
    const enteringYaw=lerp(gazeYaw,clamp(bowHeading,rad(25),rad(56)),aimAtBow);
    // Look over the gunwale toward the bow. This keeps both feet beyond the
    // image while the fixed dock and the moving hull stay visible together.
    const enteringDown=lerp(gazeDown,clamp(bowDown-rad(1.5),rad(30),rad(40.5)),aimAtBow);
    const heading=lerp(enteringYaw,finalHeading,turn)+rad(.34)*sin(.5*g.p+.21)*g.envelope*(1-.82*measured.walk)+measured.yaw;
    const loading=boardingWeight(t).total,normal=up.clone().applyQuaternion(asset.boat.quaternion);
    const planeRoll=-Math.atan2(normal.x*Math.cos(heading)+normal.z*Math.sin(heading),normal.y);
    const planePitch=Math.atan2(normal.x*Math.sin(heading)-normal.z*Math.cos(heading),normal.y);
    const landingLift=rad(2.7)*smoother(7.37,7.51,t)*(1-smoother(7.52,7.84,t));
    const down=lerp(enteringDown,finalPitch,turn)+g.y*.105*(1-.82*measured.walk)+rad(.65)*transfer+rad(.42)*settle*(1-.78*measured.landing)+measured.down-landingLift+planePitch*loading*(.71-.37*couple);
    const gaitRoll=rad(.36)*sin(.5*g.p-.97)*g.envelope;
    const inclination=gaitRoll*(1-.82*measured.walk)-rad(1.40)*transfer+rad(.49)*settle*(1-.78*measured.landing)+measured.roll+planeRoll*loading*(.76-.22*couple);
    const observingFov=verticalFov+3.1*smoother(3.7,5.65,t);
    camera.fov=lerp(observingFov,endFov,smoother(8.12,10.88,t));
    if (look.orientation) camera.quaternion.copy(look.orientation);
    else camera.rotation.set(-down, -heading, inclination, 'YXZ');
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
    return {t,s:distanceNow,v:cruise(t),neutral:neutral.toArray(),eye:camera.position.toArray(),
      heading,pitchDown:down,fov:camera.fov,roll:inclination,couple,finalHeading,porchHeading,stepPhase:g.p,headLift:g.y,lateralSway:g.side,
      foot:localFoot.clone().applyMatrix4(asset.boat.matrixWorld).toArray()};
  }
  return {curve,length,speed,distance,cruise,pose,look,controls,operatorScales:operator.scales,dockDir,right,base,exit,contact,end,stand,boardStand,offset,stepLength};
}
