import * as THREE from 'three';
import { LOCATIONS } from './world.js';

const LOCATION_POSITIONS = {
  arena:     { x: 0,   z: 0 },
  shop:      { x: 40,  z: 0 },
  social:    { x: -40, z: 0 },
  cafe:      { x: 20,  z: 30 },
  gym:       { x: -20, z: 30 },
  home:      { x: 0,   z: 60 },
  traveling: null, // computed from target
};

const MOOD_COLORS = {
  ecstatic: 0x00ff88,
  happy: 0x88ff00,
  neutral: 0xffdd00,
  uncomfortable: 0xff8800,
  miserable: 0xff4400,
  crisis: 0xff0000,
};

// Shared geometry (reused across all agents for performance)
const SHARED_GEO = {
  body: new THREE.CapsuleGeometry(0.8, 1.5, 4, 8),
  head: new THREE.SphereGeometry(0.6, 8, 8),
  eye: new THREE.SphereGeometry(0.08, 6, 6),
  eyeWhite: new THREE.SphereGeometry(0.13, 6, 6),
  eyebrow: new THREE.BoxGeometry(0.18, 0.04, 0.06),
  nose: new THREE.ConeGeometry(0.06, 0.15, 4),
  mouth: new THREE.BoxGeometry(0.2, 0.04, 0.05),
  moodRing: new THREE.RingGeometry(0.4, 0.5, 16),
  arm: new THREE.CapsuleGeometry(0.18, 0.7, 3, 6),
  leg: new THREE.CapsuleGeometry(0.22, 0.6, 3, 6),
  hand: new THREE.SphereGeometry(0.14, 6, 6),
  foot: new THREE.BoxGeometry(0.22, 0.12, 0.35),
  belt: new THREE.TorusGeometry(0.82, 0.06, 4, 12),
  collar: new THREE.TorusGeometry(0.5, 0.05, 4, 10),
};
// Translate arm/leg so pivot is at shoulder/hip (top of limb)
SHARED_GEO.arm.translate(0, -0.35, 0);
SHARED_GEO.leg.translate(0, -0.3, 0);
// Translate hand/foot so they sit at end of limbs
SHARED_GEO.hand.translate(0, -0.7, 0);
SHARED_GEO.foot.translate(0, -0.6, 0.08);

const HAIR_STYLES = ['flat_top', 'spiky', 'ponytail', 'curly', 'bald'];

export class CharacterManager {
  constructor(scene) {
    this.scene = scene;
    this.characters = new Map(); // agentId -> { group, mesh, data, target, label }
    this.agentData = new Map();
    this._statusEffects = []; // active floating effects
  }

  updateAgents(agents) {
    const activeIds = new Set();

    for (const agent of agents) {
      activeIds.add(agent.agent_id);
      this.agentData.set(agent.agent_id, agent);

      if (this.characters.has(agent.agent_id)) {
        this._updateCharacter(agent);
      } else {
        this._createCharacter(agent);
      }
    }

    // Remove characters no longer in data
    for (const [id, char] of this.characters) {
      if (!activeIds.has(id)) {
        this.scene.remove(char.group);
        this.characters.delete(id);
      }
    }
  }

  _createCharacter(agent) {
    const group = new THREE.Group();
    group.userData.agentId = agent.agent_id;

    const color = new THREE.Color(agent.character_color || '#FF6B35');

    // Body (shared geometry)
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
    const body = new THREE.Mesh(SHARED_GEO.body, bodyMat);
    body.position.y = 2;
    body.castShadow = true;
    group.add(body);

    // Head
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffd5b4, roughness: 0.6 });
    const head = new THREE.Mesh(SHARED_GEO.head, headMat);
    head.position.y = 3.5;
    head.castShadow = true;
    group.add(head);

    // Eye whites
    const whitesMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const whiteL = new THREE.Mesh(SHARED_GEO.eyeWhite, whitesMat);
    whiteL.position.set(-0.2, 3.55, 0.45);
    group.add(whiteL);
    const whiteR = new THREE.Mesh(SHARED_GEO.eyeWhite, whitesMat);
    whiteR.position.set(0.2, 3.55, 0.45);
    group.add(whiteR);

    // Pupils (on top of whites)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const eyeL = new THREE.Mesh(SHARED_GEO.eye, eyeMat);
    eyeL.position.set(-0.2, 3.55, 0.55);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(SHARED_GEO.eye, eyeMat);
    eyeR.position.set(0.2, 3.55, 0.55);
    group.add(eyeR);

    // Eyebrows
    const browMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
    const browL = new THREE.Mesh(SHARED_GEO.eyebrow, browMat);
    browL.position.set(-0.2, 3.72, 0.48);
    group.add(browL);
    const browR = new THREE.Mesh(SHARED_GEO.eyebrow, browMat);
    browR.position.set(0.2, 3.72, 0.48);
    group.add(browR);

    // Nose
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xeec8a0, roughness: 0.7 });
    const nose = new THREE.Mesh(SHARED_GEO.nose, noseMat);
    nose.position.set(0, 3.42, 0.58);
    nose.rotation.x = -Math.PI / 2;
    group.add(nose);

    // Mouth
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0xcc6666 });
    const mouth = new THREE.Mesh(SHARED_GEO.mouth, mouthMat);
    mouth.position.set(0, 3.28, 0.52);
    group.add(mouth);

    // Collar (where neck meets body)
    const collarMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(agent.character_color || '#FF6B35').multiplyScalar(0.8),
      roughness: 0.5,
    });
    const collar = new THREE.Mesh(SHARED_GEO.collar, collarMat);
    collar.position.set(0, 2.85, 0);
    collar.rotation.x = Math.PI / 2;
    group.add(collar);

    // Belt (waist detail)
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.5, metalness: 0.2 });
    const belt = new THREE.Mesh(SHARED_GEO.belt, beltMat);
    belt.position.set(0, 1.35, 0);
    belt.rotation.x = Math.PI / 2;
    group.add(belt);

    // Arms
    const skinColor = new THREE.Color(0xffd5b4);
    const armMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
    const handMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.6 });

    const leftArm = new THREE.Mesh(SHARED_GEO.arm, armMat);
    leftArm.position.set(-1.0, 2.5, 0);
    leftArm.rotation.z = 0.15;
    leftArm.castShadow = true;
    group.add(leftArm);

    // Left hand (child of left arm so it follows arm rotation)
    const leftHand = new THREE.Mesh(SHARED_GEO.hand, handMat);
    leftArm.add(leftHand);

    const rightArm = new THREE.Mesh(SHARED_GEO.arm, armMat);
    rightArm.position.set(1.0, 2.5, 0);
    rightArm.rotation.z = -0.15;
    rightArm.castShadow = true;
    group.add(rightArm);

    // Right hand
    const rightHand = new THREE.Mesh(SHARED_GEO.hand, handMat);
    rightArm.add(rightHand);

    // Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.6 });
    const footMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });

    const leftLeg = new THREE.Mesh(SHARED_GEO.leg, legMat);
    leftLeg.position.set(-0.35, 1.0, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    // Left foot (child of left leg)
    const leftFoot = new THREE.Mesh(SHARED_GEO.foot, footMat);
    leftLeg.add(leftFoot);

    const rightLeg = new THREE.Mesh(SHARED_GEO.leg, legMat);
    rightLeg.position.set(0.35, 1.0, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    // Right foot
    const rightFoot = new THREE.Mesh(SHARED_GEO.foot, footMat);
    rightLeg.add(rightFoot);

    // Mood ring
    const moodColor = MOOD_COLORS[agent.mood] || MOOD_COLORS.neutral;
    const moodMat = new THREE.MeshBasicMaterial({ color: moodColor, side: THREE.DoubleSide });
    const moodRing = new THREE.Mesh(SHARED_GEO.moodRing, moodMat);
    moodRing.position.y = 4.5;
    moodRing.rotation.x = -Math.PI / 2;
    group.add(moodRing);

    // Name label
    const labelSprite = this._createLabel(agent.name);
    labelSprite.position.y = 5.2;
    group.add(labelSprite);

    // Activity label (below name)
    const activitySprite = this._createActivityLabel(agent.current_activity || 'idle');
    activitySprite.position.y = 4.7;
    group.add(activitySprite);

    // Accessory
    this._addAccessory(group, agent.character_accessory, color);

    // Hair (skip if crown or flame_hat occupy the same space)
    const skipHair = agent.character_accessory === 'crown' || agent.character_accessory === 'flame_hat';
    if (!skipHair) {
      this._addHair(group, agent.agent_id, agent.character_color);
    }

    // Position
    const pos = this._getPosition(agent);
    group.position.set(pos.x, 0, pos.z);

    this.scene.add(group);
    this.characters.set(agent.agent_id, {
      group,
      body,
      head,
      browL,
      browR,
      mouth,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      moodRing,
      moodMat,
      activitySprite,
      data: agent,
      target: { x: pos.x, z: pos.z },
      bobOffset: Math.random() * Math.PI * 2,
      _lastZzz: 0,
      _baseBodyY: 2,
      _baseHeadY: 3.5,
      _baseArmY: 2.5,
      _baseLegY: 1.0,
    });
  }

  _updateCharacter(agent) {
    const char = this.characters.get(agent.agent_id);
    if (!char) return;

    const prevActivity = char.data.current_activity;
    char.data = agent;

    // Update mood ring
    const moodColor = MOOD_COLORS[agent.mood] || MOOD_COLORS.neutral;
    char.moodMat.color.setHex(moodColor);

    // Update body color
    if (agent.character_color) {
      char.body.material.color.set(agent.character_color);
    }

    // Update target position
    const pos = this._getPosition(agent);
    char.target = { x: pos.x, z: pos.z };

    // Update activity label if changed
    if (prevActivity !== agent.current_activity) {
      this._updateActivityLabel(char.activitySprite, agent.current_activity || 'idle');
    }
  }

  _getPosition(agent) {
    const spread = 8;
    const seed = agent.agent_id * 137.5;
    const offsetX = Math.sin(seed) * spread;
    const offsetZ = Math.cos(seed * 1.3) * spread;

    // If traveling, interpolate toward target location
    if (agent.current_location === 'traveling' && agent.target_location) {
      const target = LOCATION_POSITIONS[agent.target_location] || LOCATION_POSITIONS.arena;
      return { x: target.x + offsetX * 0.5, z: target.z + offsetZ * 0.5 };
    }

    const loc = LOCATION_POSITIONS[agent.current_location] || LOCATION_POSITIONS.arena;
    if (!loc) return { x: offsetX, z: offsetZ };
    return { x: loc.x + offsetX, z: loc.z + offsetZ };
  }

  _createLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 48);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(10, 4, 236, 40, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text.slice(0, 16), 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.85 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(6, 1.2, 1);
    return sprite;
  }

  _createActivityLabel(activity) {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    this._drawActivityText(ctx, activity);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.7 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4.5, 0.8, 1);
    sprite._canvas = canvas;
    sprite._ctx = ctx;
    return sprite;
  }

  _drawActivityText(ctx, activity) {
    ctx.clearRect(0, 0, 192, 32);
    const emoji = {
      eating: '\u{1F354}', sleeping: '\u{1F4A4}', socializing: '\u{1F4AC}',
      training: '\u{1F4AA}', browsing: '\u{1F6D2}', flexing: '\u{1F525}',
      showering: '\u{1F6BF}', roasting: '\u{1F525}', resting: '\u2615',
      performing: '\u{1F3A4}', traveling: '\u{1F6B6}', idle: '\u{1F914}',
    }[activity] || '';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.roundRect(8, 2, 176, 28, 6);
    ctx.fill();
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${emoji} ${activity}`, 96, 22);
  }

  _updateActivityLabel(sprite, activity) {
    if (!sprite._ctx) return;
    this._drawActivityText(sprite._ctx, activity);
    sprite.material.map.needsUpdate = true;
  }

  _addAccessory(group, accessory, bodyColor) {
    if (!accessory || accessory === 'none') return;

    switch (accessory) {
      case 'crown': {
        const crownGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.3, 5);
        const crownMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 });
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.y = 4.1;
        group.add(crown);
        break;
      }
      case 'flame_hat': {
        const hatGeo = new THREE.ConeGeometry(0.5, 0.8, 6);
        const hatMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.3 });
        const hat = new THREE.Mesh(hatGeo, hatMat);
        hat.position.y = 4.2;
        group.add(hat);
        break;
      }
      case 'sunglasses': {
        const glassGeo = new THREE.BoxGeometry(0.7, 0.15, 0.1);
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9 });
        const glasses = new THREE.Mesh(glassGeo, glassMat);
        glasses.position.set(0, 3.55, 0.55);
        group.add(glasses);
        break;
      }
      case 'glasses': {
        const glassGeo = new THREE.TorusGeometry(0.15, 0.03, 6, 12);
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const glassL = new THREE.Mesh(glassGeo, glassMat);
        glassL.position.set(-0.2, 3.55, 0.55);
        glassL.rotation.y = Math.PI / 2;
        group.add(glassL);
        const glassR = glassL.clone();
        glassR.position.set(0.2, 3.55, 0.55);
        group.add(glassR);
        break;
      }
      case 'headphones': {
        const bandGeo = new THREE.TorusGeometry(0.6, 0.06, 8, 16, Math.PI);
        const bandMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = 3.7;
        band.rotation.z = Math.PI;
        group.add(band);
        break;
      }
    }
  }

  _getHairStyle(agentId) {
    const index = Math.abs(agentId * 7 + 3) % HAIR_STYLES.length;
    return HAIR_STYLES[index];
  }

  _getHairColor(characterColor) {
    const base = new THREE.Color(characterColor || '#FF6B35');
    const brown = new THREE.Color(0x3a2a1a);
    base.lerp(brown, 0.4);
    base.multiplyScalar(0.7);
    return base;
  }

  _addHair(group, agentId, characterColor) {
    const style = this._getHairStyle(agentId);
    const hairColor = this._getHairColor(characterColor);
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 });

    switch (style) {
      case 'flat_top': {
        const hair = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), hairMat);
        hair.position.y = 4.1;
        group.add(hair);
        break;
      }
      case 'spiky': {
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), hairMat);
          const angle = (i / 5) * Math.PI * 2;
          spike.position.set(
            Math.cos(angle) * 0.3,
            4.15 + (i % 3) * 0.08,
            Math.sin(angle) * 0.3
          );
          spike.rotation.x = Math.sin(angle) * 0.3;
          spike.rotation.z = -Math.cos(angle) * 0.3;
          group.add(spike);
        }
        break;
      }
      case 'ponytail': {
        // Cap on head
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.55, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
          hairMat
        );
        cap.position.y = 3.75;
        group.add(cap);

        // Dangling tail behind
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 3, 6), hairMat);
        tail.position.set(0, 3.4, -0.45);
        tail.rotation.x = 0.4;
        group.add(tail);
        break;
      }
      case 'curly': {
        const curly = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), hairMat);
        curly.position.y = 3.85;
        group.add(curly);
        break;
      }
      case 'bald':
        // No hair
        break;
    }
  }

  update(delta, elapsed) {
    for (const [id, char] of this.characters) {
      const activity = char.data.current_activity || 'idle';

      // --- Movement ---
      const dx = char.target.x - char.group.position.x;
      const dz = char.target.z - char.group.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.5) {
        const speed = Math.min(delta * 5, dist);
        char.group.position.x += (dx / dist) * speed;
        char.group.position.z += (dz / dist) * speed;
        // Face movement direction
        char.group.rotation.y = Math.atan2(dx, dz);
      }

      // --- Activity-specific animations ---
      const isMoving = dist > 0.5;

      switch (activity) {
        case 'eating':
          char.head.position.y = 3.3 + Math.sin(elapsed * 4 + char.bobOffset) * 0.05;
          char.head.rotation.x = 0.2;
          char.body.position.y = char._baseBodyY;
          char.body.scale.set(1, 1, 1);
          // Right arm raised to mouth
          char.rightArm.rotation.x = -0.6;
          char.rightArm.rotation.z = -0.3;
          char.leftArm.rotation.x = 0;
          char.leftArm.rotation.z = 0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;

        case 'sleeping':
          char.body.scale.x = 1 + Math.sin(elapsed * 0.8 + char.bobOffset) * 0.03;
          char.body.scale.z = 1 + Math.sin(elapsed * 0.8 + char.bobOffset) * 0.03;
          char.body.position.y = char._baseBodyY - 0.3;
          char.head.position.y = 3.2;
          char.head.rotation.x = 0.15;
          // Arms relaxed outward
          char.leftArm.rotation.z = 0.3;
          char.rightArm.rotation.z = -0.3;
          char.leftArm.rotation.x = 0;
          char.rightArm.rotation.x = 0;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          if (elapsed - char._lastZzz > 2.5) {
            char._lastZzz = elapsed;
            this.showStatusEffect(id, 'Z z z', '#8888ff', 2500);
          }
          break;

        case 'roasting':
        case 'performing':
          char.group.rotation.y += Math.sin(elapsed * 3 + char.bobOffset) * 0.015;
          char.body.position.y = char._baseBodyY + Math.abs(Math.sin(elapsed * 3)) * 0.1;
          char.head.position.y = char._baseHeadY + Math.abs(Math.sin(elapsed * 3)) * 0.1;
          char.head.rotation.x = 0;
          char.body.scale.set(1, 1, 1);
          // Gesticulating arms
          char.leftArm.rotation.x = Math.sin(elapsed * 3 + char.bobOffset) * 0.4;
          char.rightArm.rotation.x = Math.sin(elapsed * 3 + char.bobOffset + Math.PI) * 0.4;
          char.leftArm.rotation.z = 0.15;
          char.rightArm.rotation.z = -0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;

        case 'training': {
          // Energetic bouncing
          const bounceY = Math.abs(Math.sin(elapsed * 5 + char.bobOffset)) * 0.4;
          char.body.position.y = char._baseBodyY + bounceY;
          char.head.position.y = char._baseHeadY + bounceY;
          char.head.rotation.x = 0;
          char.body.scale.set(1, 1, 1);
          // Arms punching alternately
          char.leftArm.rotation.x = -Math.abs(Math.sin(elapsed * 5 + char.bobOffset)) * 0.8;
          char.rightArm.rotation.x = -Math.abs(Math.sin(elapsed * 5 + char.bobOffset + Math.PI)) * 0.8;
          char.leftArm.rotation.z = 0.15;
          char.rightArm.rotation.z = -0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;
        }

        case 'socializing':
          this._faceNearestAgent(char);
          char.body.position.y = char._baseBodyY + Math.sin(elapsed * 1.5 + char.bobOffset) * 0.05;
          char.head.position.y = char._baseHeadY + Math.sin(elapsed * 1.5 + char.bobOffset) * 0.05;
          char.head.rotation.x = 0;
          char.body.scale.set(1, 1, 1);
          // Right arm gesturing
          char.rightArm.rotation.x = Math.sin(elapsed * 2 + char.bobOffset) * 0.3;
          char.leftArm.rotation.x = 0;
          char.leftArm.rotation.z = 0.15;
          char.rightArm.rotation.z = -0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;

        case 'flexing': {
          const pulse = 1 + Math.sin(elapsed * 6 + char.bobOffset) * 0.06;
          char.body.scale.set(pulse, 1, pulse);
          char.body.position.y = char._baseBodyY;
          char.head.position.y = char._baseHeadY;
          char.head.rotation.x = -0.1;
          // Arms raised in flex pose
          char.leftArm.rotation.z = 0.8 + Math.sin(elapsed * 3) * 0.1;
          char.rightArm.rotation.z = -0.8 - Math.sin(elapsed * 3) * 0.1;
          char.leftArm.rotation.x = -0.5;
          char.rightArm.rotation.x = -0.5;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;
        }

        case 'browsing':
          char.head.rotation.y = Math.sin(elapsed * 1.2 + char.bobOffset) * 0.3;
          char.body.position.y = char._baseBodyY;
          char.head.position.y = char._baseHeadY;
          char.head.rotation.x = 0;
          char.body.scale.set(1, 1, 1);
          char.leftArm.rotation.x = 0;
          char.rightArm.rotation.x = 0;
          char.leftArm.rotation.z = 0.15;
          char.rightArm.rotation.z = -0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;

        case 'showering':
          char.body.rotation.z = Math.sin(elapsed * 8 + char.bobOffset) * 0.02;
          char.body.position.y = char._baseBodyY;
          char.head.position.y = char._baseHeadY;
          char.head.rotation.x = 0;
          char.body.scale.set(1, 1, 1);
          // Arms scrubbing
          char.leftArm.rotation.x = Math.sin(elapsed * 6 + char.bobOffset) * 0.2;
          char.rightArm.rotation.x = Math.sin(elapsed * 6 + char.bobOffset + 1) * 0.2;
          char.leftArm.rotation.z = 0.15;
          char.rightArm.rotation.z = -0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;

        default: {
          // Idle bob
          char.head.rotation.x = 0;
          char.head.rotation.y = 0;
          char.body.rotation.z = 0;
          char.body.scale.set(1, 1, 1);
          const bobSpeed = char.data.mood === 'ecstatic' ? 3 : char.data.mood === 'happy' ? 2 : 1;
          const bobAmount = char.data.mood === 'crisis' ? 0.02 : 0.08;
          char.body.position.y = char._baseBodyY + Math.sin(elapsed * bobSpeed + char.bobOffset) * bobAmount;
          char.head.position.y = char._baseHeadY + Math.sin(elapsed * bobSpeed + char.bobOffset) * bobAmount;
          // Subtle idle arm sway
          char.leftArm.rotation.x = Math.sin(elapsed * 0.8 + char.bobOffset) * 0.05;
          char.rightArm.rotation.x = Math.sin(elapsed * 0.8 + char.bobOffset + 1) * 0.05;
          char.leftArm.rotation.z = 0.15;
          char.rightArm.rotation.z = -0.15;
          char.leftLeg.rotation.x = 0;
          char.rightLeg.rotation.x = 0;
          break;
        }
      }

      // Walking animation with arm/leg swing (overrides static limb poses)
      if (isMoving && activity !== 'sleeping') {
        const walkPhase = elapsed * 8;
        const walkBob = Math.sin(walkPhase) * 0.12;
        char.body.position.y += walkBob;
        char.head.position.y += walkBob;
        // Arm swing (opposite sides for natural walk)
        char.leftArm.rotation.x = Math.sin(walkPhase) * 0.5;
        char.rightArm.rotation.x = -Math.sin(walkPhase) * 0.5;
        char.leftArm.rotation.z = 0.15;
        char.rightArm.rotation.z = -0.15;
        // Leg swing
        char.leftLeg.rotation.x = Math.sin(walkPhase) * 0.4;
        char.rightLeg.rotation.x = -Math.sin(walkPhase) * 0.4;
        // Arms bob with body
        char.leftArm.position.y = char._baseArmY + walkBob;
        char.rightArm.position.y = char._baseArmY + walkBob;
        // Slight forward lean
        char.body.rotation.x = 0.05;
      } else {
        // Sync arm Y with body for non-walking states
        const bodyDelta = char.body.position.y - char._baseBodyY;
        char.leftArm.position.y = char._baseArmY + bodyDelta;
        char.rightArm.position.y = char._baseArmY + bodyDelta;
        char.body.rotation.x = 0;
      }

      // --- Facial expressions based on mood & activity ---
      const mood = char.data.mood || 'neutral';
      // Eyebrow angle: happy = raised, angry/crisis = furrowed
      if (mood === 'ecstatic' || mood === 'happy') {
        char.browL.position.y = 3.75;
        char.browR.position.y = 3.75;
        char.browL.rotation.z = 0.1;
        char.browR.rotation.z = -0.1;
      } else if (mood === 'miserable' || mood === 'crisis') {
        char.browL.position.y = 3.70;
        char.browR.position.y = 3.70;
        char.browL.rotation.z = -0.2;
        char.browR.rotation.z = 0.2;
      } else {
        char.browL.position.y = 3.72;
        char.browR.position.y = 3.72;
        char.browL.rotation.z = 0;
        char.browR.rotation.z = 0;
      }

      // Mouth: scale wider when talking/roasting, thinner when sad
      if (activity === 'roasting' || activity === 'performing' || activity === 'socializing') {
        char.mouth.scale.x = 1.5 + Math.sin(elapsed * 6 + char.bobOffset) * 0.5;
        char.mouth.scale.y = 1 + Math.abs(Math.sin(elapsed * 6 + char.bobOffset)) * 0.8;
      } else if (mood === 'ecstatic' || mood === 'happy') {
        char.mouth.scale.x = 1.3;
        char.mouth.scale.y = 1;
      } else if (mood === 'miserable' || mood === 'crisis') {
        char.mouth.scale.x = 0.8;
        char.mouth.scale.y = 1.5;
      } else {
        char.mouth.scale.set(1, 1, 1);
      }
    }

    // Update status effects
    this._updateStatusEffects();
  }

  // --- Floating Status Effects ---
  showStatusEffect(agentId, text, color = '#ffdd00', duration = 3000) {
    const char = this.characters.get(agentId);
    if (!char) return;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(text, 128, 44);
    ctx.fillText(text, 128, 44);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 1 });
    const sprite = new THREE.Sprite(mat);
    sprite.position.y = 6;
    sprite.scale.set(5, 1.2, 1);
    char.group.add(sprite);

    this._statusEffects.push({
      sprite,
      group: char.group,
      startTime: performance.now(),
      duration,
      startY: 6,
    });
  }

  _updateStatusEffects() {
    const now = performance.now();
    for (let i = this._statusEffects.length - 1; i >= 0; i--) {
      const fx = this._statusEffects[i];
      const t = (now - fx.startTime) / fx.duration;
      if (t >= 1) {
        fx.group.remove(fx.sprite);
        fx.sprite.material.dispose();
        fx.sprite.material.map.dispose();
        this._statusEffects.splice(i, 1);
      } else {
        fx.sprite.position.y = fx.startY + t * 3;
        fx.sprite.material.opacity = 1 - t * t;
      }
    }
  }

  _faceNearestAgent(char) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const [id, other] of this.characters) {
      if (id === char.data.agent_id) continue;
      if (other.data.current_location !== char.data.current_location) continue;
      const dx = other.group.position.x - char.group.position.x;
      const dz = other.group.position.z - char.group.position.z;
      const d = dx * dx + dz * dz;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = other;
      }
    }
    if (nearest) {
      const dx = nearest.group.position.x - char.group.position.x;
      const dz = nearest.group.position.z - char.group.position.z;
      char.group.rotation.y = Math.atan2(dx, dz);
    }
  }

  // --- Crew Rings ---
  updateCrewData(crews) {
    // Build lookup: agentId -> crew color
    const crewColors = {};
    for (const crew of crews) {
      if (crew.members) {
        for (const m of crew.members) {
          crewColors[m.agent_id] = crew.color || '#ff6b35';
        }
      }
    }

    for (const [id, char] of this.characters) {
      const color = crewColors[id];
      if (color) {
        if (!char._crewRing) {
          const ringGeo = new THREE.RingGeometry(1.2, 1.5, 24);
          const ringMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
          });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.05;
          char.group.add(ring);
          char._crewRing = ring;
          char._crewRingMat = ringMat;
        } else {
          char._crewRingMat.color.set(color);
        }
      } else if (char._crewRing) {
        char.group.remove(char._crewRing);
        char._crewRingMat.dispose();
        char._crewRing.geometry.dispose();
        char._crewRing = null;
        char._crewRingMat = null;
      }
    }
  }

  getClickableObjects() {
    const objects = [];
    for (const [, char] of this.characters) {
      objects.push(char.body, char.head);
    }
    return objects;
  }

  getAgent(agentId) {
    return this.agentData.get(agentId);
  }

  getAgentScreenPosition(agentId, camera, renderer) {
    const char = this.characters.get(agentId);
    if (!char) return null;

    const pos = new THREE.Vector3();
    pos.copy(char.group.position);
    pos.y += 5;
    pos.project(camera);

    const widthHalf = renderer.domElement.clientWidth / 2;
    const heightHalf = renderer.domElement.clientHeight / 2;

    return {
      x: (pos.x * widthHalf) + widthHalf,
      y: -(pos.y * heightHalf) + heightHalf,
    };
  }
}
