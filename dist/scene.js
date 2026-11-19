import * as THREE from './three.module.js';
import {W,H,verticalFov,atD,atY,pix,wind,sunDirection,clamp,smoother} from './calibration.js';
import {buildBank,groundY} from './bank.js';
import {buildForest} from './forest.js';
import {buildCabin} from './cabin.js';
import {buildDockBoat} from './dockboat.js';
import {makeDynamics,buildWater} from './hydrology.js';
import {buildSmoke} from './atmosphere.js';
import {buildPassage} from './passage.js';
import {captureSurfaces} from './surface-capture.js';
import {createOptics} from './optics.js';
import {buildFootwork} from './locomotion.js';
import {buildWalker} from './walker.js';
import {createWalkerLight} from './walker-light.js';

export async function createScene(canvas,{high=false}={}){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:false});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xd4c8ae);
  const camera=new THREE.PerspectiveCamera(verticalFov,W/H,.045,1200);
  const sky=new THREE.HemisphereLight(0xffeddb,0x777663,1.35);scene.add(sky);
  const sun=new THREE.DirectionalLight(0xffe1b6,2.25);
  sun.position.copy(sunDirection);scene.add(sun);
  const manager=THREE.DefaultLoadingManager, failures=[];
  const done=new Promise(resolve=>{manager.onLoad=resolve;});
  manager.onError=url=>failures.push(url);
  manager.itemStart('scene assembly');
  const tex=await new THREE.TextureLoader().loadAsync('./art/reference.webp');
  tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const ctx={THREE,scene,camera,renderer,refTexture:tex,atD,atY,pix,groundY,wind,high};
  const bank=await buildBank(ctx), forest=await buildForest(ctx), cabin=await buildCabin(ctx), asset=await buildDockBoat(ctx);
  const dyn=makeDynamics(asset), water=buildWater(ctx,dyn,asset), smoke=buildSmoke(ctx,cabin.chimney);
  const rig=buildPassage(asset,cabin,dyn);
  const footwork=buildFootwork(ctx,rig,asset,dyn),walker=await buildWalker(ctx);
  ctx.walkerLight=createWalkerLight(ctx,footwork,walker,asset);
  manager.itemEnd('scene assembly');await Promise.all([done,cabin?.ready,bank?.ready,forest?.ready,asset?.ready,walker?.ready]);
  if(failures.length)throw Error('未能载入场景材质 '+failures.join(', '));
  const surveyed=await captureSurfaces(ctx,{cabin,bank,forest,asset,water,rig,dyn});
  const optics=createOptics(renderer,scene,camera,rig,dyn,high);
  function setTime(t,shadows=true){
    const state=dyn.apply(t);bank?.update?.(t);forest?.update?.(t);
    smoke.update(t);water.update(t);surveyed.update();
    const pose=rig.pose(camera,t,state);
    const feet=footwork.pose(t,pose);walker.update(feet,t);
    if(shadows)ctx.walkerLight.prepare(renderer,scene,feet,pose);
  }
  function render(n) {
    const frame = Math.round(clamp(n, 0, 287));
    const t = frame / 24;
    const integrate = frame > 0;
    if (!integrate) optics.prepare(t);
    setTime(t, !integrate);
    if(integrate){
      // Two equal intervals of a 1/60-second shutter. Each re-evaluates the
      // entire world, including the reflection, wind, boat and moving occluders.
      const exposure=smoother(0,.16,t)/60;
      const early=t-exposure/4,late=t+exposure/4;
      optics.prepare(early,exposure/2);setTime(early);optics.draw(early,'first');
      optics.prepare(late,exposure/2);setTime(late);optics.draw(late,'last');
      setTime(t);
    } else {
      optics.draw(t);
    }
  }
  function resize(width,height){
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  }
  const upAxis = new THREE.Vector3(0, 1, 0);
  const rightAxis = new THREE.Vector3(1, 0, 0);
  const turn = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();

  function orientation() {
    return (rig.look.orientation ?? camera.quaternion).clone();
  }
  function rotateFrom(start, yaw, pitch) {
    turn.setFromAxisAngle(upAxis, yaw);
    tilt.setFromAxisAngle(rightAxis, pitch);
    rig.look.orientation ??= new THREE.Quaternion();
    rig.look.orientation.copy(turn).multiply(start).multiply(tilt).normalize();
  }
  function resetLook() {
    rig.look.orientation = null;
  }
  return { render, resize, orientation, rotateFrom, resetLook,
    get lookingAround() { return rig.look.orientation !== null; }
  };
}
